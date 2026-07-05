"""API client for earthquakelist.org."""

from __future__ import annotations

import logging
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

        payload = await self._request({"action": "search", "query": query})
        if payload is None:
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
        """
        payload = await self._request(
            {
                "action": "earthquakes",
                "limit": str(limit),
                "geo": geo_type,
                "id": geo_id,
                "order": DEFAULT_ORDER,
                "max_distance": max_distance,
                "min_magnitude": min_magnitude,
            }
        )
        if payload is None:
            raise EarthquakeListApiError(
                f"Failed to fetch earthquakes for {geo_type}/{geo_id}"
            )

        return parse_earthquakes(payload.get("data"))

    async def _request(self, params: dict[str, Any]) -> dict[str, Any] | None:
        """Perform a GET request against the earthquakelist.org API."""
        session = async_get_clientsession(self.hass)
        try:
            async with session.get(
                API_URL, params=params, headers=self._headers
            ) as response:
                response.raise_for_status()
                # The API serves JSON with a text/html content type, so the
                # mimetype check in aiohttp's response.json() must be disabled.
                data = await response.json(content_type=None)
        except (aiohttp.ClientError, TimeoutError) as err:
            _LOGGER.error("Error communicating with earthquakelist.org: %s", err)
            return None

        if not isinstance(data, dict) or not data.get("success"):
            _LOGGER.debug("Unexpected earthquakelist.org response: %s", data)
            return None

        return data
