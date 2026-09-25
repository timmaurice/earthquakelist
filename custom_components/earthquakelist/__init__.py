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
    CONF_PLACE,
    DEFAULT_MAX_DISTANCE,
    DEFAULT_MIN_MAGNITUDE,
    DOMAIN,
)
from .parser import EarthquakeData

# Each entry keeps its own coordinator on the entry itself. Home Assistant drops
# runtime_data when the entry unloads, so there is no per-entry bookkeeping left
# in hass.data to clean up.
type EarthquakeListCoordinator = DataUpdateCoordinator[list[EarthquakeData]]
type EarthquakeConfigEntry = ConfigEntry[EarthquakeListCoordinator]

PLATFORMS = [Platform.SENSOR]
SCAN_INTERVAL = timedelta(minutes=15)
_LOGGER = logging.getLogger(__name__)

CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)

CARD_FILENAME = "earthquakelist-card.js"
CARD_URL_BASE = "/earthquakelist_frontend"


async def _async_reconcile_card_resource(resources, new_url: str) -> None:
    """Leave exactly one Lovelace resource pointing at the bundled card.

    The resource store is loaded lazily: until something awaits it, async_items()
    returns an empty list. Registering off that empty list appended a second
    resource on every restart, and the browser then loaded the bundle twice,
    which made the second copy fail on an already registered element name.
    """
    # Default to False, not True: assuming a collection we cannot recognise is
    # already loaded would let us register against an empty item list and save
    # a store that has lost every other card's resource. Missing async_load
    # raises instead, and the caller skips registration.
    if not getattr(resources, "loaded", False):
        await resources.async_load()
        resources.loaded = True

    own = [
        item
        for item in resources.async_items()
        if item.get("url", "").startswith(f"{CARD_URL_BASE}/")
    ]

    if not own:
        _LOGGER.info("Registering lovelace resource: %s", new_url)
        await resources.async_create_item({"res_type": "module", "url": new_url})
        return

    for duplicate in own[1:]:
        _LOGGER.info("Removing duplicate lovelace resource %s", duplicate.get("url"))
        await resources.async_delete_item(duplicate.get("id"))

    if own[0].get("url") != new_url:
        _LOGGER.debug("Updating lovelace resource URL to %s", new_url)
        await resources.async_update_item(own[0].get("id"), {"url": new_url})


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

        try:
            await _async_reconcile_card_resource(resources, new_url)
        except Exception as err:  # noqa: BLE001 - never let bookkeeping break setup
            _LOGGER.warning("Failed to register lovelace resource: %s", err)

    if hass.state == CoreState.running:
        hass.async_create_task(_async_register_lovelace_resource())
    else:
        hass.bus.async_listen_once(
            EVENT_HOMEASSISTANT_STARTED, _async_register_lovelace_resource
        )

    return True


def coordinator_name(entry: ConfigEntry) -> str:
    """Name the coordinator after the monitored place.

    The name is what Home Assistant prints in "Error fetching <name> data", so
    an opaque entry id there tells the user nothing about which of their
    locations stopped updating.
    """
    place = entry.data.get(CONF_PLACE) or entry.title or entry.entry_id
    return f"{DOMAIN} {place}"


def build_update_method(api: EarthquakeListAPI, entry: ConfigEntry):
    """Build the coordinator's fetch callback.

    A module-level factory rather than a closure inside async_setup_entry so the
    failure path stays directly testable: api.py deliberately stays quiet about
    communication failures, so translating EarthquakeListApiError into
    UpdateFailed here is the only thing that surfaces an outage at all.
    """
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

    return async_update_data


async def async_setup_entry(hass: HomeAssistant, entry: EarthquakeConfigEntry) -> bool:
    """Set up Earthquake List from a config entry."""
    api = EarthquakeListAPI(hass)

    coordinator = DataUpdateCoordinator(
        hass,
        _LOGGER,
        name=coordinator_name(entry),
        update_method=build_update_method(api, entry),
        update_interval=SCAN_INTERVAL,
    )

    await coordinator.async_config_entry_first_refresh()

    entry.runtime_data = coordinator

    entry.async_on_unload(entry.add_update_listener(_async_update_listener))

    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)

    return True


async def _async_update_listener(
    hass: HomeAssistant, entry: EarthquakeConfigEntry
) -> None:
    """Reload the entry when options are updated."""
    await hass.config_entries.async_reload(entry.entry_id)


async def async_unload_entry(hass: HomeAssistant, entry: EarthquakeConfigEntry) -> bool:
    """Unload a config entry."""
    return await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
