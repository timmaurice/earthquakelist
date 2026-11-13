"""API client for earthquakelist.org."""

from __future__ import annotations

import logging
import math
from typing import Any

import aiohttp

from homeassistant.core import HomeAssistant
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .const import API_URL, DEFAULT_HISTORY_LIMIT, DEFAULT_ORDER, DEFAULT_USER_AGENT
from .parser import (
    EarthquakeData,
    SearchResult,
    parse_earthquakes,
    parse_search_results,
)

_LOGGER = logging.getLogger(__name__)

# The API is a small JSON endpoint; without an explicit timeout a hung connection
# would stall a poll until whatever the shared session happens to default to.
REQUEST_TIMEOUT = aiohttp.ClientTimeout(total=15)
# The largest `limit` the API honours; anything above it falls back to 10.
MAX_UPSTREAM_LIMIT = 50


class EarthquakeListApiError(Exception):
    """Raised when the earthquakelist.org API cannot be reached or fails."""


class EarthquakeListAPI:
    """API client for earthquakelist.org."""

    def __init__(self, hass: HomeAssistant) -> None:
        """Initialize the API client."""
        self.hass = hass
        self._headers = {"User-Agent": DEFAULT_USER_AGENT}

    async def search_locations(self, query: str) -> list[SearchResult] | None:
        """Search for places, regions or countries by name.

        Returns an empty list when the search yields no matches, and
        None when the request itself failed.
        """
        query = query.strip()
        if not query:
            return []

        try:
            payload = await self._request({"action": "search", "query": query})
        except EarthquakeListApiError as err:
            # The config flow turns None into its cannot_connect error and shows it
            # to the user, so there is nothing to log at error level here.
            _LOGGER.debug("Location search failed: %s", err)
            return None

        return parse_search_results(payload.get("data"))

    async def get_earthquakes(
        self,
        geo_type: str,
        geo_id: str,
        min_magnitude: float,
        max_distance: int,
        limit: int = DEFAULT_HISTORY_LIMIT,
    ) -> list[EarthquakeData]:
        """Fetch the most recent earthquakes matching the given criteria.

        Returns an empty list when the request succeeded but no earthquake
        matched the filter. Raises EarthquakeListApiError on a communication
        failure. Results are ordered latest first.

        The API truncates `min_magnitude` to an integer (3.5 behaves like 3), so
        a fractional filter is sent rounded down and applied here instead. The
        request then asks for more results than needed, so the list is not left
        short once the quakes below the filter are dropped.
        """
        upstream_min_magnitude = math.floor(min_magnitude)
        filter_locally = upstream_min_magnitude != min_magnitude

        payload = await self._request(
            {
                "action": "earthquakes",
                "limit": str(MAX_UPSTREAM_LIMIT if filter_locally else limit),
                "geo": geo_type,
                "id": geo_id,
                "order": DEFAULT_ORDER,
                "max_distance": max_distance,
                "min_magnitude": upstream_min_magnitude,
            }
        )

        earthquakes = parse_earthquakes(payload.get("data"))
        if filter_locally:
            earthquakes = [
                earthquake
                for earthquake in earthquakes
                if earthquake.magnitude is None or earthquake.magnitude >= min_magnitude
            ]
        return earthquakes[:limit]

    async def _request(self, params: dict[str, Any]) -> dict[str, Any]:
        """Perform a GET request against the earthquakelist.org API.

        Raises EarthquakeListApiError instead of logging: the coordinator logs the
        first failure and stays quiet afterwards, so logging here as well turned a
        long outage into an error line every 15 minutes.
        """
        session = async_get_clientsession(self.hass)
        try:
            async with session.get(
                API_URL,
                params=params,
                headers=self._headers,
                timeout=REQUEST_TIMEOUT,
            ) as response:
                response.raise_for_status()
                # The API serves JSON with a text/html content type, so the
                # mimetype check in aiohttp's response.json() must be disabled.
                data = await response.json(content_type=None)
        except (aiohttp.ClientError, TimeoutError) as err:
            raise EarthquakeListApiError(
                f"Error communicating with earthquakelist.org: {err}"
            ) from err
        except ValueError as err:
            # A proxy or an outage page answers 200 with HTML. json() then raises
            # a JSONDecodeError (a ValueError), which is not a ClientError, so it
            # used to escape unwrapped and reach the coordinator as a crash.
            raise EarthquakeListApiError(
                f"Malformed response from earthquakelist.org: {err}"
            ) from err

        if not isinstance(data, dict) or not data.get("success"):
            _LOGGER.debug("Unexpected earthquakelist.org response: %s", data)
            raise EarthquakeListApiError("Unexpected response from earthquakelist.org")

        return data
