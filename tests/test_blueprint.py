"""Templates of the notification blueprint, rendered through Home Assistant."""

from __future__ import annotations

from pathlib import Path

import pytest

from homeassistant.core import HomeAssistant, State
from homeassistant.helpers.template import Template
from homeassistant.util.yaml import load_yaml

BLUEPRINT = (
    Path(__file__).resolve().parent.parent
    / "blueprints"
    / "automation"
    / "timmaurice"
    / "earthquake_notify.yaml"
)


def _blueprint() -> dict:
    return load_yaml(BLUEPRINT)


def _render(hass: HomeAssistant, template: str, variables: dict):
    return Template(template, hass).async_render(variables)


def _quake(quake_id: str, magnitude: float, time: str, place: str) -> dict:
    return {
        "id": quake_id,
        "magnitude": magnitude,
        "time": time,
        "place": place,
        "alert_tsunami": False,
    }


def _sensor(quakes: list[dict]) -> State:
    """The sensor as it reports a poll: the newest quake on top, all of them in the list.

    Absent attributes are omitted, as the sensor drops None values.
    """
    return State(
        "sensor.earthquakelist_corfu_latest_earthquake",
        str(quakes[0]["magnitude"]),
        {**quakes[0], "earthquakes": quakes},
    )


OLDER = _quake("a", 4.2, "2026-11-14T08:00:00+00:00", "Lefkada")
NEWEST = _quake("b", 4.0, "2026-11-15T10:00:00+00:00", "Corfu")
UNAVAILABLE = State("sensor.earthquakelist_corfu_latest_earthquake", "unavailable", {})


def _trigger(attributes: dict) -> dict:
    """A poll that adds one M3.6 quake near Corfu, with these attributes on it."""
    quake = {**_quake("new", 3.6, "2026-11-15T10:00:00+00:00", "Corfu"), **attributes}
    return {"from_state": _sensor([OLDER]), "to_state": _sensor([quake, OLDER])}


def _variables(hass: HomeAssistant, trigger: dict, **inputs) -> dict:
    """Render the variables in order, as the automation does before its conditions."""
    scope = {"trigger": trigger, "min_magnitude": 0, "tsunami_only": False, **inputs}
    for name, template in _blueprint()["variables"].items():
        if isinstance(template, str) and "{{" in template:
            scope[name] = _render(hass, template, dict(scope))
    return scope


def _notification(
    hass: HomeAssistant, from_state: State, to_state: State, min_magnitude: float = 0
) -> str | None:
    """Run the blueprint's variables and conditions; the title if it notifies, else None."""
    scope = _variables(
        hass,
        {"from_state": from_state, "to_state": to_state},
        min_magnitude=min_magnitude,
    )
    for condition in _blueprint()["condition"]:
        if not _render(hass, condition["value_template"], dict(scope)):
            return None
    return scope["title"]


@pytest.mark.parametrize(
    ("attributes", "expected"),
    [
        # Most quakes: no alert_level attribute at all (the sensor drops None).
        ({"alert_tsunami": False}, False),
        # USGS PAGER green means "no significant impact expected".
        ({"alert_tsunami": False, "alert_level": "green"}, False),
        ({"alert_tsunami": False, "alert_level": ""}, False),
        ({"alert_tsunami": False, "alert_level": "yellow"}, True),
        ({"alert_tsunami": False, "alert_level": "Orange"}, True),
        ({"alert_tsunami": False, "alert_level": "red"}, True),
        ({"alert_tsunami": True}, True),
        ({"alert_tsunami": True, "alert_level": "green"}, True),
        # Tolerate the API's raw "0"/"1" strings should they ever reach the state.
        ({"alert_tsunami": "0"}, False),
        ({"alert_tsunami": "1"}, True),
        ({}, False),
    ],
)
async def test_is_tsunami_only_flags_real_alerts(
    hass: HomeAssistant, attributes: dict, expected: bool
) -> None:
    """Every ordinary quake used to be titled "Tsunami Alert".

    The old check `alert_level not in [none, false]` was true for an absent
    attribute (undefined) and for "green", which covers nearly every quake.
    """
    assert _variables(hass, _trigger(attributes))["is_tsunami"] is expected


@pytest.mark.parametrize(
    ("tsunami_only", "is_tsunami", "expected"),
    [
        (False, False, True),
        (False, True, True),
        (True, False, False),
        (True, True, True),
    ],
)
async def test_tsunami_only_condition_uses_the_same_check(
    hass: HomeAssistant, tsunami_only: bool, is_tsunami: bool, expected: bool
) -> None:
    """The condition reuses `is_tsunami`, so title and filter cannot disagree again."""
    condition = _blueprint()["condition"][-1]["value_template"]

    assert (
        _render(
            hass, condition, {"tsunami_only": tsunami_only, "is_tsunami": is_tsunami}
        )
        is expected
    )


