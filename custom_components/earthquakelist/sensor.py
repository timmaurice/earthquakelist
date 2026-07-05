"""Sensor platform for the Earthquake List integration."""

from __future__ import annotations

import logging
from dataclasses import dataclass

from homeassistant.components.sensor import (
    SensorEntity,
    SensorEntityDescription,
    SensorStateClass,
)
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.update_coordinator import (
    CoordinatorEntity,
    DataUpdateCoordinator,
)
from homeassistant.util import slugify

from .const import (
    BASE_URL,
    CONF_MAX_DISTANCE,
    CONF_MIN_MAGNITUDE,
    CONF_PLACE,
    DOMAIN,
)
from .parser import EarthquakeData

_LOGGER = logging.getLogger(__name__)


def _earthquake_to_dict(earthquake: EarthquakeData) -> dict[str, object]:
    """Convert an EarthquakeData record into a JSON-friendly dict for the card."""
    return {
        "id": earthquake.id,
        "magnitude": earthquake.magnitude,
        "time": earthquake.time.isoformat() if earthquake.time else None,
        "place": earthquake.place_name,
        "location": earthquake.location_text,
        "latitude": earthquake.location_lat,
        "longitude": earthquake.location_lng,
        "depth_km": earthquake.depth_km,
        "distance_km": earthquake.distance_km,
        "direction": earthquake.direction,
        "alert_level": earthquake.alert_level,
        "alert_tsunami": earthquake.alert_tsunami,
    }


@dataclass(frozen=True, kw_only=True)
class EarthquakeListSensorEntityDescription(SensorEntityDescription):
    """Class describing Earthquake List sensor entities."""


SENSOR_DESCRIPTION = EarthquakeListSensorEntityDescription(
    key="latest_earthquake",
    name="Latest Earthquake",
    icon="mdi:pulse",
    state_class=SensorStateClass.MEASUREMENT,
)


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up the Earthquake List sensor entry."""
    coordinator = hass.data[DOMAIN][entry.entry_id]

    async_add_entities([EarthquakeListSensor(coordinator, entry, SENSOR_DESCRIPTION)])


class EarthquakeListSensor(CoordinatorEntity, SensorEntity):
    """Representation of the latest matching earthquake for a monitored location."""

    _attr_has_entity_name = True

    def __init__(
        self,
        coordinator: DataUpdateCoordinator,
        entry: ConfigEntry,
        description: EarthquakeListSensorEntityDescription,
    ) -> None:
        """Initialize the sensor."""
        super().__init__(coordinator)
        self.entity_description = description
        self._entry = entry
        self._place_name = entry.data.get(CONF_PLACE, "Unknown")

        place_slug = slugify(self._place_name)
        self._attr_unique_id = f"{DOMAIN}_{entry.entry_id}_{description.key}"
        self.entity_id = f"sensor.{DOMAIN}_{place_slug}_{description.key}"

    @property
    def native_value(self) -> float | None:
        """Return the magnitude of the latest matching earthquake."""
        earthquakes = self.coordinator.data
        if not earthquakes:
            return None
        return earthquakes[0].magnitude

    @property
    def extra_state_attributes(self) -> dict[str, object] | None:
        """Return the state attributes."""
        earthquakes = self.coordinator.data
        if not earthquakes:
            return None

        earthquake = earthquakes[0]
        attrs = {
            "place": earthquake.place_name,
            "location": earthquake.location_text,
            "time": earthquake.time.isoformat() if earthquake.time else None,
            "depth_km": earthquake.depth_km,
            "distance_km": earthquake.distance_km,
            "direction": earthquake.direction,
            "latitude": earthquake.location_lat,
            "longitude": earthquake.location_lng,
            "alert_level": earthquake.alert_level,
            "alert_tsunami": earthquake.alert_tsunami,
            "mmi": earthquake.mmi,
            "felt": earthquake.felt,
            "significance": earthquake.significance,
            "usgs_code": earthquake.usgs_code,
            "news_link": earthquake.news_link,
            "monitored_place": self._place_name,
            "min_magnitude": self._entry.options.get(
                CONF_MIN_MAGNITUDE, self._entry.data.get(CONF_MIN_MAGNITUDE)
            ),
            "max_distance": self._entry.options.get(
                CONF_MAX_DISTANCE, self._entry.data.get(CONF_MAX_DISTANCE)
            ),
            "earthquakes": [_earthquake_to_dict(eq) for eq in earthquakes],
        }
        return {key: value for key, value in attrs.items() if value is not None}

    @property
    def device_info(self):
        """Return device information."""
        return {
            "identifiers": {(DOMAIN, self._entry.entry_id)},
            "name": self._place_name,
            "manufacturer": "Earthquake List",
            "model": "Earthquake Monitor",
            "configuration_url": BASE_URL,
        }
