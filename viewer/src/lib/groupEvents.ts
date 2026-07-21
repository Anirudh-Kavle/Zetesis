import type { FlightEvent } from "../types";
import type { ToolKind } from "./agents";
import { eventSummary } from "./format";

// Mirrors flight_recorder/tools.py's action_kind() closely enough for
// grouping purposes — exact parity isn't needed here (e.g. apply_patch's
// real write-vs-edit split depends on patch body, which we don't have
// client-side), just a stable, coarse bucket per raw tool name.
const READ_NAMES = /(^|__)(read|view|list|find|glob|grep|search)(_|$)/i;
const WEB_NAMES = /(web[_-]?(fetch|search)|browser|http|url)/i;

function kindOf(tool: string): ToolKind {
  const lower = tool.toLowerCase();
  if (lower === "bash" || lower === "run_command" || lower === "shell") return "bash";
  if (lower === "apply_patch" || lower === "edit" || lower === "notebookedit") return "edit";
  if (lower === "write" || lower === "write_file") return "write";
  if (["read", "read_file", "list_files", "glob", "grep", "ls"].includes(lower)) return "read";
  if (lower === "webfetch" || lower === "websearch" || WEB_NAMES.test(tool)) return "webfetch";
  if (lower.startsWith("mcp__")) return "mcp";
  if (READ_NAMES.test(tool)) return "read";
  return "other";
}

const KIND_VERB: Record<ToolKind, string> = {
  read: "Explored",
  write: "Created",
  edit: "Edited",
  bash: "Ran",
  webfetch: "Fetched",
  mcp: "Called",
  other: "Did",
};
const KIND_NOUN: Record<ToolKind, string> = {
  read: "file",
  write: "file",
  edit: "file",
  bash: "command",
  webfetch: "URL",
  mcp: "MCP tool",
  other: "action",
};

function kindLabel(kind: ToolKind, count: number): string {
  return `${KIND_VERB[kind]} ${count} ${KIND_NOUN[kind]}${count > 1 ? "s" : ""}`;
}

// Fallback clustering window for events with no turn_id recorded (older rows
// from before this field existed) — same-kind actions in the same session
// within this many ms of the previous one in the run still cluster.
const WINDOW_MS = 60_000;

export interface EventGroup {
  key: string;
  events: FlightEvent[]; // 1+, same order as input
}

export interface GroupSummary {
  badge: string; // short badge text for the collapsed row — a ToolKind, or "turn" when the group mixes kinds
  label: string; // e.g. "Explored 4 files" or "6 actions (3 files, 2 commands, 1 URL)"
  preview: string; // distinct summaries touched, so skimming doesn't require expanding
}

// risk:sensitive events never join a group and never let anything else join
// them — they always render as their own full row. That's the one place
// "easy to backtrack on errors" is non-negotiable: nothing dangerous should
// ever be hidden behind a summary someone has to think to expand.
//
// Grouping prefers turn_id — every action from the same single prompt (the
// hook mints/reuses one turn_id per UserPromptSubmit for Claude, Codex's own
// payload sometimes already supplies one, and the API agent stamps one per
// run_turn() call) collapses together, however many different kinds of tool
// it used. Only when either event has no turn_id at all (older recorded
// data) does it fall back to the coarser kind+time-window heuristic.
export function groupConsecutive(events: FlightEvent[]): EventGroup[] {
  const groups: EventGroup[] = [];
  for (const e of events) {
    const last = groups[groups.length - 1];
    const head = last?.events[last.events.length - 1];
    const canJoin =
      head !== undefined &&
      e.risk !== "sensitive" &&
      head.risk !== "sensitive" &&
      head.session_id === e.session_id &&
      (head.turn_id && e.turn_id
        ? head.turn_id === e.turn_id
        : !head.turn_id && !e.turn_id && kindOf(head.tool) === kindOf(e.tool) && Math.abs(e.ts - head.ts) <= WINDOW_MS);
    if (canJoin) {
      last.events.push(e);
    } else {
      groups.push({ key: `g${e.id}`, events: [e] });
    }
  }
  return groups;
}

export function summarizeGroup(events: FlightEvent[]): GroupSummary {
  const counts = new Map<ToolKind, number>();
  for (const e of events) {
    const k = kindOf(e.tool);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const summaries = [...new Set(events.map(eventSummary))].filter(Boolean);
  const preview = summaries.length > 3 ? `${summaries.slice(0, 3).join(", ")} +${summaries.length - 3} more` : summaries.join(", ");

  if (counts.size === 1) {
    const [kind] = counts.keys();
    return { badge: kind, label: kindLabel(kind, events.length), preview };
  }
  const parts = [...counts.entries()].map(([k, n]) => `${n} ${KIND_NOUN[k]}${n > 1 ? "s" : ""}`);
  return { badge: "turn", label: `${events.length} actions (${parts.join(", ")})`, preview };
}
