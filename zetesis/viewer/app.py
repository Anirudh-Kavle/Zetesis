"""fr-viewer: read-only FastAPI app over the SQLite store. No daemon
writes here — the hook is the only writer. This process just reads."""
from __future__ import annotations

import asyncio
import json
import re
import sqlite3
import time
from datetime import date
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from .. import store
from . import stats as stats_mod

app = FastAPI(title="Zetesis")

PROVIDERS = ["claude", "codex", "openai-api"]

# Claude/Codex providers can occasionally deliver PreToolUse and PostToolUse
# as separate rows. Do not show the empty pre-row when a completed post-row is
# already present; the selected UI action should expose its actual result.
COMPLETED_ACTION_FILTER = """(
    phase != 'pre'
    OR (result_json IS NOT NULL AND result_json != '')
    OR NOT EXISTS (
        SELECT 1 FROM events completed
        WHERE completed.session_id = events.session_id
          AND completed.tool = events.tool
          AND completed.phase = 'post'
          AND completed.ts >= events.ts
          AND (events.tool_use_id IS NULL OR completed.tool_use_id = events.tool_use_id)
    )
)"""


def _conn() -> sqlite3.Connection:
    conn = sqlite3.connect(store.DB_PATH, timeout=5)
    conn.row_factory = sqlite3.Row
    return conn


def _event_to_dict(row: sqlite3.Row) -> dict:
    d = dict(row)
    try:
        d["risk_reasons"] = json.loads(d.get("risk_reasons") or "[]")
    except (json.JSONDecodeError, TypeError):
        d["risk_reasons"] = []
    return d


@app.get("/api/sessions")
def list_sessions() -> list[dict]:
    conn = _conn()
    try:
        # Deterministic per-session stat line: plain SQL counts, no inference.
        # tool_kind can be NULL on rows from before normalization existed, so
        # edit/bash counts also fall back to the raw tool name.
        rows = conn.execute(
            """
            SELECT s.id, s.started_at, s.ended_at, s.cwd, s.git_repo, s.source, s.title,
                   s.token_limit, s.time_limit_s, s.token_used,
                   COUNT(e.id) as event_count, MAX(e.ts) as last_event_ts,
                   COUNT(e.id) FILTER (WHERE e.tool IS NOT NULL) AS action_count,
                   COUNT(e.id) FILTER (WHERE e.tool_kind IN ('edit', 'write')
                       OR LOWER(e.tool) IN ('edit', 'write', 'notebookedit', 'apply_patch', 'write_file')) AS edit_count,
                   COUNT(e.id) FILTER (WHERE e.tool_kind = 'bash'
                       OR LOWER(e.tool) IN ('bash', 'run_command')) AS bash_count,
                   COUNT(e.id) FILTER (WHERE e.exit_ok = 0) AS failed_count,
                   COUNT(e.id) FILTER (WHERE e.risk = 'sensitive') AS sensitive_count,
                   MAX(e.git_branch) AS git_branch,
                   COALESCE(
                       (SELECT provider FROM events
                        WHERE session_id = s.id AND provider IS NOT NULL
                        ORDER BY ts ASC LIMIT 1),
                       CASE WHEN s.source IN ('claude', 'codex', 'openai-api') THEN s.source END
                   ) as provider
            FROM sessions s
            LEFT JOIN events e ON e.session_id = s.id
            GROUP BY s.id
            ORDER BY COALESCE(MAX(e.ts), s.started_at) DESC
            """
        ).fetchall()
        sessions = [dict(r) for r in rows]
        for s in sessions:
            # Project identity is derived, never stored: the repo root when the
            # session ran in one, the plain working folder otherwise. Grouping
            # is therefore a view over existing stamps — old sessions group
            # correctly with zero migration.
            key = s.get("git_repo") or s.get("cwd") or ""
            s["project_key"] = key or "unknown"
            s["project"] = re.split(r"[\\/]", key.rstrip("\\/"))[-1] if key else "unknown"
        return sessions
    finally:
        conn.close()


@app.get("/api/usage")
def usage() -> dict:
    conn = _conn()
    try:
        row = conn.execute("SELECT day, token_count, updated_at FROM api_usage WHERE day = ?", (date.today().isoformat(),)).fetchone()
        return dict(row) if row else {"day": date.today().isoformat(), "token_count": 0, "updated_at": None}
    finally:
        conn.close()


