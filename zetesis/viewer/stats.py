"""Pure aggregation helpers for /api/stats. No DB access here — app.py fetches
rows, this module turns them into the dashboard's shapes. Same split as
risk.py: pure/testable logic here, I/O in app.py."""
from __future__ import annotations

import json
import os
from datetime import date, timedelta
from pathlib import Path
from typing import Iterable, Literal

from .. import risk

DEGRADED_GAP_DELTA = 0.10  # 10-point reasoning-coverage regression = degraded


def resolve_touched_path(raw: str, cwd: str | None) -> str:
    """Claude reports absolute paths; Codex's apply_patch reports repo-relative
    ones. os.path.isabs distinguishes them without provider-specific logic."""
    if os.path.isabs(raw):
        return os.path.normpath(raw)
    return os.path.normpath(os.path.join(cwd or "", raw))


def is_outside_git(abs_path: str, git_repo: str | None) -> bool:
    """No git_repo on the session at all -> can't confirm it's tracked -> counted
    as outside-git. Absence of proof of coverage is not proof of coverage — the
    conservative default matches the tool's audit purpose."""
    if not git_repo:
        return True
    try:
        return not Path(abs_path).is_relative_to(Path(git_repo))
    except (OSError, ValueError):
        return True


def display_path(abs_path: str, git_repo: str | None) -> str:
    """Repo-relative for the ranked list when possible; the raw absolute path
    otherwise."""
    if git_repo:
        try:
            return str(Path(abs_path).relative_to(git_repo))
        except ValueError:
            pass
    return abs_path


def files_touched_stats(
    rows: Iterable[tuple[str | None, str | None, str | None]], limit: int = 8
) -> dict:
    """rows: (files_touched_json, cwd, git_repo) per matching event."""
    counts: dict[str, dict] = {}
    for files_json, cwd, git_repo in rows:
        try:
            paths = json.loads(files_json) if files_json else []
        except (json.JSONDecodeError, TypeError):
            continue
        if not isinstance(paths, list):
            continue
        for raw in paths:
            if not raw:
                continue
            abs_path = resolve_touched_path(str(raw), cwd)
            outside = is_outside_git(abs_path, git_repo)
            key = display_path(abs_path, git_repo)
            entry = counts.setdefault(key, {"path": key, "count": 0, "outside_git": outside})
            entry["count"] += 1
            entry["outside_git"] = entry["outside_git"] or outside
    ranked = sorted(counts.values(), key=lambda e: e["count"], reverse=True)[:limit]
    return {
        "distinct": len(counts),
        "outside_git": sum(1 for e in counts.values() if e["outside_git"]),
        "ranked": ranked,
    }


def bucket_by_day(sql_rows, days: int) -> list[dict]:
    """sql_rows: iterable of rows with ["day"]/["risk"]/["n"] (a GROUP BY day,
    risk result). Fills every day/tier combo missing from the SQL result with 0
    so the frequency map never silently drops a day or a tier."""
    by_day: dict[str, dict[str, int]] = {}
    for row in sql_rows:
        by_day.setdefault(row["day"], {})[row["risk"]] = row["n"]
    today = date.today()
    return [
        {"date": d, **{t: by_day.get(d, {}).get(t, 0) for t in risk.TIER_ORDER}}
        for d in (
            (today - timedelta(days=i)).isoformat() for i in range(days - 1, -1, -1)
        )
    ]


def classify_capture_health(
    coverage_recent: float | None,
    coverage_prior: float | None,
    provider_rows: list[dict],  # each: {"provider", "recent_count", "prior_count"}
) -> Literal["healthy", "degraded"]:
    """Derived purely from DB state (no daemon to ask, no fr doctor to shell
    out to). Two signals: (1) reasoning-gap rate got meaningfully worse between
    the prior and recent windows, or (2) a provider that WAS active in the
    prior window has gone fully silent in the recent one."""
    if coverage_recent is not None and coverage_prior is not None:
        gap_recent, gap_prior = 1 - coverage_recent, 1 - coverage_prior
        if gap_recent - gap_prior >= DEGRADED_GAP_DELTA:
            return "degraded"
    if any(p["prior_count"] > 0 and p["recent_count"] == 0 for p in provider_rows):
        return "degraded"
    return "healthy"