@pytest.mark.parametrize(
    ("from_state", "to_state"),
    [
        # Same quakes again.
        (_sensor([NEWEST, OLDER]), _sensor([NEWEST, OLDER])),
        # Recovery from unavailable: the list was missing before.
        (UNAVAILABLE, _sensor([NEWEST, OLDER])),
        # The list vanishing (sensor unavailable).
        (_sensor([NEWEST, OLDER]), UNAVAILABLE),
        (None, _sensor([NEWEST, OLDER])),
        (_sensor([NEWEST, OLDER]), None),
    ],
)
async def test_no_notification_without_a_new_quake(
    hass: HomeAssistant, from_state, to_state
) -> None:
    """The same quakes after an unavailable phase must not notify again."""
    assert _notification(hass, from_state, to_state) is None


@pytest.mark.parametrize(
    "trigger",
    [
        # Sensor went unavailable: state is a string, every attribute is gone.
        {"from_state": _sensor([OLDER]), "to_state": UNAVAILABLE},
        {
            "from_state": _sensor([OLDER]),
            "to_state": State("sensor.x", "unknown", {}),
        },
        # Entity removed while the trigger was pending.
        {"from_state": _sensor([OLDER]), "to_state": None},
        {"from_state": None, "to_state": None},
        # Normal quake without distance/direction (no home location configured).
        _trigger({}),
        _trigger({"distance_km": ""}),
    ],
)
async def test_variables_render_without_attributes(
    hass: HomeAssistant, trigger: dict
) -> None:
    """The trigger also fires on unavailable, before the conditions run.

    The variables block used to raise "Error rendering variables: round got
    invalid input ''" because distance was rendered when distance_km was absent.
    """
    scope = _variables(hass, trigger)

    assert scope["is_tsunami"] is False
    assert "round got invalid input" not in str(scope["message"])
    assert "km" not in str(scope["message"])


async def test_message_includes_distance_when_known(hass: HomeAssistant) -> None:
    """The distance suffix is still produced when the sensor carries it."""
    scope = _variables(hass, _trigger({"distance_km": 12.4, "direction": "NW"}))

    assert scope["message"] == "Magnitude 3.6 earthquake near Corfu (12 km NW)."


@pytest.mark.parametrize(
    ("attributes", "expected"),
    [
        ({"alert_tsunami": False}, "New Earthquake"),
        ({"alert_tsunami": False, "alert_level": "green"}, "New Earthquake"),
        # USGS PAGER estimates damage and casualties; it says nothing about a tsunami.
        ({"alert_tsunami": False, "alert_level": "yellow"}, "Earthquake Alert"),
        ({"alert_tsunami": False, "alert_level": "orange"}, "Earthquake Alert"),
        ({"alert_tsunami": False, "alert_level": "red"}, "Earthquake Alert"),
        ({"alert_tsunami": True}, "Tsunami Alert"),
        ({"alert_tsunami": True, "alert_level": "orange"}, "Tsunami Alert"),
    ],
)
async def test_title_says_tsunami_only_for_a_tsunami_flag(
    hass: HomeAssistant, attributes: dict, expected: str
) -> None:
    """An orange PAGER alert for an inland quake used to read "Tsunami Alert"."""
    assert _variables(hass, _trigger(attributes))["title"] == (
        f"{expected} - M3.6 near Corfu"
    )



async def test_notifies_a_new_quake(hass: HomeAssistant) -> None:
    """The ordinary case still sends one notification for the new quake."""
    title = _notification(hass, _sensor([OLDER]), _sensor([NEWEST, OLDER]))

    assert title == "New Earthquake - M4.0 near Corfu"


async def test_withdrawn_newest_quake_does_not_reannounce_the_previous_one(
    hass: HomeAssistant,
) -> None:
    """The time attribute changes back to the older quake, which used to pass as new."""
    title = _notification(hass, _sensor([NEWEST, OLDER]), _sensor([OLDER]))

    assert title is None


async def test_strong_older_quake_in_the_same_poll_is_not_missed(
    hass: HomeAssistant,
) -> None:
    """Two new quakes in one poll: only the newest (M3.1) was checked against the minimum."""
    weak_newest = _quake("c", 3.1, "2026-11-15T10:05:00+00:00", "Corfu")
    strong = _quake("d", 5.5, "2026-11-15T10:01:00+00:00", "Paxos")

    title = _notification(
        hass, _sensor([OLDER]), _sensor([weak_newest, strong, OLDER]), min_magnitude=5
    )

    assert title == "New Earthquake - M5.5 near Paxos"
