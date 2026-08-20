# AI-Agent — repository memory

## What this project is
A modular, local-first, open-source AI coding agent in Node.js. It runs an
autonomous understand→plan→edit→verify→correct loop against an interchangeable
OpenAI-compatible local model backend. Target deployment: an old, low-resource
local server.

## Key facts for future sessions
- The agent is branded **KLYVIA** (`src/tui/render.js` `header()` title). The
  TUI entry point is `node index.js` (one-shot: `node index.js "task"`). There
  is NO `tui/index.mjs` file; the documented entry is `package.json` `scripts.tui`
  = `node index.js`. `agent.js` is a backward-compatible shim to `index.js`.
- **Launcher**: `go` / `GO` (repo-root wrapper) → `bin/go.js` is the service manager.
  Subcommands: `go` (start + TUI), `go start|stop|restart|status|logs|doctor`.
  `GO` (uppercase) works too (install.sh symlinks both into ~/.local/bin; Linux
  is case-sensitive). It resolves the project root itself (works from any dir),
  uses a real health probe (`/v1/models`) — a service is READY only after the
  probe passes, never just because a PID exists — and prevents double-starts via
  a PID file under `.agent-runtime/` (gitignored). Start-command resolution:
  (1) `MODEL_START_CMD`+`MODEL_START_ARGS` (any server, full control), or
  (2) llama.cpp auto-build from `LLAMA_BIN` (or auto-detected
  `llama`/`llama-server`/`~/.local/bin/llama`) + `MODEL_PATH` (.gguf), deriving
  host/port from `LOCAL_MODEL_BASE_URL` and context from `LLAMA_CONTEXT`.
  `install.sh` sets up deps + `.env` + global `go`/`GO` symlinks in
  `~/.local/bin`, detects llama.cpp, and runs `go doctor`.
- Stack: Node.js (CommonJS). Runtime deps: only `openai` + `dotenv`. Tests use
  the built-in `node:test` runner (`node --test tests/`). **Do not add heavy
  runtime or test dependencies.**
- Entry: `go` (recommended; auto-manages services + TUI), `node index.js
  "task"` (one-shot), or `node index.js` (TUI). `agent.js` is a backward-compatible
  shim to `index.js`.
- Config via env / `.env` (see `.env.example`). `MODEL_PROVIDER=local` +
  `LOCAL_MODEL_BASE_URL` point at any OpenAI-compatible server (llama.cpp,
  Ollama optional, LM Studio, vLLM). Ollama is NOT a hard dependency.
  `src/config.js` `buildConfig()` resolves the project root by searching upward
  for `package.json`, so `.env` is loaded from the project root (not `cwd`) and
  `config.rootDir` is the project root — tools/paths anchor there correctly
  regardless of where the process was launched from.
- The model engine only calls `modelRouter.complete(...)`; it never knows the
  backend. Add backends in `src/providers/`.

## Architecture map
- `go` + `bin/go.js` — launcher + service manager (`go start|stop|restart|status|logs|doctor`).
  Health-probe-based readiness (READY only after `/v1/models` responds), PID file
  in `.agent-runtime/`, no double-start, no orphans on shutdown. `install.sh`
  sets up deps + `.env` + a global `go` symlink in `~/.local/bin`.
- `index.js` — entry point (one-shot task via `node index.js "task"`, or TUI).
- `src/engine/agent.js` — action/observation loop (OpenHands-style).
- `src/engine/orchestrator.js` — composes all subsystems (the kernel).
- `src/engine/repo-analyzer.js` — token-budgeted symbol repo map (Aider-style,
  dependency-free regex + reference ranking; NOT tree-sitter, on purpose).
- `src/engine/context-selector.js` — repo map + top-K skills + experiences.
- `src/engine/planner.js` — architect-phase plan.
- `src/engine/verification.js` + `corrector.js` — test → fail → diagnose → fix.
- `src/engine/memory.js` — persistent JSON experiences + lexical retrieval.
- `src/engine/skill-registry.js` — relevance-based skill loading (NOT all skills).
- `src/engine/safety.js` + `src/tools/registry.js` — safety as observations.
- `src/tools/files.js` — all tools (files, search, shell, git, tests, finish).

## Conventions
- Safety violations are returned as observation strings, never thrown.
- Adding a tool = add a `Tool` instance and register it in `orchestrator._registerTools`.
- Skills live in `skills/*.md`; keep them non-empty and de-duplicated.
- `.agent-memory/` and `.env` are gitignored. Never commit model files (`*.gguf`, `models/` gitignored).
- **Tool path/command resolution is `ctx.cwd`-based, NOT `process.cwd()`-based.**
  `ToolRegistry.dispatch` sets `ctx.cwd = config.rootDir`; file tools in
  `src/tools/files.js` resolve paths with `resolve(p, ctx)` and shell/git/test
  tools pass `{ cwd: ctx.cwd }` to `exec`/`execSync`. Do NOT call
  `process.chdir()` to align cwd with rootDir — it is a global mutation that
  is unsafe under concurrent test execution. New tools should accept `(args, ctx)`
  and resolve paths via `ctx.cwd`.
