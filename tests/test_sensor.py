from __future__ import annotations

from datetime import UTC, datetime
from importlib import import_module
import json
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest
from pytest_homeassistant_custom_component.common import MockConfigEntry

from homeassistant.const import ATTR_ICON
from homeassistant.helpers.entity import EntityDescription
from homeassistant.helpers.icon import async_get_icons

from custom_components.earthquakelist import PLATFORMS
from custom_components.earthquakelist.const import DOMAIN
from custom_components.earthquakelist.parser import EarthquakeData
from custom_components.earthquakelist.sensor import _earthquake_to_dict

INTEGRATION = Path(__file__).resolve().parent.parent / "custom_components" / DOMAIN


def test_earthquake_to_dict_includes_all_parsed_fields() -> None:
    """Every field parsed onto EarthquakeData must reach the card's `earthquakes` list.

    Regression test: these fields used to be parsed but silently dropped here, so only
    the single latest earthquake (exposed separately via extra_state_attributes) ever
    carried them - the up-to-10-item history list the card renders did not.
    """
    earthquake = EarthquakeData(
        id="42",
        magnitude=5.6,
        time=datetime(2026, 6, 12, 4, 42, 8, tzinfo=UTC),
        location_text="11 km SE of Himarë, Albania",
        location_lat=40.022,
        location_lng=19.8391,
        depth_km=10,
        distance_km=45,
        direction="N",
        place_name="Corfu",
        place_url="greece/ionian-islands/corfu/",
        alert_level="orange",
        alert_tsunami=True,
        mmi=6.2,
        felt=312,
        significance=680,
        usgs_code="us7000sseh",
        news_link="https://example.com/news",
        news_title="Strong earthquake felt across the region",
        offshore=True,
        local_timezone="Europe/Athens",
        local_timezone_short="Athens",
    )

    result = _earthquake_to_dict(earthquake)

    assert result == {
        "id": "42",
        "magnitude": 5.6,
        "time": "2026-06-12T04:42:08+00:00",
        "place": "Corfu",
        "location": "11 km SE of Himarë, Albania",
        "latitude": 40.022,
        "longitude": 19.8391,
        "depth_km": 10,
        "distance_km": 45,
        "direction": "N",
        "alert_level": "orange",
        "alert_tsunami": True,
        "mmi": 6.2,
        "felt": 312,
        "significance": 680,
        "usgs_code": "us7000sseh",
        "news_link": "https://example.com/news",
        "news_title": "Strong earthquake felt across the region",
        "offshore": True,
        "local_timezone": "Europe/Athens",
        "local_timezone_short": "Athens",
    }


def test_earthquake_to_dict_handles_missing_optional_fields() -> None:
    """Fields the API omits should come through as None, not crash."""
    earthquake = EarthquakeData(id="1")

    result = _earthquake_to_dict(earthquake)

    assert result["time"] is None
    assert result["offshore"] is False
    assert result["news_link"] is None
    assert result["local_timezone"] is None


def _entity_descriptions(platform: str) -> list[EntityDescription]:
    """Every entity description a platform module defines at module level."""
    module = import_module(f"custom_components.{DOMAIN}.{platform}")
    return [
        value for value in vars(module).values() if isinstance(value, EntityDescription)
    ]


@pytest.mark.parametrize("platform", PLATFORMS, ids=str)
def test_every_translation_key_has_an_icon(platform) -> None:
    """The icon-translations quality-scale rule: icons come from icons.json.

    An entity description with a translation_key but no icons.json entry falls
    back to the domain's default icon, and one that still sets `icon=` overrides
    icons.json and brings back the `icon` state attribute. A description added
    later has to follow the same rule, so this covers all of PLATFORMS.
    """
    icons = json.loads((INTEGRATION / "icons.json").read_text())
    platform_icons = icons.get("entity", {}).get(str(platform), {})
    descriptions = _entity_descriptions(platform)

    assert descriptions, f"{platform} defines no entity descriptions to check"
    for description in descriptions:
        assert description.icon is None, f"{description.key} still hardcodes its icon"
        assert description.translation_key in platform_icons, (
            f"icons.json has no entity.{platform}.{description.translation_key}"
        )
        assert platform_icons[description.translation_key]["default"].startswith("mdi:")

    # And no leftovers: an icons.json key no entity uses is dead config.
    assert set(platform_icons) == {d.translation_key for d in descriptions}


async def test_the_sensor_leaves_its_icon_to_icons_json(
    hass, enable_custom_integrations
) -> None:
    """The state carries no `icon` attribute; Home Assistant resolves it instead.

    A hardcoded `icon=` put `mdi:pulse` on every state as an attribute. With
    icons.json the frontend looks the icon up by translation_key, so the
    attribute is gone and async_get_icons is where the icon now comes from.
    """
    entry = MockConfigEntry(
        domain=DOMAIN,
        title="Corfu Earthquakes",
        unique_id="place_2042",
        data={
            "geo_type": "place",
            "geo_id": "2042",
            "place": "Corfu",
            "min_magnitude": 3.0,
            "max_distance": 50,
        },
    )
    entry.add_to_hass(hass)
    quake = EarthquakeData(id="42", magnitude=5.6, place_name="Corfu")

    with (
        # async_setup only registers the card; it and the http dependency it
        # pulls in are not what this test is about.
        patch("custom_components.earthquakelist.async_setup", return_value=True),
        patch("homeassistant.setup.async_process_deps_reqs"),
        patch(
            "custom_components.earthquakelist.EarthquakeListAPI.get_earthquakes",
            AsyncMock(return_value=[quake]),
        ),
    ):
        assert await hass.config_entries.async_setup(entry.entry_id)
        await hass.async_block_till_done()

    state = hass.states.get("sensor.earthquakelist_corfu_latest_earthquake")
    assert state is not None
    assert state.state == "5.6"
    assert ATTR_ICON not in state.attributes

    icons = await async_get_icons(hass, "entity", integrations=[DOMAIN])
    assert icons[DOMAIN]["sensor"]["latest_earthquake"] == {"default": "mdi:pulse"}
