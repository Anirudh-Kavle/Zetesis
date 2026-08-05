import { useState } from "react";
import { ShieldAlert, TriangleAlert, X } from "lucide-react";
import { Alert, AlertTitle, AlertDescription, AlertAction } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { FlightEvent } from "../../types";
import { navigate } from "../../lib/router";
import { acknowledgeReview } from "../../lib/api";
import { formatTime } from "../../lib/format";

interface Props {
  events: FlightEvent[];
}

// "Did anything risky happen?" — sensitive-tier and reasoning-gap events not
// yet reviewed. Dismissing acknowledges via the reviews table (append-only:
// the event row itself is never mutated) with the same optimistic-then-
// revert pattern RecordingToggle.tsx already uses.
export function NeedsAttention({ events: initialEvents }: Props) {
  const [events, setEvents] = useState(initialEvents);
  const [dismissing, setDismissing] = useState<Set<number>>(new Set());

  if (events.length === 0) return null;

  const dismiss = async (id: number) => {
    setDismissing((s) => new Set(s).add(id));
    const before = events;
    setEvents((cur) => cur.filter((e) => e.id !== id)); // optimistic
    try {
      await acknowledgeReview(id);
    } catch {
      setEvents(before); // revert on failure
    } finally {
      setDismissing((s) => {
        const next = new Set(s);
        next.delete(id);
        return next;
      });
    }
  };

  return (
    <div className="flex flex-col gap-2 px-5 py-4">
      <h2 className="font-mono text-xs uppercase tracking-wider text-ink-faint">Needs attention</h2>
      {events.map((e) => {
        const sensitive = e.risk === "sensitive";
        const Icon = sensitive ? ShieldAlert : TriangleAlert;
        return (
          <Alert key={e.id} variant={sensitive ? "destructive" : "default"}>
            <Icon className="h-4 w-4" strokeWidth={1.5} aria-hidden />
            <button
              onClick={() => navigate(`/timeline?event=${e.id}`)}
              className="-m-1 cursor-pointer rounded p-1 text-left transition-colors hover:bg-surface/70 active:scale-[0.99]"
            >
              <AlertTitle>
                {e.tool} · {sensitive ? "sensitive" : "reasoning gap"} · {formatTime(e.ts)}
              </AlertTitle>
              <AlertDescription>
                {sensitive ? "Matched a sensitive-tier pattern." : "We didn't capture reasoning for this action."}
              </AlertDescription>
            </button>
            <AlertAction>
              <Button
                variant="ghost"
                size="icon-sm"
                className="active:scale-90"
                disabled={dismissing.has(e.id)}
                onClick={() => dismiss(e.id)}
                title="Acknowledge and dismiss"
              >
                <X className="h-3.5 w-3.5" strokeWidth={1.5} />
              </Button>
            </AlertAction>
          </Alert>
        );
      })}
    </div>
  );
}
