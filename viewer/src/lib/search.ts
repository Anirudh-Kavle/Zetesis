import type { FlightEvent, Session } from "../types";
import { eventSummary } from "./format";

export interface ParsedQuery {
  text: string[]; // free-text terms
  tool?: string;
  risk?: string;
  file?: string;
  session?: string;
}

const QUALIFIERS = ["tool", "risk", "file", "session"] as const;

// Hand-rolled qualifier parser (spec 3.2) — tool: risk: file: session: + free text. No lib.
export function parseQuery(q: string): ParsedQuery {
  const out: ParsedQuery = { text: [] };
  for (const token of q.trim().split(/\s+/).filter(Boolean)) {
    const m = token.match(/^(\w+):(.*)$/);
    if (m && (QUALIFIERS as readonly string[]).includes(m[1])) {
      (out as unknown as Record<string, string>)[m[1]] = m[2].toLowerCase();
    } else {
      out.text.push(token.toLowerCase());
    }
  }
  return out;
}

// Which qualifier the user is mid-typing, for the chip hint UI.
export function activeQualifier(q: string): string | null {
  const last = q.split(/\s+/).pop() ?? "";
  const m = last.match(/^(\w+):$/);
  return m && (QUALIFIERS as readonly string[]).includes(m[1]) ? m[1] : null;
}

// session: can match either the raw id or the human-readable sidebar title.
export function sessionTitleMap(sessions: Session[]): Map<string, string> {
  return new Map(sessions.filter((s) => s.label).map((s) => [s.id, s.label!]));
}

export function filterEvents(
  events: FlightEvent[],
  q: string,
  sessionTitles?: Map<string, string>
): FlightEvent[] {
  const p = parseQuery(q);
  return events.filter((e) => {
    if (p.tool && e.tool.toLowerCase() !== p.tool) return false;
    if (p.risk && e.risk !== p.risk) return false;
    if (p.session) {
      const idMatch = e.session_id.toLowerCase().includes(p.session);
      const title = sessionTitles?.get(e.session_id);
      const titleMatch = title ? title.toLowerCase().includes(p.session) : false;
      if (!idMatch && !titleMatch) return false;
    }
    if (p.file) {
      const files = (e.files_touched ?? []).join(" ").toLowerCase();
      if (!files.includes(p.file)) return false;
    }
    if (p.text.length) {
      const hay = (
        eventSummary(e) +
        " " +
        (e.reasoning_text ?? "") +
        " " +
        e.tool
      ).toLowerCase();
      if (!p.text.every((t) => hay.includes(t))) return false;
    }
    return true;
  });
}

export const SEARCH_QUALIFIERS = QUALIFIERS;
