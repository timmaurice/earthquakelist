"""Diagnostics support for the Earthquake List integration."""

from __future__ import annotations

from typing import Any

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant

from .const import DOMAIN
from .sensor import _earthquake_to_dict


async def async_get_config_entry_diagnostics(
    hass: HomeAssistant, entry: ConfigEntry
) -> dict[str, Any]:
    """Return diagnostics for a config entry.

    Nothing here is a secret: the entry holds a geo type/id and a filter, and the
    coordinator holds public earthquake records - which is exactly what a bug
    report about a stale or empty sensor needs.
    """
    coordinator = hass.data.get(DOMAIN, {}).get(entry.entry_id)

    diagnostics: dict[str, Any] = {
        "entry": {
            "title": entry.title,
            "unique_id": entry.unique_id,
            "version": entry.version,
            "data": dict(entry.data),
            "options": dict(entry.options),
        },
    }

    if coordinator is None:
        diagnostics["coordinator"] = None
        return diagnostics

    earthquakes = coordinator.data or []
    diagnostics["coordinator"] = {
        "last_update_success": coordinator.last_update_success,
        "update_interval": str(coordinator.update_interval),
        "earthquake_count": len(earthquakes),
        "earthquakes": [_earthquake_to_dict(quake) for quake in earthquakes],
    }
    return diagnostics
