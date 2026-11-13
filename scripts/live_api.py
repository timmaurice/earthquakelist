"""What the canary and the fixture refresh share: the requests and the fetching.

The fixtures (tests/fixtures) are answers of api.earthquakelist.org as they were
recorded. QUERIES says which request each one is the answer to, in the form
the integration sends it (custom_components/earthquakelist/api.py).
"""

from __future__ import annotations

import json
import sys
import types
from pathlib import Path
from typing import Any

import aiohttp

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from custom_components.earthquakelist import api as api_module  # noqa: E402
from custom_components.earthquakelist.const import (  # noqa: E402
    API_URL,
    DEFAULT_USER_AGENT,
)

FIXTURES = ROOT / "tests" / "fixtures"

# fixture -> the query. A place with its few quakes (the unit tests pin that
# one), and a country with plenty: the canary needs quakes to look at, and a
# country is what has them at any time.
QUERIES: dict[str, dict[str, str]] = {
    "search_corfu.json": {"action": "search", "query": "Corfu"},
    "search_greece.json": {"action": "search", "query": "Greece"},
    "earthquakes_corfu.json": {
        "action": "earthquakes",
        "geo": "place",
        "id": "2042",
        "order": "latest",
        "limit": "1",
        "max_distance": "50",
        "min_magnitude": "3",
    },
    "earthquakes_japan.json": {
        "action": "earthquakes",
        "geo": "country",
        "id": "11",
        "order": "latest",
        "limit": "3",
        "max_distance": "20000",
        "min_magnitude": "3",
    },
}


class FetchError(Exception):
    """The API could not be reached; that says nothing about its format."""


class FormatError(Exception):
    """The API answered, but not with JSON."""


def keys(payload: dict[str, Any]) -> set[str]:
    """Return every key of a payload's records, nested ones as `a.b`."""
    found: set[str] = set()

    def walk(value: object, prefix: str) -> None:
        if isinstance(value, dict):
            for key, inner in value.items():
                found.add(f"{prefix}{key}")
                walk(inner, f"{prefix}{key}.")
        elif isinstance(value, list):
            for inner in value:
                walk(inner, prefix)

    walk(payload.get("data"), "")
    return found


def make_session() -> aiohttp.ClientSession:
    """Return a session that sends what the integration sends."""
    return aiohttp.ClientSession(
        headers={"User-Agent": DEFAULT_USER_AGENT},
        timeout=api_module.REQUEST_TIMEOUT,
    )


async def fetch(session: aiohttp.ClientSession, params: dict[str, str]) -> Any:
    """Return the decoded answer to `params`, whatever its content type."""
    try:
        async with session.get(API_URL, params=params) as response:
            response.raise_for_status()
            body = await response.read()
            charset = response.get_encoding()
    except (aiohttp.ClientError, TimeoutError) as err:
        msg = f"{params}: {err}"
        raise FetchError(msg) from err
    try:
        return json.loads(body.decode(charset))
    except ValueError as err:
        msg = f"{params}: the answer is not JSON ({err}): {body[:80]!r}"
        raise FormatError(msg) from err


def api_over(session: aiohttp.ClientSession) -> api_module.EarthquakeListAPI:
    """Return the integration's own client, sending through `session`.

    The client asks Home Assistant for its shared session; here that is `session`.
    """
    api_module.async_get_clientsession = lambda _hass: session
    return api_module.EarthquakeListAPI(types.SimpleNamespace())  # type: ignore[arg-type]
