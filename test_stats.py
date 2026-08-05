"""Gate tests for zetesis/viewer/stats.py — pure functions, no DB, no fixtures.
Run: .venv/bin/python -m pytest test_stats.py
"""
from zetesis.viewer import stats


def test_resolve_touched_path_absolute_passthrough():
    assert stats.resolve_touched_path("/repo/src/a.py", "/somewhere/else") == "/repo/src/a.py"


def test_resolve_touched_path_relative_joins_cwd():
    assert stats.resolve_touched_path("src/a.py", "/repo") == "/repo/src/a.py"


def test_is_outside_git_true_when_no_repo():
    assert stats.is_outside_git("/repo/src/a.py", None) is True


def test_is_outside_git_false_when_inside():
    assert stats.is_outside_git("/repo/src/a.py", "/repo") is False


def test_is_outside_git_true_when_outside_repo_root():
    assert stats.is_outside_git("/tmp/scratch.py", "/repo") is True


def test_display_path_relative_to_repo():
    assert stats.display_path("/repo/src/a.py", "/repo") == "src/a.py"


def test_display_path_falls_back_to_absolute_outside_repo():
    assert stats.display_path("/tmp/scratch.py", "/repo") == "/tmp/scratch.py"


def test_files_touched_stats_ranks_by_count_and_caps_limit():
    rows = [
        ('["a.py"]', "/repo", "/repo"),
        ('["a.py"]', "/repo", "/repo"),
        ('["b.py"]', "/repo", "/repo"),
    ]
    result = stats.files_touched_stats(rows, limit=1)
    assert result["distinct"] == 2
    assert len(result["ranked"]) == 1
    assert result["ranked"][0]["path"] == "a.py"
    assert result["ranked"][0]["count"] == 2


def test_files_touched_stats_dedupes_same_file_across_events():
    rows = [
        ('["src/a.py"]', "/repo", "/repo"),
        ('["src/a.py"]', "/repo", "/repo"),
    ]
    result = stats.files_touched_stats(rows)
    assert result["distinct"] == 1
    assert result["ranked"][0]["count"] == 2


def test_files_touched_stats_flags_outside_git():
    rows = [
        ('["/tmp/scratch.py"]', "/repo", "/repo"),
        ('["src/a.py"]', "/repo", "/repo"),
    ]
    result = stats.files_touched_stats(rows)
    assert result["outside_git"] == 1


def test_files_touched_stats_tolerates_garbage_json():
    rows = [("not json", "/repo", "/repo"), (None, "/repo", "/repo"), ("{}", "/repo", "/repo")]
    result = stats.files_touched_stats(rows)
    assert result == {"distinct": 0, "outside_git": 0, "ranked": []}


def test_bucket_by_day_fills_zero_days():
    result = stats.bucket_by_day([], 3)
    assert len(result) == 3
    for day in result:
        for tier in ("info", "write", "exec", "network", "sensitive"):
            assert day[tier] == 0


def test_bucket_by_day_orders_oldest_to_newest():
    result = stats.bucket_by_day([], 5)
    dates = [d["date"] for d in result]
    assert dates == sorted(dates)


def test_bucket_by_day_applies_sql_counts():
    from datetime import date
    today = date.today().isoformat()
    rows = [{"day": today, "risk": "sensitive", "n": 4}]
    result = stats.bucket_by_day(rows, 1)
    assert result[0]["sensitive"] == 4
    assert result[0]["info"] == 0


def test_classify_capture_health_healthy_when_no_signal():
    assert stats.classify_capture_health(None, None, []) == "healthy"


def test_classify_capture_health_degraded_on_gap_rate_regression():
    # coverage dropped from 0.95 to 0.80 → gap rate rose 0.05 -> 0.20, a 15-point regression
    assert stats.classify_capture_health(0.80, 0.95, []) == "degraded"


def test_classify_capture_health_healthy_on_small_gap_fluctuation():
    # coverage dipped from 0.95 to 0.90 → only a 5-point regression, under the 10-point threshold
    assert stats.classify_capture_health(0.90, 0.95, []) == "healthy"


def test_classify_capture_health_degraded_when_active_provider_goes_silent():
    provider_rows = [{"provider": "claude", "prior_count": 10, "recent_count": 0}]
    assert stats.classify_capture_health(1.0, 1.0, provider_rows) == "degraded"


def test_classify_capture_health_healthy_when_provider_never_used():
    provider_rows = [{"provider": "codex", "prior_count": 0, "recent_count": 0}]
    assert stats.classify_capture_health(1.0, 1.0, provider_rows) == "healthy"
