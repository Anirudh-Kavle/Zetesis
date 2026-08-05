import type { FlightEvent, Session, Stats } from "../types";
import { mockEvents, mockSessions, generateMockEvent } from "./mockData";
import { computeMockStats } from "./mockStats";
import { filterEvents, sessionTitleMap } from "./search";
import * as api from "./api";

// Single adapter behind the whole UI. Live (:7878 via the vite proxy) by
// default; VITE_USE_MOCK=true npm run dev brings back the mock demo.
const USE_MOCK = import.meta.env.VITE_USE_MOCK === "true";

// Interval between simulated live events (ms). Demo-friendly cadence.
const MOCK_STREAM_MS = 4000;

export interface DataSource {
  getSessions(): Promise<Session[]>;
  getEvents(sessionId?: string): Promise<FlightEvent[]>;
  getEvent(id: number): Promise<FlightEvent | null>;
  search(query: string): Promise<FlightEvent[]>;
  subscribe(onEvent: (e: FlightEvent) => void): () => void;
  getRecordingPaused(): Promise<boolean>;
  setRecordingPaused(paused: boolean): Promise<boolean>;
  getStats(days?: number): Promise<Stats>;
}

// Mock mode has no server to persist against — an in-memory flag is enough
// to make the toggle behave believably within a single demo session.
let mockPaused = false;

const mockSource: DataSource = {
  async getSessions() {
    return mockSessions;
  },
  async getEvents(sessionId) {
    // A copy, not the live array reference — mockSource.subscribe() below
    // mutates mockEvents in place (push) *and* separately calls onEvent(e),
    // which spreads whatever `events` state currently holds. Handing out the
    // live reference here aliases that state to the mutable source array, so
    // the next push is silently double-counted (present via the mutation,
    // then appended again by the explicit spread) — exactly the "duplicate
    // key" symptom this comment is here to stop someone from reintroducing.
    return sessionId
      ? mockEvents.filter((e) => e.session_id === sessionId)
      : [...mockEvents];
  },
  async getEvent(id) {
    return mockEvents.find((e) => e.id === id) ?? null;
  },
  async search(query) {
    return filterEvents(mockEvents, query, sessionTitleMap(mockSessions));
  },
  subscribe(onEvent) {
    const timer = setInterval(() => {
      if (mockPaused) return;
      const e = generateMockEvent();
      mockEvents.push(e);
      onEvent(e);
    }, MOCK_STREAM_MS);
    return () => clearInterval(timer);
  },
  async getRecordingPaused() {
    return mockPaused;
  },
  async setRecordingPaused(paused) {
    mockPaused = paused;
    return mockPaused;
  },
  async getStats(days = 14) {
    return computeMockStats(mockEvents, mockSessions, days);
  },
};

// The backend defaults /api/sessions/{id}/events to limit=500 as a sanity
// cap, not a UI page size — asking for it explicitly here means the app's
// actual history window is a deliberate choice, not an accident of whatever
// the backend's default happens to be.
// ponytail: still a hard cap, not real pagination — raise further (or add a
// "load more") if a single local install's history ever grows past this.
const EVENT_HISTORY_LIMIT = "5000";

const liveSource: DataSource = {
  getSessions: api.getSessions,
  getEvents: (sessionId) => api.getEvents(sessionId, { limit: EVENT_HISTORY_LIMIT }),
  getEvent: api.getEvent,
  search: (query) => api.search(query),
  subscribe: (onEvent) => api.streamEvents(onEvent),
  getRecordingPaused: api.getRecordingPaused,
  setRecordingPaused: api.setRecordingPaused,
  getStats: (days) => api.getStats(days),
};

export const dataSource: DataSource = USE_MOCK ? mockSource : liveSource;
