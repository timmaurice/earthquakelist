"""Tests for the data update coordinator in coordinator.py."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from pytest_homeassistant_custom_component.common import MockConfigEntry

from homeassistant.helpers.update_coordinator import UpdateFailed

from custom_components.earthquakelist.api import EarthquakeListApiError
from custom_components.earthquakelist.const import DOMAIN
from custom_components.earthquakelist.coordinator import (
    EarthquakeListCoordinator,
    coordinator_name,
)


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


def _coordinator(hass, api, **overrides) -> EarthquakeListCoordinator:
    stub = _entry(**overrides)
    entry = MockConfigEntry(
        domain=DOMAIN,
        title=stub.title,
        data=stub.data,
        options=stub.options,
    )
    return EarthquakeListCoordinator(hass, entry, api)


async def test_a_communication_failure_is_reported_as_update_failed(hass) -> None:
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

    coordinator = _coordinator(hass, api)

    with pytest.raises(UpdateFailed, match="boom") as excinfo:
        await coordinator._async_update_data()

    # The original error stays attached, so the debug log still shows the cause.
    assert isinstance(excinfo.value.__cause__, EarthquakeListApiError)


async def test_a_successful_fetch_uses_the_current_filter_options(hass) -> None:
    """Options set through the options flow win over the values from setup."""
    api = SimpleNamespace(get_earthquakes=AsyncMock(return_value=["quake"]))

    coordinator = _coordinator(
        hass, api, options={"min_magnitude": 4.5, "max_distance": 200}
    )

    assert await coordinator._async_update_data() == ["quake"]
    api.get_earthquakes.assert_awaited_once_with("place", "2042", 4.5, 200)


async def test_an_empty_result_is_not_a_failure(hass) -> None:
    """No earthquake matched the filter is a normal state, not an outage."""
    api = SimpleNamespace(get_earthquakes=AsyncMock(return_value=[]))

    assert await _coordinator(hass, api)._async_update_data() == []


def test_the_coordinator_is_named_after_the_place() -> None:
    """The `Error fetching <name> data` line must name something the user can act on."""
    assert coordinator_name(_entry()) == "earthquakelist Corfu"


def test_the_coordinator_name_falls_back_to_the_entry_title() -> None:
    """An entry written before CONF_PLACE existed still gets a readable name."""
    entry = _entry()
    del entry.data["place"]

    assert coordinator_name(entry) == "earthquakelist Corfu Earthquakes"
