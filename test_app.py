"""Gate tests for the viewer API (zetesis/viewer/app.py).

Runs against a temp SQLite DB by monkeypatching store.DB_PATH — the app's
_conn() reads it at call time, so no real ~/.zetesis data is touched.
Run: .venv/bin/python -m pytest test_app.py
"""
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from zetesis import store
from zetesis.viewer.app import app

SCHEMA = Path("zetesis/schema.sql").read_text()


def _seed(conn):
    conn.executescript(SCHEMA)
    conn.execute(
        "INSERT INTO sessions (id, started_at, cwd, source) VALUES ('sess_a', 1000, '/tmp/a', 'startup')"
    )
    conn.execute(
        "INSERT INTO sessions (id, started_at, ended_at, cwd, source) VALUES ('sess_b', 2000, 3000, '/tmp/b', 'resume')"
    )
    conn.execute(
        "INSERT INTO sessions (id, started_at, cwd, source, title) VALUES ('sess_c', 3000, '/tmp/c', 'startup', 'Brainstorm art contest project ideas')"
    )
    events = [
        ("sess_a", 1100, "post", "Read", "read", 1, "exec"),
        ("sess_a", 1200, "post", "Bash", "bash", 0, "sensitive"),
        ("sess_b", 2100, "post", "Edit", "edit", 1, "write"),
    ]
    for session_id, ts, phase, tool, tool_kind, exit_ok, risk in events:
        conn.execute(
            "INSERT INTO events (session_id, ts, phase, tool, tool_kind, exit_ok, risk, risk_reasons)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, '[]')",
            (session_id, ts, phase, tool, tool_kind, exit_ok, risk),
        )
    conn.commit()


@pytest.fixture()
def client(tmp_path, monkeypatch):
    db_path = tmp_path / "recorder.db"
    monkeypatch.setattr(store, "DB_PATH", db_path)
    import sqlite3

    conn = sqlite3.connect(db_path)
    _seed(conn)
    conn.close()
    return TestClient(app)


def test_all_returns_events_across_sessions(client):
    events = client.get("/api/sessions/all/events").json()
    assert {e["session_id"] for e in events} == {"sess_a", "sess_b"}
    assert [e["ts"] for e in events] == sorted([e["ts"] for e in events], reverse=True)


def test_specific_session_still_filters(client):
    events = client.get("/api/sessions/sess_a/events").json()
    assert len(events) == 2
    assert all(e["session_id"] == "sess_a" for e in events)


def test_risk_filter_combines_with_all(client):
    events = client.get("/api/sessions/all/events", params={"risk": "sensitive"}).json()
    assert len(events) == 1
    assert events[0]["tool"] == "Bash"


def test_risk_reasons_deserialized_to_list(client):
    events = client.get("/api/sessions/all/events").json()
    assert all(isinstance(e["risk_reasons"], list) for e in events)


def test_missing_event_returns_null(client):
    res = client.get("/api/events/99999")
    assert res.status_code == 200
    assert res.json() is None


def test_sessions_include_deterministic_stat_counts(client):
    sessions = {s["id"]: s for s in client.get("/api/sessions").json()}
    a = sessions["sess_a"]
    assert a["action_count"] == 2
    assert a["bash_count"] == 1
    assert a["failed_count"] == 1
    assert a["sensitive_count"] == 1
    assert a["edit_count"] == 0
    b = sessions["sess_b"]
    assert b["action_count"] == 1
    assert b["edit_count"] == 1
    assert b["failed_count"] == 0


def test_sessions_derive_project_from_repo_or_cwd(client):
    sessions = {s["id"]: s for s in client.get("/api/sessions").json()}
    # No git_repo seeded → falls back to cwd; display name is the basename.
    assert sessions["sess_a"]["project_key"] == "/tmp/a"
    assert sessions["sess_a"]["project"] == "a"
    assert sessions["sess_b"]["project"] == "b"


def test_sessions_include_title_when_set(client):
    sessions = {s["id"]: s["title"] for s in client.get("/api/sessions").json()}
    assert sessions["sess_c"] == "Brainstorm art contest project ideas"
    assert sessions["sess_a"] is None


def test_root_serves_something(client):
    # dist mount when viewer/dist exists, JSON pointer otherwise — either way 200.
    assert client.get("/").status_code == 200


# --- /api/stats + /api/reviews ---


