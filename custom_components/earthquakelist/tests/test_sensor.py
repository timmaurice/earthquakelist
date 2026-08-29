from __future__ import annotations

from datetime import UTC, datetime

from custom_components.earthquakelist.parser import EarthquakeData
from custom_components.earthquakelist.sensor import _earthquake_to_dict


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
