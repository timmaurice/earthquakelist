"""Tests for the config entry setup in __init__.py."""

from __future__ import annotations

from importlib import import_module
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from pytest_homeassistant_custom_component.common import MockConfigEntry

from homeassistant.config_entries import ConfigEntryState

from custom_components.earthquakelist import PLATFORMS
from custom_components.earthquakelist.const import DOMAIN
from custom_components.earthquakelist.coordinator import (
    SCAN_INTERVAL,
    EarthquakeListCoordinator,
)
from custom_components.earthquakelist.parser import EarthquakeData


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


@pytest.mark.parametrize("platform", PLATFORMS, ids=str)
def test_every_platform_leaves_updates_unthrottled(platform) -> None:
    """The coordinator fetches; the entities only read its data.

    The parallel-updates quality-scale rule asks every platform to state its
    limit rather than leave it to Home Assistant's default. A platform added
    later has to make that call too, so this covers all of PLATFORMS.
    """
    module = import_module(f"custom_components.earthquakelist.{platform}")

    assert module.PARALLEL_UPDATES == 0


async def test_the_coordinator_lives_on_the_entry(
    hass, enable_custom_integrations
) -> None:
    """Setup hands the coordinator to the platforms through runtime_data.

    Nothing per entry goes into hass.data any more, so an unload has nothing to
    pop there either - Home Assistant drops runtime_data itself.
    """
    entry = MockConfigEntry(
        domain=DOMAIN,
        title="Corfu Earthquakes",
        unique_id="place_2042",
        data=_entry().data,
    )
    entry.add_to_hass(hass)
    quake = EarthquakeData(id="42", magnitude=5.6, place_name="Corfu")

    with (
        # async_setup only registers the card; it and the http dependency it
        # pulls in are not what this test is about.
        patch("custom_components.earthquakelist.async_setup", return_value=True),
        patch("homeassistant.setup.async_process_deps_reqs"),
        patch(
            "custom_components.earthquakelist.EarthquakeListAPI.get_earthquakes",
            AsyncMock(return_value=[quake]),
        ),
    ):
        assert await hass.config_entries.async_setup(entry.entry_id)
        await hass.async_block_till_done()

    assert entry.state is ConfigEntryState.LOADED
    assert entry.runtime_data.data == [quake]
    assert DOMAIN not in hass.data
    assert (
        hass.states.get("sensor.earthquakelist_corfu_latest_earthquake").state == "5.6"
    )

    assert await hass.config_entries.async_unload(entry.entry_id)
    await hass.async_block_till_done()

    assert entry.state is ConfigEntryState.NOT_LOADED
    assert not hasattr(entry, "runtime_data")
    assert DOMAIN not in hass.data


async def test_runtime_data_holds_the_coordinator_class(
    hass, enable_custom_integrations
) -> None:
    """Setup stores an EarthquakeListCoordinator bound to its own entry.

    The platforms and diagnostics read entry.runtime_data as that class, so a
    plain DataUpdateCoordinator slipping back in would lose the typed
    config_entry and the update logic that lives on the class.
    """
    entry = MockConfigEntry(
        domain=DOMAIN,
        title="Corfu Earthquakes",
        unique_id="place_2042",
        data=_entry().data,
    )
    entry.add_to_hass(hass)

    with (
        patch("custom_components.earthquakelist.async_setup", return_value=True),
        patch("homeassistant.setup.async_process_deps_reqs"),
        patch(
            "custom_components.earthquakelist.EarthquakeListAPI.get_earthquakes",
            AsyncMock(return_value=[]),
        ),
    ):
        assert await hass.config_entries.async_setup(entry.entry_id)
        await hass.async_block_till_done()

    coordinator = entry.runtime_data
    assert isinstance(coordinator, EarthquakeListCoordinator)
    assert coordinator.config_entry is entry
    assert coordinator.update_interval == SCAN_INTERVAL
