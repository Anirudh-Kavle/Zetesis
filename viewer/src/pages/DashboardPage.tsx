import { useCallback, useEffect, useState } from "react";
import { TriangleAlert } from "lucide-react";
import type { Stats } from "../types";
import { dataSource } from "../lib/dataSource";
import { useEventStream } from "../hooks/useEventStream";
import { EmptyState } from "../components/EmptyState";
import { Skeleton } from "../components/Skeleton";
import { CoverageStrip } from "../components/dashboard/CoverageStrip";
import { StatCards } from "../components/dashboard/StatCards";
import { RiskFrequencyMap } from "../components/dashboard/RiskFrequencyMap";
import { MostTouchedFiles } from "../components/dashboard/MostTouchedFiles";
import { NeedsAttention } from "../components/dashboard/NeedsAttention";
import { LatestActivity } from "../components/dashboard/LatestActivity";

const DAYS = 14;

// "Am I covered? Did anything risky happen? What changed?" — the dashboard
// landing page (readme-inspo/dashboard-spec.md, viewer/DESIGN.md). Fetches
// its own stats snapshot; the live event stream (for "Latest activity") is
// shared with TimelinePage only in the sense that both call the same hook —
// they're never mounted at once, so there's no duplicate SSE connection.
export function DashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState(false);
  const { events } = useEventStream();

  const load = useCallback(() => {
    setError(false);
    setStats(null);
    dataSource.getStats(DAYS).then(setStats).catch(() => setError(true));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (error) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-5 text-center">
        <TriangleAlert className="h-6 w-6 text-risk-exec" strokeWidth={1.5} aria-hidden />
        <p className="text-sm text-ink-muted">Couldn't load dashboard stats. The backend may be unreachable.</p>
        <button
          onClick={load}
          className="cursor-pointer rounded-md border border-border px-3 py-1.5 font-mono text-xs text-ink-muted transition-colors hover:border-rec hover:text-rec active:scale-95"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="p-5">
        <Skeleton rows={8} />
      </div>
    );
  }

  if (!stats.has_any_events) {
    return <EmptyState mode="no-events" />;
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-[1600px] flex-col">
        <section aria-label="Coverage">
          <CoverageStrip coverage={stats.coverage} recordingPaused={stats.recording_paused} />
        </section>

        <section aria-label="Key stats">
          <StatCards cards={stats.cards} days={stats.days} />
        </section>

        <section aria-label="Activity charts" className="grid grid-cols-1 gap-4 px-5 py-2 xl:grid-cols-[2fr_1fr]">
          <RiskFrequencyMap riskByDay={stats.risk_by_day} />
          <MostTouchedFiles files={stats.most_touched_files} />
        </section>

        <section aria-label="Needs attention">
          <NeedsAttention events={stats.needs_attention} />
        </section>

        <section aria-label="Latest activity">
          <LatestActivity events={events} />
        </section>
      </div>
    </div>
  );
}
