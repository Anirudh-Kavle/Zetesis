import type { FlightEvent, Session } from "../types";
import { mockEvents, mockSessions, generateMockEvent } from "./mockData";
import { filterEvents } from "./search";
import * as api from "./api";

// Single adapter behind the whole UI. Live (:7878 via the vite proxy) by
// default; VITE_USE_MOCK=true npm run dev brings back the mock demo.
const USE_MOCK = import.meta.env.VITE_USE_MOCK === "true";

// Interval between simulated live events (ms). Demo-friendly cadence.
const MOCK_STREAM_MS = 4000;

export interface DataSource {
  getSessions(): Promise<Session[]>;
  getEvents(sessionId?: string): Promise<FlightEvent[]>;
  getEvent(id: number): Promise<FlightEvent | undefined>;
  search(query: string): Promise<FlightEvent[]>;
  subscribe(onEvent: (e: FlightEvent) => void): () => void;
}

const mockSource: DataSource = {
  async getSessions() {
    return mockSessions;
  },
  async getEvents(sessionId) {
    return sessionId
      ? mockEvents.filter((e) => e.session_id === sessionId)
      : mockEvents;
  },
  async getEvent(id) {
    return mockEvents.find((e) => e.id === id);
  },
  async search(query) {
    return filterEvents(mockEvents, query);
  },
  subscribe(onEvent) {
    const timer = setInterval(() => {
      const e = generateMockEvent();
      mockEvents.push(e);
      onEvent(e);
    }, MOCK_STREAM_MS);
    return () => clearInterval(timer);
  },
};

const liveSource: DataSource = {
  getSessions: api.getSessions,
  getEvents: (sessionId) => api.getEvents(sessionId),
  getEvent: (id) => api.getEvent(id),
  search: (query) => api.search(query),
  subscribe: (onEvent) => api.streamEvents(onEvent),
};

export const dataSource: DataSource = USE_MOCK ? mockSource : liveSource;
