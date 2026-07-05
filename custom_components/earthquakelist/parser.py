"""Parsing helpers for the earthquakelist.org API responses."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any


def _to_float(value: Any) -> float | None:
    """Safely convert a value to float."""
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _to_int(value: Any) -> int | None:
    """Safely convert a value to int."""
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return None


def _to_bool(value: Any) -> bool:
    """Interpret the API's loose truthy values ("0"/"1"/bool) as a bool."""
    if isinstance(value, str):
        return value not in ("", "0")
    return bool(value)


def _to_str(value: Any) -> str | None:
    """Normalize the API's `false`-for-empty convention to None."""
    if value is None or value is False:
        return None
    return str(value)


@dataclass(slots=True)
class SearchResult:
    """A single location search result."""

    name: str
    geo_type: str
    geo_id: str
    country_code: str | None = None
    description: str | None = None
    population: int | None = None
    link_url: str | None = None


@dataclass(slots=True)
class EarthquakeData:
    """Structured data for a single earthquake."""

    id: str
    magnitude: float | None = None
    time: datetime | None = None
    location_text: str | None = None
    location_lat: float | None = None
    location_lng: float | None = None
    depth_km: float | None = None
    distance_km: float | None = None
    direction: str | None = None
    place_name: str | None = None
    place_url: str | None = None
    alert_level: str | None = None
    alert_tsunami: bool = False
    mmi: float | None = None
    felt: int | None = None
    significance: int | None = None
    usgs_code: str | None = None
    news_link: str | None = None
    news_title: str | None = None


def parse_search_results(data: Any) -> list[SearchResult]:
    """Parse the earthquakelist.org `action=search` payload."""
    if not isinstance(data, list):
        return []

    results: list[SearchResult] = []
    for item in data:
        if not isinstance(item, dict):
            continue

        name = item.get("name")
        geo_type = item.get("geo_type")
        geo_id = item.get("geo_id")
        if not isinstance(name, str) or not isinstance(geo_type, str) or not geo_id:
            continue

        results.append(
            SearchResult(
                name=name,
                geo_type=geo_type,
                geo_id=str(geo_id),
                country_code=_to_str(item.get("code")),
                description=_to_str(item.get("desc")),
                population=_to_int(item.get("population")),
                link_url=_to_str(item.get("link_url")),
            )
        )

    return results


def parse_earthquakes(data: Any) -> list[EarthquakeData]:
    """Parse the earthquakelist.org `action=earthquakes` payload."""
    if not isinstance(data, list):
        return []

    earthquakes: list[EarthquakeData] = []
    for item in data:
        earthquake = parse_earthquake(item)
        if earthquake is not None:
            earthquakes.append(earthquake)

    return earthquakes


def parse_earthquake(item: Any) -> EarthquakeData | None:
    """Parse a single earthquake entry from the `action=earthquakes` payload."""
    if not isinstance(item, dict):
        return None

    eq = item.get("eq")
    if not isinstance(eq, dict):
        return None

    eq_id = eq.get("id")
    if not eq_id:
        return None

    place = item.get("place") if isinstance(item.get("place"), dict) else {}

    # `time` is the UTC unix timestamp; `time_utc` is a human-readable string.
    timestamp = _to_int(eq.get("time"))
    time = datetime.fromtimestamp(timestamp, tz=UTC) if timestamp is not None else None

    return EarthquakeData(
        id=str(eq_id),
        magnitude=_to_float(eq.get("metric_magnitude")),
        time=time,
        location_text=_to_str(eq.get("location_text")),
        location_lat=_to_float(eq.get("location_lat")),
        location_lng=_to_float(eq.get("location_lng")),
        depth_km=_to_float(eq.get("location_depth")),
        distance_km=_to_float(item.get("dist")),
        direction=_to_str(item.get("dir")),
        place_name=_to_str(place.get("place")),
        place_url=_to_str(place.get("url")),
        alert_level=_to_str(eq.get("alert_level")),
        alert_tsunami=_to_bool(eq.get("alert_tsunami")),
        mmi=_to_float(eq.get("metric_mmi")),
        felt=_to_int(eq.get("metric_felt")),
        significance=_to_int(eq.get("metric_sig")),
        usgs_code=_to_str(eq.get("usgs_code")),
        news_link=_to_str(eq.get("news_link")),
        news_title=_to_str(eq.get("news_title")),
    )