def _budget_value(raw, name: str):
    if raw in (None, "", 0, "0"):
        return None
    try:
        number = int(raw)
    except (TypeError, ValueError):
        raise HTTPException(400, f"{name} must be a positive integer or null")
    if number < 1:
        raise HTTPException(400, f"{name} must be a positive integer or null")
    return number


@app.get("/api/budgets")
def budgets() -> list[dict]:
    conn = _conn()
    try:
        scopes = ["global", "claude", "codex", "openai-api"]
        out = []
        for scope in scopes:
            row = store.get_budget(conn, scope)
            if scope == "global":
                used = conn.execute("SELECT COALESCE(SUM(token_used), 0) FROM sessions").fetchone()[0]
            else:
                used = conn.execute(
                    """SELECT COALESCE(SUM(s.token_used), 0) FROM sessions s
                       WHERE COALESCE((SELECT provider FROM events e WHERE e.session_id = s.id AND e.provider IS NOT NULL ORDER BY e.ts DESC LIMIT 1), s.source) = ?""",
                    (scope,),
                ).fetchone()[0]
            out.append({"scope": scope, "token_limit": row["token_limit"] if row else None,
                        "time_limit_s": row["time_limit_s"] if row else None,
                        "token_used": int(used or 0)})
        return out
    finally:
        conn.close()


@app.patch("/api/budgets/{scope}")
def update_scope_budget(scope: str, payload: dict) -> dict:
    if scope not in {"global", "claude", "codex", "openai-api"}:
        raise HTTPException(400, "Unknown budget scope")
    token_limit = _budget_value(payload.get("token_limit"), "token_limit")
    time_limit_s = _budget_value(payload.get("time_limit_s"), "time_limit_s")
    conn = _conn()
    try:
        store.set_budget(conn, scope, token_limit, time_limit_s, int(time.time() * 1000))
        conn.commit()
        return {"scope": scope, "token_limit": token_limit, "time_limit_s": time_limit_s}
    finally:
        conn.close()


@app.patch("/api/sessions/{session_id}/budget")
def update_budget(session_id: str, payload: dict) -> dict:
    """Update the shared API session limits used by the terminal agent."""
    token_limit = _budget_value(payload.get("token_limit"), "token_limit")
    time_limit_s = _budget_value(payload.get("time_limit_s"), "time_limit_s")
    conn = _conn()
    try:
        if not conn.execute("SELECT 1 FROM sessions WHERE id = ?", (session_id,)).fetchone():
            raise HTTPException(404, "Session not found")
        conn.execute("UPDATE sessions SET token_limit = ?, time_limit_s = ? WHERE id = ?",
                     (token_limit, time_limit_s, session_id))
        conn.commit()
        row = conn.execute("SELECT id, token_limit, time_limit_s, token_used FROM sessions WHERE id = ?", (session_id,)).fetchone()
        return dict(row)
    finally:
        conn.close()


@app.get("/api/sessions/{session_id}/events")
def session_events(session_id: str, risk: str | None = None, limit: int = 500) -> list[dict]:
    conn = _conn()
    try:
        # session_id "all" means no session filter — the viewer's full-history load.
        # tool IS NOT NULL excludes toolless lifecycle bookkeeping (SessionStart/
        # End, Stop, PreCompact) — real audit rows, just not "actions" the
        # timeline has a WHAT/WHY to show; they'd otherwise render as a bare
        # "null" tool badge with nothing else in it.
        where: list[str] = ["tool IS NOT NULL", COMPLETED_ACTION_FILTER]
        params: list = []
        if session_id != "all":
            where.append("session_id = ?")
            params.append(session_id)
        if risk:
            where.append("risk = ?")
            params.append(risk)
        sql = "SELECT * FROM events"
        if where:
            sql += " WHERE " + " AND ".join(where)
        sql += " ORDER BY ts DESC LIMIT ?"
        params.append(limit)
        rows = conn.execute(sql, params).fetchall()
        return [_event_to_dict(r) for r in rows]
    finally:
        conn.close()


@app.get("/api/events/{event_id}")
def event_detail(event_id: int) -> dict | None:
    conn = _conn()
    try:
        row = conn.execute("SELECT * FROM events WHERE id = ?", (event_id,)).fetchone()
        return _event_to_dict(row) if row else None
    finally:
        conn.close()


