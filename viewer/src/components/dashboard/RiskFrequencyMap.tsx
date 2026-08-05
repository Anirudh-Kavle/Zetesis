import { Fragment } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { RISK_TIERS, RISK_LABEL, type RiskDayBucket, type RiskTier } from "../../types";
import { RiskBadge } from "../RiskBadge";

const MIN_SIZE = 4;
const MAX_SIZE = 20;
const SENSITIVE_FLOOR_SIZE = 11; // a single sensitive event must never scale down to invisible

const RISK_COLOR_VAR: Record<RiskTier, string> = {
  info: "var(--color-risk-info)",
  write: "var(--color-risk-write)",
  exec: "var(--color-risk-exec)",
  network: "var(--color-risk-network)",
  sensitive: "var(--color-risk-sensitive)",
};

function dotMetrics(count: number, maxInRow: number, tier: RiskTier): { size: number; glow: number; fill: number } {
  if (count === 0) return { size: MIN_SIZE, glow: 0, fill: 0.45 };
  const ratio = maxInRow > 0 ? count / maxInRow : 1;
  let size = MIN_SIZE + ratio * (MAX_SIZE - MIN_SIZE);
  if (tier === "sensitive") size = Math.max(size, SENSITIVE_FLOOR_SIZE);
  return { size, glow: 0.35 + ratio * 0.65, fill: 1 };
}

function dayNumber(dateStr: string): string {
  return String(new Date(dateStr + "T00:00:00").getDate());
}

interface Props {
  riskByDay: RiskDayBucket[]; // oldest -> newest, zero-filled per day/tier
}

// The "identity chart" — a dot-matrix adapted from SYS.CORE's Event
// Frequency Map (see DESIGN.md). Rows are risk tiers (fixed color, never
// recolored by magnitude); only dot size + glow encode volume, normalized
// per row so a quiet tier never reads as empty next to a busy one. The
// radial-glow backdrop is the one gradient SYS.CORE sanctions anywhere in
// its system — reserved for exactly this, the page's hero visualization.
export function RiskFrequencyMap({ riskByDay }: Props) {
  const showEveryLabel = riskByDay.length <= 14;
  const maxByTier = Object.fromEntries(
    RISK_TIERS.map((tier) => [tier, Math.max(0, ...riskByDay.map((d) => d[tier]))])
  ) as Record<RiskTier, number>;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Activity by risk tier</CardTitle>
        <CardDescription>Last {riskByDay.length} days</CardDescription>
      </CardHeader>
      <CardContent>
        <div
          className="rounded-lg py-4"
          style={{
            background:
              "radial-gradient(ellipse at center, rgba(255,255,255,0.035) 0%, rgba(255,255,255,0.01) 45%, transparent 72%)",
          }}
        >
          <div
            className="grid items-center gap-y-3"
            style={{ gridTemplateColumns: `5.5rem repeat(${riskByDay.length}, minmax(0, 1fr))` }}
          >
            {RISK_TIERS.map((tier) => (
              <Fragment key={tier}>
                <div className="pr-2">
                  <RiskBadge risk={tier} size="xs" />
                </div>
                {riskByDay.map((day) => {
                  const count = day[tier];
                  const { size, glow, fill } = dotMetrics(count, maxByTier[tier], tier);
                  const color = RISK_COLOR_VAR[tier];
                  return (
                    <div key={`${tier}-${day.date}`} className="flex items-center justify-center">
                      <span
                        title={`${RISK_LABEL[tier]} · ${day.date} · ${count} event${count === 1 ? "" : "s"}`}
                        className="block rounded-full"
                        style={{
                          width: size,
                          height: size,
                          backgroundColor: color,
                          opacity: fill,
                          boxShadow:
                            glow > 0
                              ? `0 0 ${size * 1.8}px color-mix(in srgb, ${color} ${glow * 100}%, transparent)`
                              : "none",
                        }}
                      />
                    </div>
                  );
                })}
              </Fragment>
            ))}

            {/* Day axis — sparse beyond 14 columns to avoid crowding. */}
            <div />
            {riskByDay.map((day, i) => (
              <div key={`axis-${day.date}`} className="text-center font-mono text-[9px] text-ink-faint">
                {showEveryLabel || i % 3 === 0 ? dayNumber(day.date) : ""}
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
