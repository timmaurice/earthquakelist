"""Config flow for the Earthquake List integration."""

from __future__ import annotations

import logging
from typing import Any

import voluptuous as vol
from homeassistant import config_entries
from homeassistant.core import callback
from homeassistant.data_entry_flow import FlowResult
from homeassistant.helpers import selector

from .api import EarthquakeListAPI
from .const import (
    CONF_COUNTRY_CODE,
    CONF_GEO_ID,
    CONF_GEO_TYPE,
    CONF_MAX_DISTANCE,
    CONF_MIN_MAGNITUDE,
    CONF_PLACE,
    DEFAULT_MAX_DISTANCE,
    DEFAULT_MIN_MAGNITUDE,
    DOMAIN,
)
from .parser import SearchResult

_LOGGER = logging.getLogger(__name__)

MIN_MAGNITUDE_SELECTOR = selector.NumberSelector(
    selector.NumberSelectorConfig(
        min=0, max=10, step=0.1, mode=selector.NumberSelectorMode.BOX
    )
)
MAX_DISTANCE_SELECTOR = selector.NumberSelector(
    selector.NumberSelectorConfig(
        min=1,
        # Distance is measured from a single reference point within the
        # monitored place/region/country, not from its edges — a large country
        # can need a distance far beyond a "place" filter's typical range to
        # still match earthquakes near its far side.
        max=20000,
        step=1,
        mode=selector.NumberSelectorMode.BOX,
        unit_of_measurement="km",
    )
)


class EarthquakeListConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Handle a config flow for Earthquake List."""

    VERSION = 1

    def __init__(self) -> None:
        """Initialize the config flow."""
        self._results: dict[str, SearchResult] = {}

    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> FlowResult:
        """Handle the location search step."""
        errors: dict[str, str] = {}

        if user_input is not None:
            api = EarthquakeListAPI(self.hass)
            results = await api.search_locations(user_input["query"])

            if results is None:
                errors["base"] = "cannot_connect"
            elif not results:
                errors["base"] = "no_results"
            else:
                self._results = {}
                for result in results:
                    label = (
                        f"{result.name} ({result.description})"
                        if result.description
                        else result.name
                    )
                    self._results[label] = result
                return await self.async_step_select()

        return self.async_show_form(
            step_id="user",
            data_schema=vol.Schema({vol.Required("query"): str}),
            errors=errors,
        )

    async def async_step_select(
        self, user_input: dict[str, Any] | None = None
    ) -> FlowResult:
        """Handle place selection and the earthquake filter criteria."""
        errors: dict[str, str] = {}

        if user_input is not None:
            result = self._results.get(user_input[CONF_PLACE])

            if result is None:
                errors[CONF_PLACE] = "invalid_place"
            else:
                await self.async_set_unique_id(f"{result.geo_type}_{result.geo_id}")
                self._abort_if_unique_id_configured()

                return self.async_create_entry(
                    title=f"{result.name} Earthquakes",
                    data={
                        CONF_GEO_TYPE: result.geo_type,
                        CONF_GEO_ID: result.geo_id,
                        CONF_PLACE: result.name,
                        CONF_COUNTRY_CODE: result.country_code or "",
                        CONF_MIN_MAGNITUDE: user_input[CONF_MIN_MAGNITUDE],
                        CONF_MAX_DISTANCE: round(user_input[CONF_MAX_DISTANCE]),
                    },
                )

        data_schema = vol.Schema(
            {
                vol.Required(CONF_PLACE): selector.SelectSelector(
                    selector.SelectSelectorConfig(
                        # custom_value renders a searchable combo box instead of a
                        # plain dropdown/radio list; the "Add custom item" option it
                        # exposes is rejected above via the invalid_place error.
                        options=list(self._results.keys()),
                        mode=selector.SelectSelectorMode.DROPDOWN,
                        custom_value=True,
                    )
                ),
                vol.Optional(
                    CONF_MIN_MAGNITUDE, default=DEFAULT_MIN_MAGNITUDE
                ): MIN_MAGNITUDE_SELECTOR,
                vol.Optional(
                    CONF_MAX_DISTANCE, default=DEFAULT_MAX_DISTANCE
                ): MAX_DISTANCE_SELECTOR,
            }
        )

        return self.async_show_form(
            step_id="select",
            data_schema=data_schema,
            errors=errors,
            last_step=True,
        )

    @staticmethod
    @callback
    def async_get_options_flow(
        config_entry: config_entries.ConfigEntry,
    ) -> EarthquakeListOptionsFlow:
        """Get the options flow for this handler."""
        return EarthquakeListOptionsFlow()


class EarthquakeListOptionsFlow(config_entries.OptionsFlow):
    """Handle options for an existing Earthquake List entry."""

    async def async_step_init(
        self, user_input: dict[str, Any] | None = None
    ) -> FlowResult:
        """Manage the earthquake filter options."""
        if user_input is not None:
            return self.async_create_entry(
                data={
                    CONF_MIN_MAGNITUDE: user_input[CONF_MIN_MAGNITUDE],
                    CONF_MAX_DISTANCE: round(user_input[CONF_MAX_DISTANCE]),
                }
            )

        current_min_magnitude = self.config_entry.options.get(
            CONF_MIN_MAGNITUDE,
            self.config_entry.data.get(CONF_MIN_MAGNITUDE, DEFAULT_MIN_MAGNITUDE),
        )
        current_max_distance = self.config_entry.options.get(
            CONF_MAX_DISTANCE,
            self.config_entry.data.get(CONF_MAX_DISTANCE, DEFAULT_MAX_DISTANCE),
        )

        data_schema = vol.Schema(
            {
                vol.Optional(
                    CONF_MIN_MAGNITUDE, default=current_min_magnitude
                ): MIN_MAGNITUDE_SELECTOR,
                vol.Optional(
                    CONF_MAX_DISTANCE, default=current_max_distance
                ): MAX_DISTANCE_SELECTOR,
            }
        )

        return self.async_show_form(step_id="init", data_schema=data_schema)
