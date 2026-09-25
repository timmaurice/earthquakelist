"""What a release ships, and what it declares to HACS."""

from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
INTEGRATION = ROOT / "custom_components" / "earthquakelist"


def test_the_integration_folder_ships_no_tests():
    """The release workflow zips custom_components/earthquakelist as a whole.

    Tests and fixtures used to live in there and reached every user who
    installed the integration. They belong in tests/ at the repo root.
    """
    assert not (INTEGRATION / "tests").exists()
    assert not list(INTEGRATION.rglob("test_*.py"))


def test_hacs_declares_the_core_ci_tests_against():
    """HACS offers the integration to every core at or above this minimum.

    CI resolves and exercises only the current core and fails below
    MINIMUM_CORE, so anything older would be a promise nobody verifies.
    """
    hacs = json.loads((ROOT / "hacs.json").read_text())
    workflow = (ROOT / ".github" / "workflows" / "tests.yml").read_text()
    ci_minimum = re.search(r"MINIMUM_CORE: '([^']+)'", workflow)

    assert ci_minimum, "tests.yml no longer sets MINIMUM_CORE"
    assert hacs.get("homeassistant") == ci_minimum.group(1)
