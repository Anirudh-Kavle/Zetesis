import { useEffect, useMemo, useRef, useState } from "react";
import { type RiskTier, RISK_TIERS, type Session } from "./types";
import { dataSource } from "./lib/dataSource";
import { getUsage, updateBudget } from "./lib/api";
import { useEventStream } from "./hooks/useEventStream";
import { useKeyboardNav } from "./hooks/useKeyboardNav";
import { byNewest } from "./lib/format";
import { filterEvents } from "./lib/search";
import { TopBar } from "./components/TopBar";
import { SessionSidebar } from "./components/SessionSidebar";
import { Timeline } from "./components/Timeline";
import { DetailDrawer } from "./components/DetailDrawer";
import { EmptyState } from "./components/EmptyState";

export default function App() {
  const { events, loading, lastArrivalId } = useEventStream();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [dailyTokens, setDailyTokens] = useState(0);
  const [selectedSession, setSelectedSession] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [riskFilter, setRiskFilter] = useState<Set<RiskTier>>(new Set(RISK_TIERS));
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    dataSource.getSessions().then(setSessions);
    getUsage().then((u) => setDailyTokens(u.token_count)).catch(() => undefined);
  }, []);

  const live = sessions.some((s) => s.live);
  const searching = search.trim().length > 0;

  // Filter pipeline: session scope → risk filter → search. Newest-first for the timeline.
  const visible = useMemo(() => {
    let list = events;
    if (selectedSession) list = list.filter((e) => e.session_id === selectedSession);
    list = list.filter((e) => riskFilter.has(e.risk));
    if (searching) list = filterEvents(list, search);
    return [...list].sort(byNewest);
  }, [events, selectedSession, riskFilter, search, searching]);

  const selectedEvent = drawerOpen
    ? events.find((e) => e.id === selectedId) ?? null
    : null;

  const toggleRisk = (r: RiskTier) => {
    setRiskFilter((prev) => {
      const next = new Set(prev);
      if (next.has(r)) next.delete(r);
      else next.add(r);
      return next;
    });
  };

  const moveSelection = (delta: number) => {
    if (visible.length === 0) return;
    const idx = visible.findIndex((e) => e.id === selectedId);
    const nextIdx = Math.max(0, Math.min(visible.length - 1, (idx < 0 ? -1 : idx) + delta));
    setSelectedId(visible[nextIdx].id);
  };

  useKeyboardNav({
    onDown: () => moveSelection(1),
    onUp: () => moveSelection(-1),
    onOpen: () => selectedId !== null && setDrawerOpen(true),
    onSearch: () => searchRef.current?.focus(),
    onEscape: () => {
      if (drawerOpen) setDrawerOpen(false);
      else if (searching) setSearch("");
    },
  });

  return (
    <div className="flex h-full flex-col">
      <TopBar
        ref={searchRef}
        live={live}
        search={search}
        onSearch={setSearch}
        onClearSearch={() => setSearch("")}
        sessionBudget={(() => { const s = sessions.find((x) => x.token_limit); return s?.token_limit ? { id: s.id, used: s.token_used ?? 0, limit: s.token_limit, timeLimit: s.time_limit_s } : undefined; })()}
        dailyTokens={dailyTokens}
        onBudgetSaved={async (tokenLimit, timeLimit) => {
          const s = sessions.find((x) => x.token_limit);
          if (!s) return;
          await updateBudget(s.id, tokenLimit, timeLimit);
          setSessions((all) => all.map((x) => x.id === s.id ? { ...x, token_limit: tokenLimit ?? undefined, time_limit_s: timeLimit ?? undefined } : x));
        }}
      />

      <div className="flex min-h-0 flex-1">
        <SessionSidebar
          sessions={sessions}
          selectedSession={selectedSession}
          onSelectSession={setSelectedSession}
          riskFilter={riskFilter}
          onToggleRisk={toggleRisk}
        />

        <main className="relative flex min-h-0 min-w-0 flex-1 flex-col">
          <Timeline
            events={visible}
            loading={loading}
            selectedId={selectedId}
            lastArrivalId={lastArrivalId}
            onSelect={(id) => {
              setSelectedId(id);
              setDrawerOpen(true);
            }}
            empty={<EmptyState mode={searching ? "no-results" : "no-events"} />}
          />
          <DetailDrawer event={selectedEvent} onClose={() => setDrawerOpen(false)} />
        </main>
      </div>
    </div>
  );
}