QUALIFIER_RE = re.compile(r"(\w+):(\S+)")


def _day_to_ms(value: str) -> int | None:
    """Parse a YYYY-MM-DD qualifier value to local-midnight epoch millis."""
    try:
        from datetime import datetime
        return int(datetime.fromisoformat(value).timestamp() * 1000)
    except ValueError:
        return None


def _fts_match(free_text: str) -> str:
    """Quote each term so user punctuation can't be parsed as FTS5 operators;
    the final term matches as a prefix for search-as-you-type."""
    terms = [t.replace('"', '""') for t in free_text.split()]
    return " ".join(f'"{t}"*' for t in terms)


def _split_list(value: str) -> list[str]:
    """The filter panel writes comma-separated OR-lists (risk:write,exec) and,
    for tool, +-joined aliases within one element (bash+run_command). A
    deliberately-empty selection is sent as the literal sentinel __none__,
    which naturally matches nothing here — no special-casing needed."""
    return [v for v in value.split(",") if v]


@app.get("/api/search")
def search(q: str = "", limit: int = 200) -> list[dict]:
    qualifiers = dict(QUALIFIER_RE.findall(q))
    free_text = QUALIFIER_RE.sub("", q).strip()

    conn = _conn()
    try:
        conditions = ["tool IS NOT NULL", COMPLETED_ACTION_FILTER]
        params: list = []

        if free_text:
            fts_ids = conn.execute(
                "SELECT rowid FROM events_fts WHERE events_fts MATCH ?", (_fts_match(free_text),)
            ).fetchall()
            ids = [r[0] for r in fts_ids]
            if not ids:
                return []
            conditions.append(f"id IN ({','.join('?' for _ in ids)})")
            params.extend(ids)

        if "risk" in qualifiers:
            values = _split_list(qualifiers["risk"])
            conditions.append("risk IN (%s)" % ",".join("?" for _ in values) if values else "0")
            params.extend(values)
        if "tool" in qualifiers:
            tokens = [t for v in _split_list(qualifiers["tool"]) for t in v.split("+")]
            if tokens:
                sub = []
                for t in tokens:
                    if t.endswith("*"):
                        sub.append("LOWER(tool) LIKE ?")
                        params.append(t[:-1].lower() + "%")
                    else:
                        sub.append("LOWER(tool) = ?")
                        params.append(t.lower())
                conditions.append("(" + " OR ".join(sub) + ")")
            else:
                conditions.append("0")
        if "kind" in qualifiers:
            conditions.append("LOWER(tool_kind) = LOWER(?)")
            params.append(qualifiers["kind"])
        if "session" in qualifiers:
            values = _split_list(qualifiers["session"])
            if values:
                conditions.append("(" + " OR ".join("session_id LIKE ?" for _ in values) + ")")
                params.extend(v + "%" for v in values)
            else:
                conditions.append("0")
        if "file" in qualifiers:
            conditions.append("arguments_json LIKE ?")
            params.append(f"%{qualifiers['file']}%")
        if "provider" in qualifiers:
            conditions.append("LOWER(provider) = LOWER(?)")
            params.append(qualifiers["provider"])
        if "exit" in qualifiers:
            # exit:fail finds every action that errored; exit:ok the inverse.
            conditions.append("exit_ok = ?")
            params.append(1 if qualifiers["exit"].lower() in {"ok", "pass", "success"} else 0)
        if "after" in qualifiers and (after_ms := _day_to_ms(qualifiers["after"])) is not None:
            conditions.append("ts >= ?")
            params.append(after_ms)
        if "before" in qualifiers and (before_ms := _day_to_ms(qualifiers["before"])) is not None:
            conditions.append("ts < ?")
            params.append(before_ms)

        sql = "SELECT * FROM events"
        if conditions:
            sql += " WHERE " + " AND ".join(conditions)
        sql += " ORDER BY ts DESC LIMIT ?"
        params.append(limit)

        rows = conn.execute(sql, params).fetchall()
        return [_event_to_dict(r) for r in rows]
    finally:
        conn.close()


