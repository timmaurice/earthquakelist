"""Tests for the diagnostics platform."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest

from custom_components.earthquakelist.const import DOMAIN
from custom_components.earthquakelist.diagnostics import (
    async_get_config_entry_diagnostics,
)
from custom_components.earthquakelist.parser import EarthquakeData

pytestmark = pytest.mark.asyncio


def _entry() -> SimpleNamespace:
    return SimpleNamespace(
        entry_id="abc123",
        title="Corfu Earthquakes",
        unique_id="place_2042",
        version=1,
        data={"geo_type": "place", "geo_id": "2042", "place": "Corfu"},
        options={"min_magnitude": 3.0, "max_distance": 50},
    )


async def test_diagnostics_include_the_entry_and_the_coordinator_data() -> None:
    """A bug report needs the filter that was used and what came back for it."""
    entry = _entry()
    earthquake = EarthquakeData(
        id="42",
        magnitude=5.6,
        time=datetime(2026, 6, 12, 4, 42, 8, tzinfo=UTC),
        place_name="Corfu",
    )
    coordinator = SimpleNamespace(
        data=[earthquake],
        last_update_success=True,
        update_interval=timedelta(minutes=15),
    )
    hass = SimpleNamespace(data={DOMAIN: {entry.entry_id: coordinator}})

    result = await async_get_config_entry_diagnostics(hass, entry)

    assert result["entry"]["unique_id"] == "place_2042"
    assert result["entry"]["data"]["geo_id"] == "2042"
    assert result["entry"]["options"]["min_magnitude"] == 3.0
    assert result["coordinator"]["last_update_success"] is True
    assert result["coordinator"]["earthquake_count"] == 1
    assert result["coordinator"]["earthquakes"][0]["magnitude"] == 5.6
    # Serialized for JSON, not handed over as a datetime.
    assert (
        result["coordinator"]["earthquakes"][0]["time"] == "2026-06-12T04:42:08+00:00"
    )


async def test_diagnostics_without_a_loaded_coordinator() -> None:
    """Downloading diagnostics for an entry that failed to set up must not raise."""
    entry = _entry()
    hass = SimpleNamespace(data={})

    result = await async_get_config_entry_diagnostics(hass, entry)

    assert result["coordinator"] is None
    assert result["entry"]["title"] == "Corfu Earthquakes"
