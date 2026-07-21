# Flight Recorder

A local, real-time black box for AI coding-agent sessions. It captures every
consequential action (shell commands, file edits, network calls, account/
credential operations) at the moment it happens, binds it to the reasoning
that preceded it, and keeps everything in a local, append-only, greppable
store — so "why did the agent do that?" is answerable forever, not just
until the transcript compacts or auto-deletes.

It works with three kinds of session, side by side in the same store:

- **Claude Code** — via its native hook system
- **Codex CLI** — via its native hook system
- **The bundled API agent** (`fr api-ui`) — a small terminal coding agent
  built directly on the OpenAI Responses API, for when you want a
  Flight-Recorder-native agent instead of hooking into an existing CLI

All three write into the same SQLite store and show up together (or
filtered by agent) in the viewer UI.

## Prerequisites

- Python 3.11+
- Node 18+
- git

## 1. Build and run

```bash
# Python package + `fr` / `fr-hook` CLI entry points
pip install -e ".[dev]"

# Build the web viewer (fr ui serves the static build from viewer/dist)
cd viewer && npm install && npm run build && cd ..
# equivalently, from the repo root: npm install && npm run build

# Create the local store at ~/.flight-recorder
fr init

# Open the live timeline at http://127.0.0.1:7878
fr ui
```

`fr ui` starts the FastAPI backend and opens the built viewer in your
browser. Everything (SQLite DB, JSONL mirror, debug logs) lives under
`~/.flight-recorder/` — there's no separate daemon to run.

### Frontend dev mode (hot reload, optional)

Working on the viewer itself:

```bash
cd viewer
npm run dev              # http://localhost:5173, proxies /api to :7878 — run `fr ui` alongside it
# or, with no backend running at all:
VITE_USE_MOCK=true npm run dev   # generated demo data, no store required
```

## 2. Recording sessions

Flight Recorder doesn't run as a daemon that watches your machine — each
agent below is told (via its own hook or a wrapper) to call `fr-hook` at the
right moments. Point any or all of them at the same project and their
sessions all land in the same store, distinguished by provider.

### Claude Code

Create `.claude/settings.json` in the project (gitignored — per-machine
config) registering `fr-hook --provider claude` as a command hook for each
event you want captured:

```json
{
  "hooks": {
    "PreToolUse":  [{"matcher": ".*", "hooks": [{"type": "command", "command": "fr-hook --provider claude", "timeout": 5}]}],
    "PostToolUse": [{"matcher": ".*", "hooks": [{"type": "command", "command": "fr-hook --provider claude", "timeout": 5}]}],
    "SessionStart": [{"hooks": [{"type": "command", "command": "fr-hook --provider claude", "timeout": 5}]}],
    "UserPromptSubmit": [{"hooks": [{"type": "command", "command": "fr-hook --provider claude", "timeout": 5}]}],
    "Stop": [{"hooks": [{"type": "command", "command": "fr-hook --provider claude", "timeout": 5}]}]
  }
}
```

Then just use Claude Code in that project — actions stream into the
timeline live. (Don't add a `PermissionRequest` hook here: it fires
alongside `PreToolUse`/`PostToolUse` for the same call with no way to pair
it, so Flight Recorder ignores it rather than recording a duplicate row.)

### Codex CLI

```bash
cd your-project
fr init            # registers hooks in ./.codex/hooks.json (--global for ~/.codex/hooks.json)
fr status          # check hooks + event counts
```

Then just use Codex in that project. Codex's `PreToolUse`/`PostToolUse`
events preserve the exact raw `tool_name` and store a normalized
`tool_kind` (`bash`, `edit`, `write`, `read`, `webfetch`, `mcp`, `other`);
`tool_use_id` pairs each pre-action with its exact post-action result, even
when identical tools run concurrently. Open `/hooks` in Codex once to
review and trust the project hook commands.

Coverage note: Codex hooks observe shell/unified-exec (`Bash`),
`apply_patch`, MCP, and other local function tools. Hosted tools such as
`WebSearch` don't use the local hook path and stay outside this recorder's
coverage.

### API agent (`fr api-ui`) — the built-in terminal agent

A small interactive coding agent, wired straight into the same recorder, for
when you'd rather not hook into an external CLI. Needs an OpenAI API key:

```bash
export OPENAI_API_KEY=sk-...      # or put it in .env / .env.local in the project root
fr api-ui --token-limit 50000 --time-limit 600
```

Model defaults to `gpt-5.6`; override with `--model` or the `OPENAI_MODEL`
env var. Inside the session:

- `/help` — list commands
- `/clear` — reset conversation context (recorded history is untouched)
- `/status` — show recorder + hook status and the current token budget
- `/quit` / `/exit` — leave

Session guardrails: `--token-limit N`, `--time-limit SECONDS`, and
`--daily-token-limit N`. When a limit is reached, no new API request is
made and a `SessionLimit` event records the reason in the black box.
Limits can also be edited live from the viewer's top bar while the terminal
session is running — the agent picks up the change within a second.

For a single non-interactive task instead of a REPL, use
`fr agent "<task>" [same flags]`.

## CLI reference

```
fr init  [--global]           register hooks (project by default) + create the store
fr status                     store path, session/event counts, hook registration status
fr ui    [--port] [--no-browser]   start the viewer and open it in a browser
fr grep <pattern>             grep across the JSONL mirror
fr agent <task> [...]         one-shot API-backed agent run
fr api-ui [...]               interactive API-backed agent (see above)
fr test-hook                  record a synthetic Pre/PostToolUse pair to confirm capture
fr test-notification          test the desktop sensitive-action alert
```

Sensitive-risk events trigger a best-effort desktop alert before execution.
Set `FLIGHT_RECORDER_NOTIFY=0` to disable alerts; notification failures
never block the agent.

## Viewer feature tour

Sessions grouped by project (repo/folder) in the sidebar, with folder
sub-groups for multiple checkouts; deterministic per-scope stat line
(actions / commands / edits / failed / sensitive); full-database search with
qualifiers (`tool:` `risk:` `file:` `session:` `exit:` `provider:` `after:`
`before:`); per-session token/time budgets editable from the top bar;
recording pause/resume.

## Layout

- `flight_recorder/hook.py` — the hook entry point every provider calls
  (PreToolUse, PostToolUse, PreCompact, SessionStart, Stop, ...). Exits 0
  unconditionally — a recorder that can break the agent's controls is worse
  than no recorder.
- `flight_recorder/reasoning.py` — extracts the reasoning window preceding
  an action from the live transcript; PreCompact snapshot shield.
- `flight_recorder/risk.py` + `risk_rules.yaml` — deterministic risk tiering.
- `flight_recorder/agent.py` — the OpenAI Responses API agent loop behind
  `fr agent` / `fr api-ui`.
- `flight_recorder/store.py` — SQLite (WAL) + JSONL mirror, no daemon.
- `flight_recorder/viewer/` — FastAPI app serving the API + the built React UI.
- `flight_recorder/cli.py` — the `fr` command group.

## Store location

`~/.flight-recorder/` — `recorder.db`, `events/YYYY-MM-DD.jsonl`,
`snapshots/<session>/`, `debug/raw_payloads.jsonl`.

## Known gaps (honest, not hidden)

- Reasoning extraction (`flight_recorder/reasoning.py`) is defensive but
  not exhaustively validated against every real transcript shape across
  providers — raw hook payloads are always dumped to
  `~/.flight-recorder/debug/raw_payloads.jsonl` for exactly that kind of
  debugging.
- No incident report export, multi-session cross-search, or file diffs yet.
