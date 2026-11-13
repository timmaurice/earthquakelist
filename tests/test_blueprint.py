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


def _trigger(attributes: dict) -> dict:
    """A state trigger as the sensor produces it: absent attributes are omitted."""
    base = {"place": "Corfu", "time": "2026-11-02T00:00:00+00:00"}
    return {
        "to_state": State(
            "sensor.earthquakelist_corfu_latest_earthquake",
            "3.6",
            {**base, **attributes},
        )
    }


def _render(hass: HomeAssistant, template: str, variables: dict):
    return Template(template, hass).async_render(variables)


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
    variables = _blueprint()["variables"]

    is_tsunami = _render(
        hass, variables["is_tsunami"], {"trigger": _trigger(attributes)}
    )

    assert is_tsunami is expected
    title = _render(
        hass,
        variables["title"],
        {"is_tsunami": is_tsunami, "magnitude": "3.6", "place": "Corfu"},
    )
    assert title.startswith("Tsunami Alert" if expected else "New Earthquake")


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
