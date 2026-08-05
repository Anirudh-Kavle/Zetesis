import { Button } from "@/components/ui/button";
import { EventRow } from "../EventRow";
import type { FlightEvent } from "../../types";
import { navigate } from "../../lib/router";
import { byNewest } from "../../lib/format";

interface Props {
  events: FlightEvent[]; // full live stream — sliced to 5 here
}

// Exactly 5 rows reusing the existing compact EventRow — no new row UI, per
// spec. No detail drawer on the dashboard itself: a row click deep-links
// straight into the timeline with that event pre-selected and its drawer
// already open.
export function LatestActivity({ events }: Props) {
  const latest = [...events].sort(byNewest).slice(0, 5);
  return (
    <div className="flex flex-col gap-2 px-5 py-4">
      <h2 className="font-mono text-xs uppercase tracking-wider text-ink-faint">Latest activity</h2>
      <div className="flex flex-col divide-y divide-border-soft rounded-lg border border-border">
        {latest.map((e) => (
          <EventRow key={e.id} event={e} selected={false} isNew={false} onClick={() => navigate(`/timeline?event=${e.id}`)} />
        ))}
      </div>
      {/* The one filled/primary CTA on this page (see DESIGN.md) — every
          other action here is ghost/outline. */}
      <Button variant="default" className="self-start active:scale-95" onClick={() => navigate("/timeline")}>
        Expanded view
      </Button>
    </div>
  );
}
