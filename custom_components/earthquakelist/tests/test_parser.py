from __future__ import annotations

import json
from pathlib import Path

import pytest

from custom_components.earthquakelist.parser import (
    parse_earthquake,
    parse_earthquakes,
    parse_search_results,
)

FIXTURES_DIR = Path(__file__).parent / "fixtures"


def load_fixture(name: str) -> dict:
    """Load a JSON fixture by name."""
    return json.loads((FIXTURES_DIR / name).read_text(encoding="utf-8"))


def test_parse_search_results_from_corfu_fixture() -> None:
    """Search results should be normalized into SearchResult records."""
    payload = load_fixture("search_corfu.json")

    results = parse_search_results(payload["data"])

    assert len(results) == 1
    result = results[0]
    assert result.name == "Corfu"
    assert result.geo_type == "place"
    assert result.geo_id == "2042"
    assert result.country_code == "GR"
    assert result.description == "Place in Ionian Islands, Greece"
    assert result.population == 27003
    assert result.link_url == "greece/ionian-islands/corfu/"


def test_parse_search_results_tolerates_malformed_entries() -> None:
    """Entries missing required fields should be skipped, not crash."""
    data = [
        {"name": "Broken"},
        {"name": "Also broken", "geo_type": "place"},
        "not-a-dict",
        {"name": "Berlin", "geo_type": "place", "geo_id": "9506", "code": "DE"},
    ]

    results = parse_search_results(data)

    assert len(results) == 1
    assert results[0].name == "Berlin"


def test_parse_search_results_handles_non_list_payload() -> None:
    """A missing or malformed data field should yield an empty list."""
    assert parse_search_results(None) == []
    assert parse_search_results({"unexpected": "shape"}) == []


def test_parse_earthquakes_from_corfu_fixture() -> None:
    """The earthquakes payload should be parsed into EarthquakeData records."""
    payload = load_fixture("earthquakes_corfu.json")

    earthquakes = parse_earthquakes(payload["data"])

    assert len(earthquakes) == 1
    earthquake = earthquakes[0]
    assert earthquake.id == "1294817"
    assert earthquake.magnitude == pytest.approx(4.0)
    assert earthquake.time is not None
    assert earthquake.time.isoformat() == "2026-06-12T04:42:08+00:00"
    assert earthquake.location_text == "11 km SE of Himarë, Albania"
    assert earthquake.location_lat == pytest.approx(40.022)
    assert earthquake.location_lng == pytest.approx(19.8391)
    assert earthquake.depth_km == pytest.approx(10)
    assert earthquake.distance_km == pytest.approx(45)
    assert earthquake.direction == "N"
    assert earthquake.place_name == "Corfu"
    assert earthquake.place_url == "greece/ionian-islands/corfu/"
    assert earthquake.alert_level is None
    assert earthquake.alert_tsunami is False
    assert earthquake.mmi == pytest.approx(0)
    assert earthquake.felt == 0
    assert earthquake.significance == 246
    assert earthquake.usgs_code == "us7000sseh"
    assert earthquake.news_link is None
    assert earthquake.news_title is None


def test_parse_earthquake_tolerates_malformed_entries() -> None:
    """Missing `eq`/`id` should yield None instead of crashing."""
    assert parse_earthquake("not-a-dict") is None
    assert parse_earthquake({"dist": "45"}) is None
    assert parse_earthquake({"eq": {}}) is None


def test_parse_earthquake_reads_true_alert_and_tsunami_flags() -> None:
    """A real alert level and a truthy tsunami flag should be preserved."""
    item = {
        "eq": {
            "id": "42",
            "metric_magnitude": "6.1",
            "alert_level": "orange",
            "alert_tsunami": "1",
        },
        "dist": "10",
        "dir": "S",
    }

    earthquake = parse_earthquake(item)

    assert earthquake is not None
    assert earthquake.alert_level == "orange"
    assert earthquake.alert_tsunami is True
