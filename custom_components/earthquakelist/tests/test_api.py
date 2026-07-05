from __future__ import annotations

import json
from contextlib import contextmanager
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from custom_components.earthquakelist.api import EarthquakeListAPI, EarthquakeListApiError

FIXTURES_DIR = Path(__file__).parent / "fixtures"
pytestmark = pytest.mark.asyncio


def load_fixture(name: str) -> dict:
    """Load a JSON fixture by name."""
    return json.loads((FIXTURES_DIR / name).read_text(encoding="utf-8"))


@pytest.fixture
def mock_hass():
    """Mock Home Assistant object."""
    return SimpleNamespace()


@contextmanager
def _patch_session(payload):
    """Patch async_get_clientsession to return a JSON response with `payload`."""
    mock_response = AsyncMock()
    mock_response.json.return_value = payload
    mock_response.raise_for_status = MagicMock()
    mock_session = MagicMock()
    mock_session.get.return_value.__aenter__.return_value = mock_response
    with patch(
        "custom_components.earthquakelist.api.async_get_clientsession",
        return_value=mock_session,
    ):
        yield mock_session, mock_response


async def test_search_locations_returns_results(mock_hass) -> None:
    """A successful search should return parsed SearchResult records."""
    api = EarthquakeListAPI(mock_hass)
    payload = load_fixture("search_corfu.json")

    with _patch_session(payload) as (mock_get_session, mock_response):
        results = await api.search_locations("corfu")

    assert results is not None
    assert len(results) == 1
    assert results[0].name == "Corfu"
    assert results[0].geo_id == "2042"
    # The API serves JSON with a text/html content type; the mimetype check
    # must be disabled or aiohttp raises a ContentTypeError.
    mock_response.json.assert_called_once_with(content_type=None)


async def test_search_locations_returns_empty_list_for_blank_query(mock_hass) -> None:
    """A blank query should short-circuit without a network call."""
    api = EarthquakeListAPI(mock_hass)

    results = await api.search_locations("   ")

    assert results == []


async def test_search_locations_returns_none_on_client_error(mock_hass) -> None:
    """A network failure should be reported as None, not raised."""
    import aiohttp

    api = EarthquakeListAPI(mock_hass)

    mock_session = MagicMock()
    mock_session.get.side_effect = aiohttp.ClientError("boom")

    with patch(
        "custom_components.earthquakelist.api.async_get_clientsession",
        return_value=mock_session,
    ):
        results = await api.search_locations("corfu")

    assert results is None


async def test_get_earthquakes_returns_parsed_data(mock_hass) -> None:
    """A successful earthquakes request should return the parsed list."""
    api = EarthquakeListAPI(mock_hass)
    payload = load_fixture("earthquakes_corfu.json")

    with _patch_session(payload):
        earthquakes = await api.get_earthquakes("place", "2042", 3.0, 50)

    assert len(earthquakes) == 1
    assert earthquakes[0].id == "1294817"
    assert earthquakes[0].magnitude == pytest.approx(4.0)


async def test_get_earthquakes_passes_limit_and_returns_empty_when_no_match(
    mock_hass,
) -> None:
    """An empty but successful result set means no matching earthquake."""
    api = EarthquakeListAPI(mock_hass)

    with _patch_session({"success": True, "data": []}) as (mock_session, _):
        earthquakes = await api.get_earthquakes("place", "2042", 8.0, 10, limit=5)

    assert earthquakes == []
    _, kwargs = mock_session.get.call_args
    assert kwargs["params"]["limit"] == "5"


async def test_get_earthquakes_raises_on_client_error(mock_hass) -> None:
    """A communication failure should raise EarthquakeListApiError."""
    import aiohttp

    api = EarthquakeListAPI(mock_hass)

    mock_session = MagicMock()
    mock_session.get.side_effect = aiohttp.ClientError("boom")

    with patch(
        "custom_components.earthquakelist.api.async_get_clientsession",
        return_value=mock_session,
    ):
        with pytest.raises(EarthquakeListApiError):
            await api.get_earthquakes("place", "2042", 3.0, 50)
