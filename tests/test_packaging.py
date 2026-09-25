"""What the release zip carries."""

from __future__ import annotations

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
