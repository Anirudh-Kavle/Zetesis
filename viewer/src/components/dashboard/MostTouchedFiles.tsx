import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { MostTouchedFile } from "../../types";
import { navigate } from "../../lib/router";

interface Props {
  files: MostTouchedFile[];
}

// Ranked list, not a chart (per spec) — each row drills into the timeline
// pre-filtered to that file via the existing `file:` search qualifier.
export function MostTouchedFiles({ files }: Props) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Most-touched files</CardTitle>
        <CardDescription>
          {files.length === 0 ? "No files touched in this window" : "Ranked by touches in this window"}
        </CardDescription>
      </CardHeader>
      {files.length > 0 && (
        <CardContent className="flex flex-col gap-1">
          {files.map((f) => (
            <button
              key={f.path}
              onClick={() => navigate(`/timeline?q=${encodeURIComponent(`file:${f.path}`)}`)}
              className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-left transition-colors hover:bg-surface/70 active:scale-[0.99]"
            >
              <span className="min-w-0 flex-1 truncate font-mono text-xs text-ink">{f.path}</span>
              {f.outside_git && (
                <span className="shrink-0 rounded-sm border border-risk-exec/50 px-1.5 py-0.5 font-mono text-[10px] text-risk-exec">
                  outside git
                </span>
              )}
              <span className="shrink-0 font-mono text-xs tabular-nums text-ink-faint">{f.count}</span>
            </button>
          ))}
        </CardContent>
      )}
    </Card>
  );
}
