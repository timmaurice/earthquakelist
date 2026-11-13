"""Tests the canary's reading of the API (scripts/canary.py) on the fixtures.

The canary compares the live API with the fixtures, so what it concludes from
the fixtures alone has to hold: they have the conventions the parser relies on,
they lose nothing against themselves, and an answer that breaks a convention or
drops a field is a failure.
"""

from __future__ import annotations

import copy
import json

import pytest
from canary import check_conventions, check_fields
from live_api import FIXTURES, QUERIES, keys


def load(name: str) -> dict:
    """Load a fixture."""
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


def quakes() -> list[dict]:
    """Return every recorded earthquake record."""
    return [
        item
        for name, params in QUERIES.items()
        if params["action"] == "earthquakes"
        for item in load(name)["data"]
    ]


def test_every_query_has_a_fixture() -> None:
    """QUERIES and tests/fixtures say the same, or a refresh and a test disagree."""
    on_disk = {path.name for path in FIXTURES.glob("*.json")}
    assert on_disk == set(QUERIES)


def test_the_fixtures_follow_the_conventions_the_parser_relies_on() -> None:
    """The recordings are what the canary holds the live API to."""
    failures: list[str] = []
    check_conventions(quakes(), failures)
    assert failures == []


def test_the_fixtures_lose_nothing_against_themselves() -> None:
    """The same answers twice are not a change, so the canary stays quiet."""
    live = {name: load(name) for name in QUERIES}
    failures: list[str] = []
    check_fields(live, failures)
    assert failures == []


def test_a_dropped_field_is_a_failure() -> None:
    """A field the fixtures have and the live answers lack is what it is for."""
    live = {name: load(name) for name in QUERIES}
    for item in (
        live["earthquakes_japan.json"]["data"] + live["earthquakes_corfu.json"]["data"]
    ):
        del item["eq"]["location_text"]
    failures: list[str] = []

    check_fields(live, failures)

    assert len(failures) == 1
    assert "eq.location_text" in failures[0]


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("time", "2026-06-12 04:42"),
        ("alert_tsunami", True),
        ("location_offshore", "yes"),
        ("alert_level", None),
    ],
)
def test_a_changed_value_convention_is_a_failure(field: str, value: object) -> None:
    """`time` as text, a real boolean for a "0"/"1" flag, `null` for `false`."""
    records = copy.deepcopy(quakes())
    records[0]["eq"][field] = value
    failures: list[str] = []

    check_conventions(records, failures)

    assert len(failures) == 1
    assert field in failures[0]


def test_keys_names_nested_fields() -> None:
    """Fields of the records are listed with their parent, as `place.url`."""
    found = keys({"data": [{"eq": {"id": "1"}, "place": {"url": "x"}}]})

    assert found == {"eq", "eq.id", "place", "place.url"}
