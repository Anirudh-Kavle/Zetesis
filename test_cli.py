"""CLI rendering and export checks."""
import argparse
import json
import time

from flight_recorder import cli, store
from flight_recorder.cli import banner, _color, _monkey, _ART


def test_banner_contains_art_and_tagline():
    out = banner()
    for row in _ART:
        assert row in out
    assert "local audit trail" in out


def test_banner_contains_monkey():
    # Non-tty output is plain, so the raw monkey art appears verbatim.
    assert _monkey() in banner()
    assert _monkey().count("\n") > 20  # a real multi-line render, not empty


def test_art_rows_aligned():
    # Misaligned block letters look broken; all rows must be equal width.
    assert len({len(row) for row in _ART}) == 1


def test_no_color_when_not_tty():
    # Tests run with piped stdout (not a tty), so output must be plain.
    assert "\033[" not in banner()
    assert _color("91", "x") == "x"


def test_export_writes_only_todays_events(tmp_path, monkeypatch):
    monkeypatch.setattr(store, "STORE_DIR", tmp_path)
    monkeypatch.setattr(store, "DB_PATH", tmp_path / "recorder.db")
    monkeypatch.setattr(store, "EVENTS_DIR", tmp_path / "events")
    monkeypatch.setattr(store, "SNAPSHOTS_DIR", tmp_path / "snapshots")
    monkeypatch.setattr(store, "RAW_PAYLOADS_LOG", tmp_path / "debug" / "raw_payloads.jsonl")
    monkeypatch.setattr(store, "DEBUG_LOG", tmp_path / "debug.log")
    monkeypatch.setattr(store, "PAUSE_FLAG", tmp_path / "paused")
    store.init_db()

    now = int(time.time() * 1000)
    conn = store.get_conn()
    try:
        conn.execute("INSERT INTO events (session_id, ts, phase, tool) VALUES (?, ?, ?, ?)", ("today", now, "pre", "Read"))
        conn.execute("INSERT INTO events (session_id, ts, phase, tool) VALUES (?, ?, ?, ?)", ("old", now - 86_400_000, "pre", "Bash"))
        conn.commit()
    finally:
        conn.close()

    output = tmp_path / "today.json"
    cli.cmd_export(argparse.Namespace(output=output, output_option=None))

    exported = json.loads(output.read_text(encoding="utf-8"))
    assert [event["session_id"] for event in exported] == ["today"]