@app.post("/api/reviews")
def create_review(payload: dict) -> dict:
    event_id = payload.get("event_id")
    if not isinstance(event_id, int):
        raise HTTPException(400, "event_id is required")
    conn = _conn()
    try:
        if not conn.execute("SELECT 1 FROM events WHERE id = ?", (event_id,)).fetchone():
            raise HTTPException(404, "Event not found")
        store.insert_review(conn, event_id, int(time.time() * 1000), payload.get("by"))
        conn.commit()
        row = conn.execute(
            "SELECT event_id, acknowledged_at, by FROM reviews WHERE event_id = ?", (event_id,)
        ).fetchone()
        return dict(row)
    finally:
        conn.close()


@app.get("/api/stats")
def get_stats(days: int = 14) -> dict:
    now = int(time.time() * 1000)
    recent_start = now - days * 86_400_000
    prior_start = now - 2 * days * 86_400_000
    week_start = now - 7 * 86_400_000
    prior_week_start = now - 14 * 86_400_000

    conn = _conn()
    try:
        has_any = conn.execute(
            "SELECT EXISTS(SELECT 1 FROM events WHERE tool IS NOT NULL)"
        ).fetchone()[0] == 1

        actions_total = conn.execute(
            f"SELECT COUNT(*) FROM events WHERE tool IS NOT NULL AND {COMPLETED_ACTION_FILTER}"
        ).fetchone()[0]
        actions_window = conn.execute(
            f"SELECT COUNT(*) FROM events WHERE tool IS NOT NULL AND {COMPLETED_ACTION_FILTER} AND ts >= ?",
            (recent_start,),
        ).fetchone()[0]

        cov = conn.execute(
            f"""
            SELECT
              AVG(CASE WHEN ts >= ? THEN (CASE WHEN capture_gap=0 THEN 1.0 ELSE 0 END) END) AS recent,
              AVG(CASE WHEN ts >= ? AND ts < ? THEN (CASE WHEN capture_gap=0 THEN 1.0 ELSE 0 END) END) AS prior
            FROM events WHERE tool IS NOT NULL AND {COMPLETED_ACTION_FILTER} AND ts >= ?
            """,
            (recent_start, prior_start, recent_start, prior_start),
        ).fetchone()

        provider_rows = [
            dict(r)
            for r in conn.execute(
                """
                SELECT provider,
                       COUNT(*) FILTER (WHERE ts >= ?) AS recent_count,
                       COUNT(*) FILTER (WHERE ts >= ? AND ts < ?) AS prior_count,
                       MAX(ts) AS last_ts
                FROM events WHERE provider IS NOT NULL AND tool IS NOT NULL
                GROUP BY provider
                """,
                (recent_start, prior_start, recent_start),
            ).fetchall()
        ]
        by_provider = {r["provider"]: r for r in provider_rows}
        providers_out = [
            {
                "provider": p,
                "last_event_ts": by_provider.get(p, {}).get("last_ts"),
                "active": by_provider.get(p, {}).get("recent_count", 0) > 0,
                "event_count_window": by_provider.get(p, {}).get("recent_count", 0),
            }
            for p in PROVIDERS
        ]

        shields = conn.execute(
            "SELECT COUNT(*) FROM events WHERE phase='compact' AND ts >= ?", (recent_start,)
        ).fetchone()[0]

        sensitive_this_week = conn.execute(
            f"SELECT COUNT(*) FROM events WHERE risk='sensitive' AND tool IS NOT NULL "
            f"AND {COMPLETED_ACTION_FILTER} AND ts >= ?",
            (week_start,),
        ).fetchone()[0]
        sensitive_prior_week = conn.execute(
            f"SELECT COUNT(*) FROM events WHERE risk='sensitive' AND tool IS NOT NULL "
            f"AND {COMPLETED_ACTION_FILTER} AND ts >= ? AND ts < ?",
            (prior_week_start, week_start),
        ).fetchone()[0]

        risk_day_rows = conn.execute(
            f"""
            SELECT strftime('%Y-%m-%d', ts/1000, 'unixepoch', 'localtime') AS day, risk, COUNT(*) AS n
            FROM events WHERE tool IS NOT NULL AND {COMPLETED_ACTION_FILTER} AND ts >= ?
            GROUP BY day, risk
            """,
            (recent_start,),
        ).fetchall()

        # Comma-join, not `events e JOIN sessions s` — COMPLETED_ACTION_FILTER
        # hardcodes bare `events.column` references (see session_events/search
        # above), so the events table must stay unaliased everywhere it's spliced in.
        files_rows = conn.execute(
            f"""
            SELECT events.files_touched, sessions.cwd, sessions.git_repo
            FROM events, sessions
            WHERE sessions.id = events.session_id
              AND events.tool IS NOT NULL AND {COMPLETED_ACTION_FILTER}
              AND events.files_touched IS NOT NULL AND events.files_touched NOT IN ('', '[]')
              AND events.ts >= ?
            """,
            (recent_start,),
        ).fetchall()

        needs_attention_rows = conn.execute(
            f"""
            SELECT * FROM events
            WHERE tool IS NOT NULL AND {COMPLETED_ACTION_FILTER}
              AND (risk = 'sensitive' OR capture_gap = 1)
              AND NOT EXISTS (SELECT 1 FROM reviews WHERE reviews.event_id = events.id)
            ORDER BY ts DESC LIMIT 10
            """
        ).fetchall()

        files_stats = stats_mod.files_touched_stats(
            (r["files_touched"], r["cwd"], r["git_repo"]) for r in files_rows
        )
        capture_health = stats_mod.classify_capture_health(cov["recent"], cov["prior"], provider_rows)

        return {
            "has_any_events": has_any,
            "recording_paused": store.is_paused(),
            "days": days,
            "coverage": {
                "capture_health": capture_health,
                "gap_rate_recent": (1 - cov["recent"]) if cov["recent"] is not None else None,
                "gap_rate_prior": (1 - cov["prior"]) if cov["prior"] is not None else None,
                "compaction_shields_fired": shields,
                "providers": providers_out,
            },
            "cards": {
                "sensitive_this_week": sensitive_this_week,
                "sensitive_prior_week": sensitive_prior_week,
                "actions_total": actions_total,
                "actions_window": actions_window,
                "reasoning_coverage_pct": cov["recent"],
                "files_touched_distinct": files_stats["distinct"],
                "files_touched_outside_git": files_stats["outside_git"],
            },
            "risk_by_day": stats_mod.bucket_by_day(risk_day_rows, days),
            "most_touched_files": files_stats["ranked"],
            "needs_attention": [_event_to_dict(r) for r in needs_attention_rows],
        }
    finally:
        conn.close()


