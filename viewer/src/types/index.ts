import type { KnownProvider, Provider } from "../lib/agents";

// Zetesis event types — mirror of the SQLite `events` row (spec 3.3).
export type RiskTier = "info" | "write" | "exec" | "network" | "sensitive";

export interface FlightEvent {
  id: number;
  session_id: string;
  ts: number; // ms epoch
  phase: "pre" | "post" | "compact" | "session";
  tool: string;
  provider: Provider; // which agent's hook recorded this event
  turn_id?: string; // groups every action from the same single prompt/turn
  arguments_json: Record<string, unknown>;
  result_json?: Record<string, unknown>;
  exit_ok: boolean | null; // null = no PostToolUse observed yet — unresolved, not "ok"
  risk: RiskTier;
  risk_reasons?: string;
  reasoning_text?: string;
  capture_gap: boolean;
  git_branch?: string;
  git_head?: string;
  git_dirty: boolean | null; // null = git status unavailable (no repo, git missing, timed out)
  files_touched?: string[];
  created_at: number;
}

// Deterministic per-session counts computed by SQL on the backend.
// Absent in mock mode, where the UI derives them from loaded events instead.
export interface SessionStats {
  action_count: number;
  edit_count: number;
  bash_count: number;
  failed_count: number;
  sensitive_count: number;
  git_branch?: string;
}

export interface Session {
  id: string;
  started_at: number;
  ended_at?: number;
  cwd: string;
  git_repo?: string;
  source: "interactive" | "headless" | "resumed";
  provider: Provider; // agent that started this session, derived from its earliest event
  label?: string; // human-friendly name for the sidebar
  live?: boolean; // currently recording
  stats?: SessionStats;
  // Derived project identity: repo root when in git, else the working folder.
  project_key?: string; // full path — the grouping key
  project?: string; // folder/repo basename — the display name
  // API-agent budget limits (rate limiter), editable from the TopBar.
  token_limit?: number;
  token_used?: number;
  time_limit_s?: number;
}

export const RISK_TIERS: RiskTier[] = [
  "info",
  "write",
  "exec",
  "network",
  "sensitive",
];

export const RISK_LABEL: Record<RiskTier, string> = {
  info: "info",
  write: "write",
  exec: "exec",
  network: "network",
  sensitive: "sensitive",
};

// Semantic token classes (defined in index.css @theme). Color is never the only signal.
export const RISK_DOT: Record<RiskTier, string> = {
  info: "bg-risk-info",
  write: "bg-risk-write",
  exec: "bg-risk-exec",
  network: "bg-risk-network",
  sensitive: "bg-risk-sensitive",
};

export const RISK_TEXT: Record<RiskTier, string> = {
  info: "text-risk-info",
  write: "text-risk-write",
  exec: "text-risk-exec",
  network: "text-risk-network",
  sensitive: "text-risk-sensitive",
};

// --- Dashboard (/api/stats) ---

export interface StatsProviderCoverage {
  provider: KnownProvider;
  last_event_ts: number | null;
  active: boolean; // fired at least once in the requested window
  event_count_window: number;
}

export interface StatsCoverage {
  capture_health: "healthy" | "degraded";
  gap_rate_recent: number | null;
  gap_rate_prior: number | null;
  compaction_shields_fired: number;
  providers: StatsProviderCoverage[];
}

export interface StatsCards {
  sensitive_this_week: number;
  sensitive_prior_week: number;
  actions_total: number;
  actions_window: number;
  reasoning_coverage_pct: number | null; // null when the window has zero tool-call events
  files_touched_distinct: number;
  files_touched_outside_git: number;
}

// One row of RiskFrequencyMap — a count per risk tier for a single day.
export interface RiskDayBucket extends Record<RiskTier, number> {
  date: string; // YYYY-MM-DD, local time
}

export interface MostTouchedFile {
  path: string;
  count: number;
  outside_git: boolean;
}

export interface Stats {
  has_any_events: boolean; // gates the whole dashboard's zero-state
  recording_paused: boolean;
  days: number;
  coverage: StatsCoverage;
  cards: StatsCards;
  risk_by_day: RiskDayBucket[];
  most_touched_files: MostTouchedFile[];
  needs_attention: FlightEvent[];
}
