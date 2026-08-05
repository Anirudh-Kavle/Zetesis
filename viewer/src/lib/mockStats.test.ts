import { describe, expect, it } from "vitest";
import { mockEvents, mockSessions } from "./mockData";
import { computeMockStats } from "./mockStats";

// Fixture is 7 "live demo" events (near `now`) + 20 historical events spread
// across days 1-13 (ids 10-29, see mockData.ts's HISTORICAL table), giving
// the dashboard's charts something real to show. Counts below are computed
// directly from that table, not re-derived from computeMockStats itself.
describe("computeMockStats", () => {
  it("reports has_any_events true for the seeded fixture", () => {
    expect(computeMockStats(mockEvents, mockSessions, 14).has_any_events).toBe(true);
  });

  it("reports has_any_events false for an empty event list", () => {
    expect(computeMockStats([], [], 14).has_any_events).toBe(false);
  });

  it("counts sensitive events across this week vs. the prior week", () => {
    const stats = computeMockStats(mockEvents, mockSessions, 14);
    // This week: original id 4 (~now) + historical ids 14 (3d ago), 19 (6d ago).
    expect(stats.cards.sensitive_this_week).toBe(3);
    // Prior week: historical id 25 (11d ago) only.
    expect(stats.cards.sensitive_prior_week).toBe(1);
  });

  it("excludes the one capture_gap event from the reasoning-coverage numerator", () => {
    const stats = computeMockStats(mockEvents, mockSessions, 14);
    // 26 of the 27 fixture events have capture_gap: false (only original id 6 is a gap).
    expect(stats.cards.reasoning_coverage_pct).toBeCloseTo(26 / 27);
  });

  it("counts actions_total against the full 27-event fixture (7 live + 20 historical)", () => {
    expect(computeMockStats(mockEvents, mockSessions, 14).cards.actions_total).toBe(27);
  });

  it("ranks touched files across the enriched fixture, config/deploy.yaml still on top", () => {
    const stats = computeMockStats(mockEvents, mockSessions, 14);
    // 2 original paths + 5 distinct historical paths.
    expect(stats.cards.files_touched_distinct).toBe(7);
    const top = stats.most_touched_files[0];
    expect(top.path).toBe("config/deploy.yaml");
    expect(top.count).toBe(3);
    expect(top.outside_git).toBe(false);
  });

  it("marks all three mock providers active within the window", () => {
    const stats = computeMockStats(mockEvents, mockSessions, 14);
    const byProvider = Object.fromEntries(stats.coverage.providers.map((p) => [p.provider, p]));
    expect(byProvider.claude.active).toBe(true);
    expect(byProvider.codex.active).toBe(true);
    expect(byProvider["openai-api"].active).toBe(true);
  });

  it("puts every sensitive/capture_gap event into needs_attention, newest first", () => {
    const stats = computeMockStats(mockEvents, mockSessions, 14);
    // id4 (~now) > id6 (~50m ago) > id14 (3d) > id19 (6d) > id25 (11d).
    expect(stats.needs_attention.map((e) => e.id)).toEqual([4, 6, 14, 19, 25]);
  });

  it("returns exactly `days` buckets, oldest to newest, summing to every event", () => {
    const stats = computeMockStats(mockEvents, mockSessions, 14);
    expect(stats.risk_by_day).toHaveLength(14);
    const dates = stats.risk_by_day.map((d) => d.date);
    expect(dates).toEqual([...dates].sort());
    const total = stats.risk_by_day.reduce(
      (sum, d) => sum + d.info + d.write + d.exec + d.network + d.sensitive,
      0
    );
    expect(total).toBe(27);
  });

  it("spreads historical activity across most of the 14-day window, not just today", () => {
    // The whole point of the historical fixture: RiskFrequencyMap must have
    // more than one non-empty column to actually look like a chart.
    const stats = computeMockStats(mockEvents, mockSessions, 14);
    const nonEmptyDays = stats.risk_by_day.filter(
      (d) => d.info + d.write + d.exec + d.network + d.sensitive > 0
    );
    expect(nonEmptyDays.length).toBeGreaterThanOrEqual(10);
  });
});
