"""Refresh tests/fixtures/ from the live API.

    python scripts/refresh_fixtures.py                    # rewrite every fixture
    python scripts/refresh_fixtures.py earthquakes_japan.json   # only these
    python scripts/refresh_fixtures.py --check            # only say what moved

Run it when the canary (scripts/canary.py, .github/workflows/canary.yml) reports
that the API's format has changed and the parser has been adjusted to it: the
tests then run against the answers as they are now. Review the diff before
committing - it is the API's change, line by line - and run the suite.

The earthquake fixtures are what the API says right now, so a refresh brings
other quakes: tests/test_parser.py and tests/test_api.py pin the Corfu quake
(id, time, place) and have to be updated to the new one. The Japan and Greece
fixtures are only checked for their shape, they need nothing.

Needs network access and aiohttp (requirements.txt).
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys

from live_api import (
    FIXTURES,
    QUERIES,
    FetchError,
    FormatError,
    fetch,
    keys,
    make_session,
)


async def main(names: list[str], check: bool) -> int:
    """Refresh (or with `check` only compare) the fixtures, return the status."""
    if unknown := [name for name in names if name not in QUERIES]:
        print(f"unknown fixture(s): {', '.join(unknown)}; known: {', '.join(QUERIES)}")
        return 2

    status = 0
    async with make_session() as session:
        for name in names or QUERIES:
            try:
                live = await fetch(session, QUERIES[name])
            except (FetchError, FormatError) as err:
                print(f"{name}: not fetched - {err}")
                status = 1
                continue
            if not isinstance(live, dict) or not live.get("success"):
                print(f"{name}: the API did not report success - kept as it was.")
                status = 1
                continue

            path = FIXTURES / name
            old = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
            gone = sorted(keys(old) - keys(live))
            print(f"{name}: {len(gone)} of the old fixture's fields gone")
            for key in gone:
                print(f"    - {key}")

            if not check:
                path.write_text(
                    json.dumps(live, indent=2, ensure_ascii=False) + "\n",
                    encoding="utf-8",
                )
                print(f"{name}: written")
    return status


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("names", nargs="*", help="fixture files (default: all)")
    parser.add_argument("--check", action="store_true", help="only report")
    args = parser.parse_args()
    sys.exit(asyncio.run(main(args.names, args.check)))
