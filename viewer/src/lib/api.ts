import type { FlightEvent, Session } from "../types";

const API_BASE = import.meta.env.VITE_API_URL || "/api";

export async function getSessions(): Promise<Session[]> {
  const res = await fetch(`${API_BASE}/sessions`);
  if (!res.ok) throw new Error("Failed to fetch sessions");
  return res.json();
}

export async function getEvents(
  sessionId?: string,
  filter?: Record<string, string>
): Promise<FlightEvent[]> {
  const qs = filter ? "?" + new URLSearchParams(filter).toString() : "";
  const res = await fetch(`${API_BASE}/sessions/${sessionId || "all"}/events${qs}`);
  if (!res.ok) throw new Error("Failed to fetch events");
  return res.json();
}

export async function getEvent(id: number): Promise<FlightEvent> {
  const res = await fetch(`${API_BASE}/events/${id}`);
  if (!res.ok) throw new Error("Failed to fetch event");
  return res.json();
}

export async function search(query: string): Promise<FlightEvent[]> {
  const res = await fetch(`${API_BASE}/search?q=${encodeURIComponent(query)}`);
  if (!res.ok) throw new Error("Failed to search");
  return res.json();
}

export function streamEvents(
  onEvent: (event: FlightEvent) => void,
  onError?: (error: Error) => void
): () => void {
  const eventSource = new EventSource(`${API_BASE}/stream`);

  eventSource.onmessage = (e) => {
    try {
      const event = JSON.parse(e.data);
      onEvent(event);
    } catch (err) {
      onError?.(err as Error);
    }
  };

  eventSource.onerror = () => {
    onError?.(new Error("SSE connection failed"));
    eventSource.close();
  };

  return () => eventSource.close();
}
