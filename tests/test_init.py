"""Tests for the coordinator wiring in __init__.py."""

from __future__ import annotations

from importlib import import_module
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from pytest_homeassistant_custom_component.common import MockConfigEntry

from homeassistant.config_entries import ConfigEntryState
from homeassistant.helpers.update_coordinator import UpdateFailed

from custom_components.earthquakelist import (
    PLATFORMS,
    build_update_method,
    coordinator_name,
)
from custom_components.earthquakelist.api import EarthquakeListApiError
from custom_components.earthquakelist.const import DOMAIN
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
