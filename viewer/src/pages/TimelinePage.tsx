import { useEffect, useMemo, useState, type RefObject } from "react";
import type { FlightEvent, Session } from "../types";
import { dataSource } from "../lib/dataSource";
import { useEventStream } from "../hooks/useEventStream";
import { useKeyboardNav } from "../hooks/useKeyboardNav";
import { byNewest } from "../lib/format";
import { filterEvents, sessionTitleMap } from "../lib/search";
import { navigate } from "../lib/router";
import { projectKeyOf, projectNameOf } from "../components/SessionSidebar";
import { Timeline } from "../components/Timeline";
import { DetailDrawer } from "../components/DetailDrawer";
import { EmptyState } from "../components/EmptyState";
import { SessionStatsBar } from "../components/SessionStatsBar";
import { Pagination } from "../components/Pagination";
import type { Provider } from "../lib/agents";

const PAGE_SIZE = 50;

interface Props {
  sessions: Session[];
  agentFilter: Provider | null;
  selectedSession: string | null;
  selectedProject: string | null;
  selectedGroup: string | null;
  search: string;
  onClearSearch: () => void;
  searchRef: RefObject<HTMLInputElement | null>;
  permalinkEventId: string | null; // from ?event= — deep-links a row's drawer open
}

// The full timeline: search, scope filtering, pagination, and the detail
// drawer. This is everything App.tsx used to render unconditionally — now
// the /timeline route's content, with scope state owned by Layout.
export function TimelinePage({
  sessions,
  agentFilter,
  selectedSession,
  selectedProject,
  selectedGroup,
  search,
  onClearSearch,
  searchRef,
  permalinkEventId,
}: Props) {
  const { events, loading, lastArrivalId } = useEventStream();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [fallbackEvent, setFallbackEvent] = useState<FlightEvent | null>(null);

  const searching = search.trim().length > 0;

  const scopedSessions = useMemo(
    () => (agentFilter ? sessions.filter((s) => s.provider === agentFilter) : sessions),
    [sessions, agentFilter]
  );

  const sessionTitles = useMemo(() => sessionTitleMap(sessions), [sessions]);

  // Full-database search: the loaded timeline holds only the newest events,
  // so an active query also asks the backend (FTS + qualifiers over every
  // session ever recorded). Debounced; the client-side filter below gives
  // instant results over loaded events until the full set arrives.
  const [remoteResults, setRemoteResults] = useState<FlightEvent[] | null>(null);
  useEffect(() => {
    if (!searching) {
      setRemoteResults(null);
      return;
    }
    let stale = false;
    const timer = setTimeout(() => {
      dataSource
        .search(search)
        .then((r) => {
          if (!stale) setRemoteResults(r);
        })
        .catch(() => {
          if (!stale) setRemoteResults(null); // backend unreachable → keep client filter
        });
    }, 250);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [search, searching]);

  // Scope hierarchy: session > folder/clone (project key) > project name
  // (all folders of that name) > everything, all within the agent scope.
  const scopeSessionIds = useMemo(() => {
    if (selectedSession) return null;
    if (selectedProject) {
      return new Set(scopedSessions.filter((s) => projectKeyOf(s) === selectedProject).map((s) => s.id));
    }
    if (selectedGroup) {
      return new Set(scopedSessions.filter((s) => projectNameOf(s) === selectedGroup).map((s) => s.id));
    }
    return null;
  }, [scopedSessions, selectedSession, selectedProject, selectedGroup]);

  const agentScopedEvents = useMemo(
    () => (agentFilter ? events.filter((e) => e.provider === agentFilter) : events),
    [events, agentFilter]
  );

  const visible = useMemo(() => {
    let list = searching && remoteResults ? remoteResults : agentScopedEvents;
    if (agentFilter) list = list.filter((e) => e.provider === agentFilter);
    if (selectedSession) list = list.filter((e) => e.session_id === selectedSession);
    else if (scopeSessionIds) list = list.filter((e) => scopeSessionIds.has(e.session_id));
    if (searching && !remoteResults) list = filterEvents(list, search, sessionTitles);
    return [...list].sort(byNewest);
  }, [agentScopedEvents, remoteResults, agentFilter, selectedSession, scopeSessionIds, search, searching, sessionTitles]);

  useEffect(() => {
    setPage(1);
  }, [agentFilter, selectedSession, selectedProject, selectedGroup, search]);

  const totalPages = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const paged = useMemo(() => visible.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE), [visible, currentPage]);

  // Deep-link support: /timeline?event=<id> opens straight to that event's
  // drawer. The event lookup below already searches the full unscoped
  // stream, so this doesn't need to touch/clear the scope filters — only a
  // permalink to something outside the loaded window needs a fallback fetch.
  useEffect(() => {
    const id = Number(permalinkEventId);
    if (!permalinkEventId || !Number.isFinite(id)) return;
    setSelectedId(id);
    setDrawerOpen(true);
    if (!events.some((e) => e.id === id)) {
      dataSource.getEvent(id).then((e) => e && setFallbackEvent(e)).catch(() => undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [permalinkEventId, events]);

  const selectedEvent = drawerOpen
    ? events.find((e) => e.id === selectedId) ??
      remoteResults?.find((e) => e.id === selectedId) ??
      (fallbackEvent?.id === selectedId ? fallbackEvent : null)
    : null;

  const moveSelection = (delta: number) => {
    if (paged.length === 0) return;
    const idx = paged.findIndex((e) => e.id === selectedId);
    const nextIdx = Math.max(0, Math.min(paged.length - 1, (idx < 0 ? -1 : idx) + delta));
    setSelectedId(paged[nextIdx].id);
  };

  const closeDrawer = () => {
    setDrawerOpen(false);
    if (permalinkEventId) navigate("/timeline", { replace: true });
  };

  useKeyboardNav({
    onDown: () => moveSelection(1),
    onUp: () => moveSelection(-1),
    onOpen: () => selectedId !== null && setDrawerOpen(true),
    onSearch: () => searchRef.current?.focus(),
    onEscape: () => {
      if (drawerOpen) closeDrawer();
      else if (searching) onClearSearch();
    },
  });

  return (
    <>
      <SessionStatsBar
        selectedSession={scopedSessions.find((s) => s.id === selectedSession) ?? null}
        scopeSessions={scopeSessionIds ? scopedSessions.filter((s) => scopeSessionIds.has(s.id)) : scopedSessions}
        scopeLabel={
          selectedProject
            ? `folder ${selectedProject.replace(/[\\/]+$/, "").split(/[\\/]/).pop()}`
            : selectedGroup
              ? `project ${selectedGroup}`
              : `all projects`
        }
        events={scopeSessionIds ? agentScopedEvents.filter((e) => scopeSessionIds.has(e.session_id)) : agentScopedEvents}
      />
      <Timeline
        key={currentPage}
        events={paged}
        loading={loading}
        selectedId={selectedId}
        lastArrivalId={currentPage === 1 ? lastArrivalId : null}
        onSelect={(id) => {
          setSelectedId(id);
          setDrawerOpen(true);
        }}
        empty={<EmptyState mode={searching ? "no-results" : "no-events"} />}
      />
      <Pagination page={currentPage} totalPages={totalPages} onChange={setPage} />
      <DetailDrawer event={selectedEvent} onClose={closeDrawer} />
    </>
  );
}
