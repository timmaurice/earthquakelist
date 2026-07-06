"""The Earthquake List integration."""

from __future__ import annotations

import logging
from datetime import timedelta

from homeassistant.config_entries import ConfigEntry
from homeassistant.const import Platform
from homeassistant.core import HomeAssistant
import homeassistant.helpers.config_validation as cv
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed

from .api import EarthquakeListAPI, EarthquakeListApiError
from .const import (
    CONF_GEO_ID,
    CONF_GEO_TYPE,
    CONF_MAX_DISTANCE,
    CONF_MIN_MAGNITUDE,
    DEFAULT_MAX_DISTANCE,
    DEFAULT_MIN_MAGNITUDE,
    DOMAIN,
)

PLATFORMS = [Platform.SENSOR]
SCAN_INTERVAL = timedelta(minutes=15)
_LOGGER = logging.getLogger(__name__)

CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)

CARD_FILENAME = "earthquakelist-card.js"
CARD_URL_BASE = "/earthquakelist_frontend"


async def async_setup(hass: HomeAssistant, config: dict) -> bool:
    """Set up the Earthquake List component and register the Lovelace card."""
    from homeassistant.components.http import StaticPathConfig
    from homeassistant.const import EVENT_HOMEASSISTANT_STARTED
    from homeassistant.core import CoreState
    from homeassistant.loader import async_get_integration

    integration = await async_get_integration(hass, DOMAIN)
    version = integration.version or "1.0.0"

    await hass.http.async_register_static_paths(
        [
            StaticPathConfig(
                url_path=f"{CARD_URL_BASE}/{CARD_FILENAME}",
                path=hass.config.path(f"custom_components/{DOMAIN}/{CARD_FILENAME}"),
                cache_headers=True,
            )
        ]
    )
    new_url = f"{CARD_URL_BASE}/{CARD_FILENAME}?v={version}"

    async def _async_register_lovelace_resource(event=None):
        if "lovelace" not in hass.data:
            _LOGGER.warning("Lovelace not found in hass.data")
            return

        lovelace_data = hass.data["lovelace"]
        mode = getattr(lovelace_data, "resource_mode", "storage")
        resources = getattr(lovelace_data, "resources", None)

        if not resources:
            _LOGGER.warning("Lovelace data does not have resources")
            return

        if mode != "storage":
            _LOGGER.warning(
                "Lovelace is not in storage mode (mode is '%s'), cannot auto-register",
                mode,
            )
            return

        for item in resources.async_items():
            if item.get("url", "").startswith(f"{CARD_URL_BASE}/"):
                if item.get("url") != new_url:
                    await resources.async_update_item(item.get("id"), {"url": new_url})
                return

        try:
            await resources.async_create_item({"res_type": "module", "url": new_url})
        except Exception as err:
            _LOGGER.warning("Failed to register lovelace resource: %s", err)

    if hass.state == CoreState.running:
        hass.async_create_task(_async_register_lovelace_resource())
    else:
        hass.bus.async_listen_once(
            EVENT_HOMEASSISTANT_STARTED, _async_register_lovelace_resource
        )

    return True


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up Earthquake List from a config entry."""
    hass.data.setdefault(DOMAIN, {})

    api = EarthquakeListAPI(hass)
    geo_type = entry.data[CONF_GEO_TYPE]
    geo_id = entry.data[CONF_GEO_ID]

    async def async_update_data():
        """Fetch the latest earthquake for the configured location."""
        min_magnitude = entry.options.get(
            CONF_MIN_MAGNITUDE,
            entry.data.get(CONF_MIN_MAGNITUDE, DEFAULT_MIN_MAGNITUDE),
        )
        max_distance = entry.options.get(
            CONF_MAX_DISTANCE,
            entry.data.get(CONF_MAX_DISTANCE, DEFAULT_MAX_DISTANCE),
        )

        try:
            return await api.get_earthquakes(
                geo_type, geo_id, min_magnitude, max_distance
            )
        except EarthquakeListApiError as err:
            raise UpdateFailed(str(err)) from err

    coordinator = DataUpdateCoordinator(
        hass,
        _LOGGER,
        name=f"earthquakelist_{entry.entry_id}",
        update_method=async_update_data,
        update_interval=SCAN_INTERVAL,
    )

    await coordinator.async_config_entry_first_refresh()

    hass.data[DOMAIN][entry.entry_id] = coordinator

    entry.async_on_unload(entry.add_update_listener(_async_update_listener))

    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)

    return True


async def _async_update_listener(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Reload the entry when options are updated."""
    await hass.config_entries.async_reload(entry.entry_id)


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload a config entry."""
    if unload_ok := await hass.config_entries.async_unload_platforms(entry, PLATFORMS):
        hass.data[DOMAIN].pop(entry.entry_id)

    return unload_ok
