from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from custom_components.earthquakelist.config_flow import EarthquakeListConfigFlow
from custom_components.earthquakelist.const import (
    CONF_GEO_ID,
    CONF_GEO_TYPE,
    CONF_MAX_DISTANCE,
    CONF_MIN_MAGNITUDE,
    CONF_PLACE,
)
from custom_components.earthquakelist.parser import SearchResult

pytestmark = pytest.mark.asyncio


def _make_flow() -> EarthquakeListConfigFlow:
    flow = EarthquakeListConfigFlow()
    flow.hass = SimpleNamespace()
    flow._results = {
        "Corfu (Place in Ionian Islands, Greece)": SearchResult(
            name="Corfu",
            geo_type="place",
            geo_id="2042",
            country_code="GR",
            description="Place in Ionian Islands, Greece",
        )
    }
    return flow


async def test_select_step_creates_entry_for_a_known_place() -> None:
    """Selecting a place returned by the search should create the entry."""
    flow = _make_flow()

    with (
        patch.object(flow, "async_set_unique_id", AsyncMock()),
        patch.object(flow, "_abort_if_unique_id_configured", MagicMock()),
    ):
        result = await flow.async_step_select(
            {
                CONF_PLACE: "Corfu (Place in Ionian Islands, Greece)",
                CONF_MIN_MAGNITUDE: 3.0,
                CONF_MAX_DISTANCE: 50,
            }
        )

    assert result["type"] == "create_entry"
    assert result["data"][CONF_GEO_TYPE] == "place"
    assert result["data"][CONF_GEO_ID] == "2042"


async def test_select_step_rejects_a_custom_value_not_in_search_results() -> None:
    """The searchable dropdown allows a custom value; it must not be accepted."""
    flow = _make_flow()

    result = await flow.async_step_select(
        {
            CONF_PLACE: "Some typed garbage",
            CONF_MIN_MAGNITUDE: 3.0,
            CONF_MAX_DISTANCE: 50,
        }
    )

    assert result["type"] == "form"
    assert result["step_id"] == "select"
    assert result["errors"] == {CONF_PLACE: "invalid_place"}


async def test_select_step_shows_form_with_dropdown_options_when_no_input() -> None:
    """The initial render should expose all search results as selectable options."""
    flow = _make_flow()

    result = await flow.async_step_select(None)

    assert result["type"] == "form"
    assert result["step_id"] == "select"
    place_selector = result["data_schema"].schema[CONF_PLACE]
    assert place_selector.config["custom_value"] is True
    assert place_selector.config["options"] == ["Corfu (Place in Ionian Islands, Greece)"]


async def test_display_name_adds_region_and_country() -> None:
    result = SearchResult(
        name="Athens",
        geo_type="place",
        geo_id="1",
        description="Place in Georgia, United States",
    )
    assert result.display_name == "Athens (Georgia, United States)"


@pytest.mark.parametrize("description", [None, "", "Country", "Country in Europe"])
async def test_display_name_falls_back_to_plain_name(description: str | None) -> None:
    result = SearchResult(name="Greece", geo_type="country", geo_id="2", description=description)
    assert result.display_name == "Greece"


async def test_display_name_qualifies_a_region_with_its_country() -> None:
    result = SearchResult(
        name="West Greece", geo_type="region", geo_id="3", description="Region in Greece"
    )
    assert result.display_name == "West Greece (Greece)"


async def test_new_entry_title_and_device_name_carry_the_region() -> None:
    flow = _make_flow()

    with (
        patch.object(flow, "async_set_unique_id", AsyncMock()),
        patch.object(flow, "_abort_if_unique_id_configured", MagicMock()),
    ):
        result = await flow.async_step_select(
            {
                CONF_PLACE: "Corfu (Place in Ionian Islands, Greece)",
                CONF_MIN_MAGNITUDE: 3.0,
                CONF_MAX_DISTANCE: 50,
            }
        )

    assert result["title"] == "Corfu (Ionian Islands, Greece) Earthquakes"
    assert result["data"]["display_name"] == "Corfu (Ionian Islands, Greece)"
    assert result["data"][CONF_PLACE] == "Corfu"
