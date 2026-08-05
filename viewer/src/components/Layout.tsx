import { useEffect, useRef, useState } from "react";
import type { Session } from "../types";
import { dataSource } from "../lib/dataSource";
import { getUsage, getBudgets, updateScopeBudget, type BudgetSetting } from "../lib/api";
import { navigate, useRoute } from "../lib/router";
import { TopBar } from "./TopBar";
import { SessionSidebar, projectKeyOf, projectNameOf } from "./SessionSidebar";
import type { Provider } from "../lib/agents";
import { DashboardPage } from "../pages/DashboardPage";
import { TimelinePage } from "../pages/TimelinePage";

// Cross-page shell: TopBar + SessionSidebar + whichever page the route picks.
// Owns everything both pages (or just TopBar/SessionSidebar) need to share —
// session/budget polling, sidebar width, and the scope filters. Scope state
// intentionally survives navigating Dashboard <-> Timeline so switching back
// doesn't lose what you had selected.
export default function Layout() {
  const { route, params } = useRoute();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [dailyTokens, setDailyTokens] = useState(0);
  const [budgets, setBudgets] = useState<BudgetSetting[]>([]);
  const [selectedSession, setSelectedSession] = useState<string | null>(null);
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(260);
  const [agentFilter, setAgentFilter] = useState<Provider | null>(null);
  const [search, setSearch] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    dataSource.getSessions().then(setSessions);
    getUsage().then((u) => setDailyTokens(u.token_count)).catch(() => undefined);
    getBudgets().then(setBudgets).catch(() => undefined);

    // The session list (which session is "live" per provider, its token
    // usage, its provider) can change outside this tab — a new `fr api-ui`
    // terminal starting, a session ending. Without this, the budget button
    // keeps targeting whatever was live at page load, so "Save limits" can
    // silently patch a stale session instead of the one actually running.
    const id = setInterval(() => {
      dataSource.getSessions().then(setSessions);
      getBudgets().then(setBudgets).catch(() => undefined);
    }, 4000);
    return () => clearInterval(id);
  }, []);

  // Sessions scoped to the selected agent — drives the sidebar's project tree
  // and the "which session/project am I even allowed to have selected" checks
  // below.
  const scopedSessions = agentFilter ? sessions.filter((s) => s.provider === agentFilter) : sessions;

  // Switching agent scope away from whatever's selected (session, folder, or
  // project group) clears that selection rather than silently showing an
  // empty timeline.
  useEffect(() => {
    if (!agentFilter) return;
    if (selectedSession && !scopedSessions.some((s) => s.id === selectedSession)) {
      setSelectedSession(null);
    }
    if (selectedProject && !scopedSessions.some((s) => projectKeyOf(s) === selectedProject)) {
      setSelectedProject(null);
    }
    if (selectedGroup && !scopedSessions.some((s) => projectNameOf(s) === selectedGroup)) {
      setSelectedGroup(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentFilter, selectedSession, selectedProject, selectedGroup, scopedSessions]);

  // Seeds the search box from a dashboard drill-down link (MostTouchedFiles'
  // /timeline?q=file:<path> rows) — one-directional, read on navigation only,
  // same "seed state from the URL once" shape as the ?event= permalink below.
  useEffect(() => {
    const q = params.get("q");
    if (q !== null) setSearch(q);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  // The dashboard has no scope of its own (stats always reflect the entire
  // store) — interacting with a scope control while on it drills straight
  // into the timeline with that scope applied, rather than being a dead
  // control or a second "filters exist but do nothing" state.
  const drillIntoTimeline = () => {
    if (route === "/") navigate("/timeline");
  };

  return (
    <div className="flex h-full flex-col">
      <TopBar
        ref={searchRef}
        search={search}
        onSearch={(v) => {
          drillIntoTimeline();
          setSearch(v);
        }}
        onClearSearch={() => setSearch("")}
        sessions={scopedSessions}
        agentFilter={agentFilter}
        sessionBudget={(() => {
          const b = budgets.find((x) => x.scope === "openai-api");
          return b?.token_limit
            ? { id: "openai-api", used: b.token_used, limit: b.token_limit, timeLimit: b.time_limit_s ?? undefined }
            : undefined;
        })()}
        dailyTokens={dailyTokens}
        budgets={budgets}
        onBudgetSaved={async (scope, tokenLimit, timeLimit) => {
          await updateScopeBudget(scope, tokenLimit, timeLimit);
          setBudgets((all) => all.map((b) => (b.scope === scope ? { ...b, token_limit: tokenLimit, time_limit_s: timeLimit } : b)));
        }}
      />

      <div className="flex min-h-0 flex-1">
        <SessionSidebar
          sessions={scopedSessions}
          allSessions={sessions}
          width={sidebarWidth}
          onWidthChange={setSidebarWidth}
          selectedSession={selectedSession}
          onSelectSession={(id) => {
            drillIntoTimeline();
            setSelectedSession(id);
          }}
          selectedProject={selectedProject}
          onSelectProject={(key) => {
            drillIntoTimeline();
            setSelectedProject(key);
          }}
          selectedGroup={selectedGroup}
          onSelectGroup={(name) => {
            drillIntoTimeline();
            setSelectedGroup(name);
          }}
          agentFilter={agentFilter}
          onSelectAgent={(p) => {
            drillIntoTimeline();
            setAgentFilter(p);
          }}
          route={route}
          onNavigate={navigate}
        />

        <main className="relative flex min-h-0 min-w-0 flex-1 flex-col">
          {route === "/timeline" ? (
            <TimelinePage
              sessions={sessions}
              agentFilter={agentFilter}
              selectedSession={selectedSession}
              selectedProject={selectedProject}
              selectedGroup={selectedGroup}
              search={search}
              onClearSearch={() => setSearch("")}
              searchRef={searchRef}
              permalinkEventId={params.get("event")}
            />
          ) : (
            <DashboardPage />
          )}
        </main>
      </div>
    </div>
  );
}
