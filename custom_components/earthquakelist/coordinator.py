"""Data update coordinator for the Earthquake List integration."""

from __future__ import annotations

import logging
from datetime import timedelta

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed

from .api import EarthquakeListAPI, EarthquakeListApiError
from .const import (
    CONF_GEO_ID,
    CONF_GEO_TYPE,
    CONF_MAX_DISTANCE,
    CONF_MIN_MAGNITUDE,
    CONF_PLACE,
    DEFAULT_MAX_DISTANCE,
    DEFAULT_MIN_MAGNITUDE,
    DOMAIN,
)
from .parser import EarthquakeData

# Each entry keeps its own coordinator on the entry itself. Home Assistant drops
# runtime_data when the entry unloads, so there is no per-entry bookkeeping left
# in hass.data to clean up.
type EarthquakeConfigEntry = ConfigEntry[EarthquakeListCoordinator]

SCAN_INTERVAL = timedelta(minutes=15)
# The package logger, not this module's: the coordinator logged through it while
# it lived in __init__.py, and a logger filter a user set up for
# custom_components.earthquakelist would not apply to a child logger's records.
_LOGGER = logging.getLogger(__package__)


def coordinator_name(entry: ConfigEntry) -> str:
    """Name the coordinator after the monitored place.

    The name is what Home Assistant prints in "Error fetching <name> data", so
    an opaque entry id there tells the user nothing about which of their
    locations stopped updating.
    """
    place = entry.data.get(CONF_PLACE) or entry.title or entry.entry_id
    return f"{DOMAIN} {place}"


class EarthquakeListCoordinator(DataUpdateCoordinator[list[EarthquakeData]]):
    """Fetch the latest earthquakes for one configured location."""

    config_entry: EarthquakeConfigEntry

    def __init__(
        self,
        hass: HomeAssistant,
        entry: EarthquakeConfigEntry,
        api: EarthquakeListAPI,
    ) -> None:
        """Initialize the coordinator for a config entry."""
        super().__init__(
            hass,
            _LOGGER,
            config_entry=entry,
            name=coordinator_name(entry),
            update_interval=SCAN_INTERVAL,
        )
        self.api = api
        self._geo_type = entry.data[CONF_GEO_TYPE]
        self._geo_id = entry.data[CONF_GEO_ID]

    async def _async_update_data(self) -> list[EarthquakeData]:
        """Fetch the latest earthquake for the configured location.

        api.py deliberately stays quiet about communication failures, so
        translating EarthquakeListApiError into UpdateFailed here is the only
        thing that surfaces an outage at all.
        """
        entry = self.config_entry
        min_magnitude = entry.options.get(
            CONF_MIN_MAGNITUDE,
            entry.data.get(CONF_MIN_MAGNITUDE, DEFAULT_MIN_MAGNITUDE),
        )
        max_distance = entry.options.get(
            CONF_MAX_DISTANCE,
            entry.data.get(CONF_MAX_DISTANCE, DEFAULT_MAX_DISTANCE),
        )

        try:
            return await self.api.get_earthquakes(
                self._geo_type, self._geo_id, min_magnitude, max_distance
            )
        except EarthquakeListApiError as err:
            raise UpdateFailed(str(err)) from err
