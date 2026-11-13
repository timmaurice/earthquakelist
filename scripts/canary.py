"""Canary: run the integration's API client and parser against the live API.

    python scripts/canary.py

The unit tests run on answers of api.earthquakelist.org as they were recorded
(tests/fixtures), so they stay green when the API changes - and it is
undocumented, reverse engineered from the site's own scripts. This is the check
that does not: it sends the integration's own requests (a search for a place
and for a country, and the latest quakes of a place and of a country), reads
the answers with the integration's own client and parser, and fails loudly
when they find nothing. It also compares the fields of the live records with
those of the fixtures, and checks the conventions the parser relies on (times
as a unix timestamp, flags as the strings "0"/"1", `false` for "none"), so a
change that the parser happens to survive still shows up.

Exit status: 0 all fine, 1 the API changed (or a parser found nothing), 2 the
API could not be reached, which says nothing about its format.
Runs weekly in .github/workflows/canary.yml. When it fails because the format
moved, fix the parser, then `python scripts/refresh_fixtures.py`.
"""

from __future__ import annotations

import asyncio
import json
import sys
from typing import Any

from live_api import (
    FIXTURES,
    QUERIES,
    FetchError,
    FormatError,
    api_over,
    fetch,
    keys,
    make_session,
)

from custom_components.earthquakelist.api import EarthquakeListApiError

# Japan is the country that has a quake of at least M3 at any time of day.
COUNTRY = ("country", "11")
# How many quakes of it the canary reads, and the least it finds sensible.
LIMIT = 10
MINIMUM_QUAKES = 3


def fail(problem: str, failures: list[str]) -> None:
    """Record and print one problem."""
    print(f"  FAIL {problem}")
    failures.append(problem)


def check_conventions(quakes: list[dict[str, Any]], failures: list[str]) -> None:
    """Check what the parser assumes about the raw values of the quakes."""
    for item in quakes:
        eq = item.get("eq", {})
        label = f"quake {eq.get('id')}"
        if not str(eq.get("time", "")).isdigit():
            fail(
                f"{label}: `time` is {eq.get('time')!r}, not a unix timestamp", failures
            )
        for flag in ("alert_tsunami", "location_offshore"):
            if str(eq.get(flag)) not in ("0", "1"):
                fail(f'{label}: `{flag}` is {eq.get(flag)!r}, not "0"/"1"', failures)
        level = eq.get("alert_level")
        if level is not False and not isinstance(level, str):
            fail(
                f"{label}: `alert_level` is {level!r}, not false or a string", failures
            )
        if not isinstance(item.get("place"), dict):
            fail(f"{label}: no `place` record", failures)


def check_fields(live: dict[str, dict[str, Any]], failures: list[str]) -> None:
    """Compare the fields of the live answers with those of the fixtures."""
    for kind in ("search", "earthquakes"):
        recorded: set[str] = set()
        current: set[str] = set()
        for name, params in QUERIES.items():
            if params["action"] == kind:
                recorded |= keys(json.loads((FIXTURES / name).read_text("utf-8")))
                current |= keys(live[name])
        gone = sorted(recorded - current)
        print(f"{kind}: {len(current)} fields, {len(gone)} of the fixtures' gone")
        for key in gone:
            print(f"    - {key}")
        if gone:
            fail(f"{kind}: the live answers no longer have {', '.join(gone)}", failures)


async def check(session: Any, failures: list[str]) -> None:
    """Fetch the fixtures' queries live and check them, then the real client."""
    live: dict[str, dict[str, Any]] = {}
    for name, params in QUERIES.items():
        try:
            answer = await fetch(session, params)
        except FormatError as err:
            fail(str(err), failures)
            continue
        if not isinstance(answer, dict) or not answer.get("success"):
            fail(
                f"{name}: the API did not report success: {str(answer)[:80]}", failures
            )
            continue
        live[name] = answer
        print(f"{name}: {len(answer.get('data') or [])} records")
    if len(live) < len(QUERIES):
        return

    check_fields(live, failures)
    check_conventions(
        [
            item
            for name, params in QUERIES.items()
            if params["action"] == "earthquakes"
            for item in live[name]["data"]
        ],
        failures,
    )

    # And now what the integration makes of it.
    api = api_over(session)
    try:
        places = await api.search_locations("Corfu")
        countries = await api.search_locations("Greece")
        quakes = await api.get_earthquakes(*COUNTRY, 3.0, 20000, limit=LIMIT)
    except EarthquakeListApiError as err:
        fail(f"the integration's client cannot read the API: {err}", failures)
        return

    corfu = [p for p in places or [] if p.name == "Corfu" and p.geo_type == "place"]
    print(f"search: Corfu -> {len(corfu)} place(s), Greece -> {len(countries or [])}")
    if not corfu or not corfu[0].geo_id:
        fail("the search for Corfu finds no place with an id", failures)
    elif corfu[0].display_name == corfu[0].name:
        fail("the place's `desc` no longer names its region and country", failures)
    if not any(c.geo_type == "country" and c.name == "Greece" for c in countries or []):
        fail("the search for Greece finds no country", failures)

    print(f"earthquakes: {len(quakes)} of the country")
    if len(quakes) < MINIMUM_QUAKES:
        fail(
            f"{len(quakes)} quakes for Japan, expected at least {MINIMUM_QUAKES}",
            failures,
        )
    for quake in quakes:
        missing = [
            field
            for field in (
                "magnitude",
                "time",
                "location_text",
                "location_lat",
                "location_lng",
                "place_name",
            )
            if getattr(quake, field) is None
        ]
        if missing:
            fail(f"quake {quake.id}: nothing read for {', '.join(missing)}", failures)


async def main() -> int:
    """Run the checks and return the exit status."""
    failures: list[str] = []
    try:
        async with make_session() as session:
            await check(session, failures)
    except FetchError as err:
        print(f"\ncould not reach the API, nothing is known about its format: {err}")
        return 2

    if failures:
        print("\nCANARY FAILED - the API's format has most likely changed:")
        for failure in failures:
            print(f"  - {failure}")
        print("\nFix the parser, then run scripts/refresh_fixtures.py.")
        return 1
    print("\nok: the integration still reads the live API.")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
