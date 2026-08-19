# AI-Agent

A modular, local-first, open-source AI coding agent. It understands a
repository, plans a task, selects relevant context, edits files, runs commands,
verifies its changes, and corrects itself — designed to run on a low-resource
local server with an interchangeable local model backend.

## Quick start (3 steps)

```bash
git clone <repo> && cd AI-Agent
./install.sh        # installs deps, creates .env, makes `go` available
go                  # starts the model server (if configured) + launches the TUI
```

Edit `.env` to point at your local model server before the first `go`:

```
MODEL_PROVIDER=local
LOCAL_MODEL_BASE_URL=http://127.0.0.1:8080/v1
LOCAL_MODEL_NAME=qwen2.5-coder-1.5b-instruct
# Optional: let `go` start your model server for you
MODEL_START_CMD=/opt/llama.cpp/build/bin/llama-server
MODEL_START_ARGS=--model /path/to/model.gguf --port 8080 --host 127.0.0.1
```

For one-shot tasks without the TUI:

```bash
node index.js "explain the structure of this repo"
npm test                # run the test suite
```

## The `go` launcher

`go` is a single command that automates the whole environment. It works from any
directory (it resolves the project root itself) and manages the model server as a
service with real health checks — a service is `READY` only after a probe, never
just because its process exists.

| Command      | Action                                                            |
|--------------|-------------------------------------------------------------------|
| `go`         | start services (if down) + launch the TUI                        |
| `go start`   | start the model server (if `MODEL_START_CMD` is set); no TUI     |
| `go stop`    | stop services managed by `go`                                    |
| `go restart` | stop + start                                                      |
| `go status`  | show service readiness (`READY` / `STARTING` / `STOPPED`)        |
| `go logs`    | tail the model-server logs                                       |
| `go doctor`  | diagnose: node, deps, config, endpoint, ports, permissions      |

Notes:

- **No double start.** If the endpoint is already reachable, `go` will not
  spawn a second instance.
- **Clean shutdown.** `Ctrl-C` during `go` stops the model server `go` started,
  reaps it, and clears the PID file — no orphans.
- **No opaque auto-download.** `go` never assumes a binary path or downloads a
  model. If the endpoint is down and `MODEL_START_CMD` is unset, `go` tells you
  exactly what is missing. Model files are never committed.

## Model backend

The agent talks to any **OpenAI-compatible** endpoint, so you can use:

- `llama.cpp` server (`/v1`) — the default / target backend
- LM Studio
- vLLM
- Ollama's OpenAI-compatible endpoint (optional compatibility backend; **not required**)
- a cloud provider as an optional development fallback

Configure via environment variables (see `.env.example`). `LOCAL_MODEL_NAME`
must match the model id your server exposes (NOT an Ollama `name:tag` with a
colon). Prefer small coding models that fit limited hardware. The agent has been
validated end-to-end with **Qwen2.5-Coder-1.5B-Instruct** (Q4_K_M GGUF, ~1.1GB)
served by `llama.cpp`/`llama-cpp-python`. Do not commit model files; they are
served by your local backend.

### Small-model hardening

Small local models do not always emit clean OpenAI `tool_calls`: they often put
the call in prose, use fenced JSON, or get whitespace/escaping wrong in
`editFile`. The agent handles this without external dependencies:

- `providers/tool-normalize.js` converts native, fenced-JSON, bare-JSON and
  Hermes-style tool-call formats into canonical `tool_calls`.
- `tools/files.js` `editFile` matches exactly, then falls back to literal-escape
  relaxation (`\n` → newline) and whitespace-normalized matching, and returns a
  file snippet on failure so the model can self-correct.
- The loop nudges prose-only turns back to tool use, and guards against repeated
  identical calls.

## Terminal UI (TUI)

`go` (or `node index.js` with no task argument) opens the interactive TUI. It is
a pure **observer** of the engine's EventBus: it prints a compact, streaming
transcript of the agent's work as events arrive — no full-screen repaint, no
heavy TUI framework, so it stays light on an old machine and robust under resize.

On startup it prints the active model/backend/endpoint and probes the model
server (3 s timeout). If the server is down it shows an actionable banner before
you type a task, instead of hanging on a connection error.

While the agent works you see, live:
- the current **phase** (`SELECTING CONTEXT`, `PLANNING`, `EXECUTING`,
  `VERIFYING`, `CORRECTING`, …) with iteration/tool/error counters;
- each **tool call** as `▶ toolName  args` and a compact `✓`/`✗` result line
  (test counts, exit status, file edits, search hits);
- **verification** and **auto-correction** panels when tests fail;
- **memory** panels when a relevant past experience is retrieved or a new one
  is recorded;
- a final `✓ Task completed successfully` / `✗ Task failed` line.

Interactive commands (type at the `>` prompt):

| Command        | Action                                              |
|----------------|-----------------------------------------------------|
| `/help`        | list commands                                       |
| `/status`      | current task phase + counters                       |
| `/model`       | active model, backend, endpoint and reachability    |
| `/tools`       | registered agent tools                              |
| `/memory`      | recent recorded experiences                         |
| `/skills [task]` | skills available, with the ones relevant to a task marked |
| `/clear`       | clear the screen                                    |
| `/exit`        | quit                                                |

`Ctrl-C` during a running task signals an abort and lets the current step
finish; at the idle prompt it exits. Output is colour when writing to a TTY and
plain text otherwise (respects `NO_COLOR`), so the same code is readable in CI
logs.

## Architecture

See `docs/ARCHITECTURE.md` for the full design and the rationale for which
open-source coding-agent concepts were adopted (OpenHands, Aider, OpenCode) and
how they integrate with this project's own systems.

```
User → go → TUI/index.js → Orchestrator → Agent (action/observation loop)
        │                       │
        │   ┌───────────────────┼─────────────────────┐
        │   │                   │                     │
        │  ContextSelector  ModelRouter           ToolRegistry
        │   (repo map,       (local/cloud,          (files, git,
        │     skills,         OpenAI-compat)        shell, tests)
        │     memory)
        │                       │
        │                 Verification → Corrector → Memory/Experience
        │
        └── manages model server: PID file + health probe, no orphans
```

## Layout

```
go, bin/go.js            the `go` launcher + service manager
install.sh               one-command setup (deps, .env, `go` on PATH)
index.js                 entry point (one-shot task or TUI)
src/
  config.js              env-based config; resolves project root
  providers/             OpenAI-compatible model abstraction + router
  engine/
    agent.js             autonomous action/observation loop
    orchestrator.js      wires all subsystems together
    planner.js           architect-phase planning
    context-selector.js  repo map + skills + experiences
    repo-analyzer.js     token-budgeted symbol repo map (Aider-style)
    skill-registry.js    relevance-based skill loading
    memory.js            persistent operational memory + experience retrieval
    verification.js      objective test/command verification
    corrector.js         failure → diagnose → fix → re-verify
    safety.js            protected paths + blocked commands
    event-bus.js         decoupled eventing
  tools/
    tool.js, registry.js tool base + registry + safety dispatch
    files.js             file/search/shell/git/test/finish tools
  tui/tui.js             interactive terminal UI
  util/minimatch.js      tiny glob matcher
skills/                  curated, de-duplicated skills (loaded dynamically)
tests/                   node:test suite (incl. launcher + provider routing)
```

## License

MIT
