import type { FlightEvent, RiskDayBucket, Session, Stats, StatsProviderCoverage } from "../types";

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;
const DEGRADED_GAP_DELTA = 0.1;

function dayKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function coverageOf(list: FlightEvent[]): number | null {
  return list.length ? list.filter((e) => !e.capture_gap).length / list.length : null;
}

// Mirrors GET /api/stats (zetesis/viewer/app.py + stats.py) over the mock
// fixture instead of SQLite — this IS the sample-data/zero-state toggle the
// dashboard spec asked for (VITE_USE_MOCK), not a second mode to maintain.
export function computeMockStats(events: FlightEvent[], _sessions: Session[], days = 14): Stats {
  const now = Date.now();
  const recentStart = now - days * DAY_MS;
  const priorStart = now - 2 * days * DAY_MS;
  const weekStart = now - WEEK_MS;
  const priorWeekStart = now - 2 * WEEK_MS;

  // Mock events are all already "completed" (phase: "post") — no pre/post
  // dedup needed, unlike the real backend's COMPLETED_ACTION_FILTER.
  const recentEvents = events.filter((e) => e.ts >= recentStart);
  const priorEvents = events.filter((e) => e.ts >= priorStart && e.ts < recentStart);

  const coverageRecent = coverageOf(recentEvents);
  const coveragePrior = coverageOf(priorEvents);
  const gapRateRecent = coverageRecent === null ? null : 1 - coverageRecent;
  const gapRatePrior = coveragePrior === null ? null : 1 - coveragePrior;

  const providers: StatsProviderCoverage[] = (["claude", "codex", "openai-api"] as const).map((p) => {
    const providerEvents = events.filter((e) => e.provider === p);
    const recentCount = providerEvents.filter((e) => e.ts >= recentStart).length;
    const lastTs = providerEvents.length ? Math.max(...providerEvents.map((e) => e.ts)) : null;
    return { provider: p, last_event_ts: lastTs, active: recentCount > 0, event_count_window: recentCount };
  });

  const degradedGap =
    gapRateRecent !== null && gapRatePrior !== null && gapRateRecent - gapRatePrior >= DEGRADED_GAP_DELTA;
  const providerWentSilent = providers.some((p) => {
    const providerEvents = events.filter((e) => e.provider === p.provider);
    const priorCount = providerEvents.filter((e) => e.ts >= priorStart && e.ts < recentStart).length;
    return priorCount > 0 && p.event_count_window === 0;
  });

  // Files touched — mock fixture paths are always project-relative and every
  // mock session carries a git_repo, so nothing in the demo data is
  // genuinely "outside git" (unlike the real path-prefix check in stats.py).
  const fileCounts = new Map<string, number>();
  for (const e of recentEvents) {
    for (const f of e.files_touched ?? []) {
      fileCounts.set(f, (fileCounts.get(f) ?? 0) + 1);
    }
  }
  const rankedFiles = [...fileCounts.entries()]
    .map(([path, count]) => ({ path, count, outside_git: false }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  const byDay = new Map<string, Partial<Record<FlightEvent["risk"], number>>>();
  for (const e of recentEvents) {
    const key = dayKey(e.ts);
    const bucket = byDay.get(key) ?? {};
    bucket[e.risk] = (bucket[e.risk] ?? 0) + 1;
    byDay.set(key, bucket);
  }
  const riskByDay: RiskDayBucket[] = Array.from({ length: days }, (_, i) => {
    const key = dayKey(now - (days - 1 - i) * DAY_MS);
    const bucket = byDay.get(key) ?? {};
    return {
      date: key,
      info: bucket.info ?? 0,
      write: bucket.write ?? 0,
      exec: bucket.exec ?? 0,
      network: bucket.network ?? 0,
      sensitive: bucket.sensitive ?? 0,
    };
  });

  const needsAttention = [...events]
    .filter((e) => e.risk === "sensitive" || e.capture_gap)
    .sort((a, b) => b.ts - a.ts)
    .slice(0, 10);

  return {
    has_any_events: events.length > 0,
    recording_paused: false,
    days,
    coverage: {
      capture_health: degradedGap || providerWentSilent ? "degraded" : "healthy",
      gap_rate_recent: gapRateRecent,
      gap_rate_prior: gapRatePrior,
      compaction_shields_fired: 0, // no phase:"compact" rows in the mock fixture
      providers,
    },
    cards: {
      sensitive_this_week: events.filter((e) => e.risk === "sensitive" && e.ts >= weekStart).length,
      sensitive_prior_week: events.filter(
        (e) => e.risk === "sensitive" && e.ts >= priorWeekStart && e.ts < weekStart
      ).length,
      actions_total: events.length,
      actions_window: recentEvents.length,
      reasoning_coverage_pct: coverageRecent,
      files_touched_distinct: fileCounts.size,
      files_touched_outside_git: 0,
    },
    risk_by_day: riskByDay,
    most_touched_files: rankedFiles,
    needs_attention: needsAttention,
  };
}
