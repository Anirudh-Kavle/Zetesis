import { type RiskTier, RISK_DOT, RISK_TEXT, RISK_LABEL } from "../types";
import { RISK_ICON } from "../lib/riskIcons";

// Risk shown as dot + icon + text label — color is NEVER the only signal
// (colorblind safety). Three redundant signals, not two: the dot alone
// repeats color, the icon adds a shape-based identity channel on top.
export function RiskBadge({ risk, size = "sm" }: { risk: RiskTier; size?: "sm" | "xs" }) {
  const dot = size === "xs" ? "h-1.5 w-1.5" : "h-2 w-2";
  const icon = size === "xs" ? "h-2.5 w-2.5" : "h-3 w-3";
  const text = size === "xs" ? "text-[10px]" : "text-xs";
  const Icon = RISK_ICON[risk];
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`${dot} rounded-full ${RISK_DOT[risk]}`} aria-hidden />
      <Icon className={`${icon} shrink-0 ${RISK_TEXT[risk]}`} strokeWidth={1.5} aria-hidden />
      <span className={`${text} font-mono uppercase tracking-wide ${RISK_TEXT[risk]}`}>
        {RISK_LABEL[risk]}
      </span>
    </span>
  );
}
