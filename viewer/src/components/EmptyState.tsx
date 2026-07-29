// Zero-state teaches the three commands to get recording (spec 4.1).
export function EmptyState({ mode }: { mode: "no-events" | "no-results" }) {
  if (mode === "no-results") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-10 text-center">
        <p className="text-sm text-ink-muted">No actions match this search.</p>
        <p className="font-mono text-xs text-ink-faint">Press Esc to return to the live timeline.</p>
      </div>
    );
  }

  const steps = [
    { cmd: "fr init", note: "install the hooks into .claude/settings.json" },
    { cmd: "claude", note: "start a session and do some work" },
    { cmd: "watch here", note: "actions stream in, live" },
  ];

  return (
    <div className="flex h-full flex-col items-center justify-center gap-8 p-10 text-center">
      <div>
        <p className="text-lg font-semibold text-ink">Nothing recorded yet.</p>
        <p className="mt-2 text-sm text-ink-muted leading-relaxed">
          Zetesis captures every action your agent takes — and why.
        </p>
      </div>
      <ol className="flex flex-col gap-4 text-left max-w-sm">
        {steps.map((s, i) => (
          <li key={s.cmd} className="flex items-start gap-4">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-risk-write/20 font-mono text-xs font-semibold text-risk-write ring-1 ring-risk-write/40">
              {i + 1}
            </span>
            <div className="flex-1 min-w-0">
              <code className="block rounded bg-surface-2 px-3 py-1.5 font-mono text-sm text-ink font-medium mb-1">
                {s.cmd}
              </code>
              <span className="text-xs text-ink-muted">{s.note}</span>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
