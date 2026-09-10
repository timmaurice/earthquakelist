"""Tests for the coordinator wiring in __init__.py."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from homeassistant.helpers.update_coordinator import UpdateFailed

from custom_components.earthquakelist import build_update_method, coordinator_name
from custom_components.earthquakelist.api import EarthquakeListApiError


def _entry(**overrides) -> SimpleNamespace:
    data = {
        "geo_type": "place",
        "geo_id": "2042",
        "place": "Corfu",
        "min_magnitude": 3.0,
        "max_distance": 50,
    }
    data.update(overrides.pop("data", {}))
    return SimpleNamespace(
        entry_id="abc123",
        title="Corfu Earthquakes",
        data=data,
        options=overrides.pop("options", {}),
    )


async def test_a_communication_failure_is_reported_as_update_failed() -> None:
    """The only thing that surfaces an outage at all.

    api.py deliberately does not log communication failures any more, so if this
    translation ever disappears the integration goes completely silent: the
    coordinator would raise a bare exception nobody maps to "unavailable", and
    the user would keep seeing a stale magnitude with no error line anywhere.
    """
    api = SimpleNamespace(
        get_earthquakes=AsyncMock(
            side_effect=EarthquakeListApiError(
                "Error communicating with earthquakelist.org: boom"
            )
        )
    )

    update = build_update_method(api, _entry())

    with pytest.raises(UpdateFailed, match="boom") as excinfo:
        await update()

    # The original error stays attached, so the debug log still shows the cause.
    assert isinstance(excinfo.value.__cause__, EarthquakeListApiError)


async def test_a_successful_fetch_uses_the_current_filter_options() -> None:
    """Options set through the options flow win over the values from setup."""
    api = SimpleNamespace(get_earthquakes=AsyncMock(return_value=["quake"]))

    update = build_update_method(
        api, _entry(options={"min_magnitude": 4.5, "max_distance": 200})
    )

    assert await update() == ["quake"]
    api.get_earthquakes.assert_awaited_once_with("place", "2042", 4.5, 200)


async def test_an_empty_result_is_not_a_failure() -> None:
    """No earthquake matched the filter is a normal state, not an outage."""
    api = SimpleNamespace(get_earthquakes=AsyncMock(return_value=[]))

    assert await build_update_method(api, _entry())() == []


def test_the_coordinator_is_named_after_the_place() -> None:
    """The `Error fetching <name> data` line must name something the user can act on."""
    assert coordinator_name(_entry()) == "earthquakelist Corfu"


def test_the_coordinator_name_falls_back_to_the_entry_title() -> None:
    """An entry written before CONF_PLACE existed still gets a readable name."""
    entry = _entry()
    del entry.data["place"]

    assert coordinator_name(entry) == "earthquakelist Corfu Earthquakes"