- `npm test` runs `node --test "tests/test-*.js"` (the `test-*.js` glob
  deliberately excludes `tests/fixtures/`, which hold test helpers, not tests).

## Small-model hardening (validated end-to-end with Qwen2.5-Coder-1.5B)
- `src/providers/tool-normalize.js` `normalizeMessage()` converts native,
  fenced-JSON, bare-JSON and Hermes-style tool calls into canonical
  `tool_calls`. Always pass `knownToolNames` from the registry to the provider.
- `src/tools/files.js` `applyEdit()` matches exactly, then literal-escape
  relaxation (`\n`→newline), then whitespace-normalized matching; reports
  "multiple locations" for ambiguous matches; returns a file snippet on
  failure. Exported as `_applyEdit` for tests.
- Agent loop: only ends on a prose turn if `actions.length > 0` (else nudges
  to tool use); guards against repeated identical tool calls; truncates
  observations via `OBSERVATION_MAX_CHARS`.
- `Memory` is shared (one instance) between the orchestrator, agent and
  `ContextSelector` so experiences recorded during a run are retrievable
  immediately — do NOT give the ContextSelector its own Memory instance.
- Live tests are env-gated (`AI_AGENT_LIVE=1` + `LOCAL_MODEL_BASE_URL`).
  Run the full suite with `npm test` (live tests skip without a server).
- **Integration tests without a GPU** use a stateful mock OpenAI-compatible
  server (`tests/fixtures/mock-openai-server.js`) that decides its next tool
  call from the genuine observations it receives. The real Provider, tool-call
  normalization, tools, verification, correction and memory are exercised; only
  model inference is mocked. This is the standard way to validate the agent
  loop when no local model server is available.
- **Pitfall: do not use `node --test` as the `npm test` script of a throwaway
  project exercised from inside the test runner.** Running `node --test` as a
  child of a `node --test` process makes node skip the nested files
  ("run() is being called recursively within a test file"), masking real
  failures (it exits 0 with 0 tests run). The `tests/fixtures/temp-projects.js`
  helpers therefore ship a PLAIN assertion script (`node test/run-tests.js`)
  whose exit code is the real verdict - works identically inside and outside
  the runner.

## Provider routing (LOCAL is the real default)
- `MODEL_PROVIDER=local` (default) makes `ModelRouter._primary()` return the
  `local` Provider — a generic OpenAI-compatible HTTP client pointed at
  `LOCAL_MODEL_BASE_URL` (default `http://127.0.0.1:8080/v1`). There is NO
  Ollama-specific provider in the execution path. `LOCAL_MODEL_NAME` is sent
  verbatim to the endpoint and shown verbatim in the TUI header — it must
  match the server's model id (NOT an Ollama `name:tag` with a colon).
- Ollama is only ever reached if the USER explicitly points
  `LOCAL_MODEL_BASE_URL` at `http://127.0.0.1:11434/v1`. `src/tui/render.js`
  `backendLabel()` merely labels such a URL "Ollama"; it never selects it.
- `cloudFallback` falls back ONLY to a configured cloud API key, never to
  Ollama. A dead local endpoint throws a connection error rather than
  silently succeeding or rerouting.
- Regression coverage: `tests/test-provider-routing.js` (real ModelRouter +
  Provider, mocked HTTP) asserts local selection, configured URL/model sent,
  no `:11434`, no silent fallback. `tests/test-tui-connectivity.js` uses the
  REAL Orchestrator (not a fake) to assert the TUI header Status line is
  DISCONNECTED (down server) / CONNECTED (up server), the LOCAL MODEL
  UNAVAILABLE banner never blames Ollama, and a real `orch.run` completion
  reaches the configured endpoint+model with no `:11434`. `tests/test-tui-e2e.js`
  drives the REAL TUI→Agent→Orchestrator→ModelRouter→(mock)endpoint stack and
  asserts the header + real tool/verify/memory flow end to end.
- **TUI color pitfall**: `src/tui/render.js` `colorEnabled()` keys off
  `process.stdout.isTTY` (global), NOT the TUI's injected output stream. So
  when a test captures output into a non-TTY stream but the test runner's
  stdout IS a TTY, the captured text contains ANSI codes. TUI tests must set
  `NO_COLOR=1` (and clean it up) for ANSI-stable string assertions.

## See `docs/ARCHITECTURE.md` for the foundation decision (OpenHands + Aider +
OpenCode concepts, implemented natively rather than imported wholesale).
