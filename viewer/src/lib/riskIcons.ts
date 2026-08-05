import { Eye, Pencil, SquareTerminal, Globe, ShieldAlert, type LucideIcon } from "lucide-react";
import type { RiskTier } from "../types";

// DESIGN.md "Icons" section — one per risk tier, riding beside the existing
// dot+text as a third redundant identity signal (never color alone). Fixed
// strokeWidth applied at each call site, not baked in here, so callers stay
// free to size the icon per context.
export const RISK_ICON: Record<RiskTier, LucideIcon> = {
  info: Eye,
  write: Pencil,
  exec: SquareTerminal,
  network: Globe,
  sensitive: ShieldAlert,
};
