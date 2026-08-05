import { CircleCheck, TriangleAlert } from "lucide-react";
import type { StatsCoverage } from "../../types";
import { PROVIDER_SHORT } from "../../lib/agents";
import { ProviderIcon } from "../ProviderIcon";

interface Props {
  coverage: StatsCoverage;
  recordingPaused: boolean;
}

// "Am I covered?" — the most differentiated element on the page (see
// DESIGN.md). No daemon to poll, so every signal here is derived from DB
// state: recording flag, capture-health classification, per-provider recent
// activity, compaction-shield count.
export function CoverageStrip({ coverage, recordingPaused }: Props) {
  const healthy = coverage.capture_health === "healthy";
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-border bg-surface/40 px-5 py-3 font-mono text-xs">
      <span className="flex items-center gap-1.5 text-ink-muted">
        <span
          className={`h-2 w-2 rounded-full ${recordingPaused ? "bg-ink-faint" : "bg-rec fr-rec-dot"}`}
          aria-hidden
        />
        {recordingPaused ? "Paused" : "Recording"}
      </span>

      {/* The one full-pill exception on this page, mirroring SYS.CORE's own
          rule — every other pill here is radius-sm, ghost-outline. */}
      <span
        className={[
          "flex items-center gap-1.5 rounded-full border px-2.5 py-1",
          healthy ? "border-border text-ink-muted" : "border-risk-exec/50 text-risk-exec",
        ].join(" ")}
      >
        {healthy ? (
          <CircleCheck className="h-3 w-3" strokeWidth={1.5} aria-hidden />
        ) : (
          <TriangleAlert className="h-3 w-3" strokeWidth={1.5} aria-hidden />
        )}
        {healthy ? "Capture healthy" : "Capture degraded"}
      </span>

      <span className="mx-1 h-4 w-px bg-border" aria-hidden />

      {coverage.providers.map((p) => (
        <span
          key={p.provider}
          title={p.active ? "Fired at least once in this window" : "No events in this window"}
          className="flex items-center gap-1.5 rounded-sm border border-border px-2 py-1 text-ink-muted"
        >
          <ProviderIcon provider={p.provider} className="h-3 w-3" />
          {PROVIDER_SHORT[p.provider]}
          <span
            className={`h-1.5 w-1.5 rounded-full ${p.active ? "bg-risk-write" : "border border-ink-faint"}`}
            aria-hidden
          />
        </span>
      ))}

      <span className="ml-auto text-ink-faint">
        {coverage.compaction_shields_fired} compaction shield{coverage.compaction_shields_fired === 1 ? "" : "s"} fired
      </span>
    </div>
  );
}