@app.get("/api/recording")
def get_recording() -> dict:
    return {"paused": store.is_paused()}


@app.post("/api/recording/pause")
def pause_recording() -> dict:
    store.set_paused(True)
    return {"paused": True}


@app.post("/api/recording/resume")
def resume_recording() -> dict:
    store.set_paused(False)
    return {"paused": False}


@app.get("/api/stream")
async def stream():
    async def gen():
        conn = _conn()
        try:
            last_id = conn.execute("SELECT COALESCE(MAX(id), 0) FROM events").fetchone()[0]
            while True:
                rows = conn.execute(
                    f"SELECT * FROM events WHERE id > ? AND tool IS NOT NULL AND {COMPLETED_ACTION_FILTER} ORDER BY id ASC", (last_id,)
                ).fetchall()
                for row in rows:
                    d = _event_to_dict(row)
                    last_id = d["id"]
                    yield f"data: {json.dumps(d, default=str)}\n\n"
                await asyncio.sleep(1.0)
        finally:
            conn.close()

    return StreamingResponse(gen(), media_type="text/event-stream")


# The React viewer, mounted last so /api/* routes always win.
# ponytail: repo-relative dist path; breaks for pip-installed wheels — package
# the dist as data files if we ever ship one.
DIST_DIR = Path(__file__).resolve().parents[2] / "viewer" / "dist"
if DIST_DIR.is_dir():
    # StaticFiles(html=True) only serves index.html for "/" itself, not for
    # unmatched sub-paths — a hard refresh or direct link to the client-side
    # /timeline route would 404 without this explicit fallback. Registered
    # before the mount so it matches first; query strings (?event=5) don't
    # affect path matching.
    @app.get("/timeline")
    def timeline_route() -> FileResponse:
        return FileResponse(DIST_DIR / "index.html")

    app.mount("/", StaticFiles(directory=DIST_DIR, html=True), name="ui")
else:

    @app.get("/")
    def index() -> dict:
        return {
            "app": "zetesis",
            "api": "/api/sessions",
            "ui": "cd viewer && npm run build, or npm run dev (:5173 proxies /api)",
        }
