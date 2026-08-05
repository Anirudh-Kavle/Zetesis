import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import type { StatsCards } from "../../types";
import { trendLabel, type Trend } from "../../lib/format";

function StatCard({
  label,
  value,
  dotClass,
  delta,
  goodDirection,
  sub,
  accent,
}: {
  label: string;
  value: string;
  dotClass?: string;
  delta?: Trend;
  goodDirection?: "up" | "down";
  sub?: string;
  accent?: boolean; // top accent stripe — reserved for "did anything risky happen", and only when it did
}) {
  const deltaColor =
    !delta || delta.direction === "flat"
      ? "text-ink-faint"
      : delta.direction === goodDirection
        ? "text-risk-write"
        : "text-risk-sensitive";
  const DeltaIcon = delta?.direction === "up" ? TrendingUp : delta?.direction === "down" ? TrendingDown : Minus;
  return (
    <Card size="sm" className={accent ? "border-t-2 border-t-risk-sensitive" : undefined}>
      <CardContent className="flex flex-col gap-2">
        <span className="flex items-center gap-1.5 text-xs text-ink-muted">
          {dotClass && <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotClass}`} aria-hidden />}
          {label}
        </span>
        <span className="flex items-baseline gap-2.5">
          <span className="font-mono text-[28px] font-semibold leading-none tracking-tight text-ink">{value}</span>
          {delta && (
            <span className={`flex items-center gap-0.5 font-mono text-xs font-medium ${deltaColor}`}>
              <DeltaIcon className="h-3 w-3" strokeWidth={1.5} aria-hidden />
              {delta.label}
            </span>
          )}
        </span>
        {sub && <span className="font-mono text-[11px] text-ink-faint">{sub}</span>}
      </CardContent>
    </Card>
  );
}

// Exactly 4 cards, per the spec's "resist adding more." Every number here is
// an audit number (did anything risky happen, is capture actually working,
// what changed on disk) — no token/cost/duration metrics, ever.
export function StatCards({ cards, days }: { cards: StatsCards; days: number }) {
  const sensitiveTrend = trendLabel(cards.sensitive_this_week, cards.sensitive_prior_week);
  const coveragePct =
    cards.reasoning_coverage_pct === null ? "—" : `${Math.round(cards.reasoning_coverage_pct * 100)}%`;

  return (
    <div className="grid grid-cols-2 gap-3 px-5 py-4 md:grid-cols-4">
      <StatCard
        label="Sensitive actions this week"
        value={String(cards.sensitive_this_week)}
        dotClass="bg-risk-sensitive"
        delta={sensitiveTrend}
        goodDirection="down"
        accent={cards.sensitive_this_week > 0}
      />
      <StatCard
        label="Actions recorded"
        value={cards.actions_total.toLocaleString()}
        sub={`${cards.actions_window.toLocaleString()} in last ${days}d`}
      />
      <StatCard label="Reasoning coverage" value={coveragePct} />
      <StatCard
        label="Files touched"
        value={cards.files_touched_distinct.toLocaleString()}
        sub={
          cards.files_touched_outside_git > 0
            ? `${cards.files_touched_outside_git} outside git`
            : "all inside git"
        }
      />
    </div>
  );
}