def _seed_stats(conn):
    conn.executescript(SCHEMA)
    now = int(time.time() * 1000)
    conn.execute(
        "INSERT INTO sessions (id, started_at, cwd, git_repo, source) VALUES ('s1', ?, '/repo', '/repo', 'startup')",
        (now - 5000,),
    )
    events = [
        # session_id, ts, phase, tool, tool_kind, provider, exit_ok, risk, capture_gap, files_touched
        ("s1", now - 1000, "post", "Bash", "bash", "claude", 1, "sensitive", 0, None),
        ("s1", now - 2000, "post", "Edit", "edit", "claude", 1, "write", 1, '["src/a.py"]'),
        ("s1", now - 3000, "post", "Read", "read", "claude", 1, "info", 0, '["src/b.py"]'),
        ("s1", now - 4000, "compact", None, None, "claude", None, "info", 0, None),
    ]
    for session_id, ts, phase, tool, tool_kind, provider, exit_ok, risk, capture_gap, files_touched in events:
        conn.execute(
            "INSERT INTO events (session_id, ts, phase, tool, tool_kind, provider, exit_ok, risk, risk_reasons, capture_gap, files_touched)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, ?)",
            (session_id, ts, phase, tool, tool_kind, provider, exit_ok, risk, capture_gap, files_touched),
        )
    conn.commit()


@pytest.fixture()
def stats_client(tmp_path, monkeypatch):
    db_path = tmp_path / "recorder.db"
    monkeypatch.setattr(store, "DB_PATH", db_path)
    import sqlite3

    conn = sqlite3.connect(db_path)
    _seed_stats(conn)
    conn.close()
    return TestClient(app)


@pytest.fixture()
def empty_client(tmp_path, monkeypatch):
    db_path = tmp_path / "recorder.db"
    monkeypatch.setattr(store, "DB_PATH", db_path)
    import sqlite3

    conn = sqlite3.connect(db_path)
    conn.executescript(SCHEMA)
    conn.commit()
    conn.close()
    return TestClient(app)


def test_stats_empty_db_reports_has_any_events_false(empty_client):
    data = empty_client.get("/api/stats").json()
    assert data["has_any_events"] is False
    assert data["cards"]["actions_total"] == 0
    assert data["cards"]["reasoning_coverage_pct"] is None


def test_stats_computes_actions_total_and_window(stats_client):
    data = stats_client.get("/api/stats").json()
    assert data["has_any_events"] is True
    assert data["cards"]["actions_total"] == 3  # Bash, Edit, Read — the compact row has no tool
    assert data["cards"]["actions_window"] == 3
    assert data["cards"]["files_touched_distinct"] == 2
    assert data["cards"]["files_touched_outside_git"] == 0
    assert data["coverage"]["compaction_shields_fired"] == 1


def test_stats_risk_by_day_has_every_tier_every_day(stats_client):
    data = stats_client.get("/api/stats").json()
    assert len(data["risk_by_day"]) == 14
    for day in data["risk_by_day"]:
        for tier in ("info", "write", "exec", "network", "sensitive"):
            assert tier in day
    today_entry = data["risk_by_day"][-1]
    assert today_entry["sensitive"] == 1
    assert today_entry["write"] == 1
    assert today_entry["info"] == 1


def test_stats_needs_attention_includes_sensitive_and_gap_events(stats_client):
    data = stats_client.get("/api/stats").json()
    tools = {e["tool"] for e in data["needs_attention"]}
    assert tools == {"Bash", "Edit"}


def test_stats_needs_attention_excludes_acknowledged_events(stats_client):
    first = stats_client.get("/api/stats").json()
    bash_event = next(e for e in first["needs_attention"] if e["tool"] == "Bash")
    res = stats_client.post("/api/reviews", json={"event_id": bash_event["id"]})
    assert res.status_code == 200
    second = stats_client.get("/api/stats").json()
    tools = {e["tool"] for e in second["needs_attention"]}
    assert tools == {"Edit"}


def test_create_review_404_for_unknown_event(stats_client):
    res = stats_client.post("/api/reviews", json={"event_id": 999999})
    assert res.status_code == 404


def test_create_review_idempotent_double_post(stats_client):
    first = stats_client.get("/api/stats").json()
    event_id = first["needs_attention"][0]["id"]
    res1 = stats_client.post("/api/reviews", json={"event_id": event_id})
    res2 = stats_client.post("/api/reviews", json={"event_id": event_id})
    assert res1.status_code == 200
    assert res2.status_code == 200
