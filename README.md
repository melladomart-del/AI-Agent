# AI-Agent

A modular, local-first, open-source AI coding agent. It understands a
repository, plans a task, selects relevant context, edits files, runs commands,
verifies its changes, and corrects itself — designed to run on a low-resource
local server with an interchangeable local model backend.

## Quick start

```bash
npm install
cp .env.example .env   # then edit .env to point at your model server
node index.js "explain the structure of this repo"
node index.js            # interactive TUI
npm test                # run the test suite
```

## Model backend

The agent talks to any **OpenAI-compatible** endpoint, so you can use:

- `llama.cpp` server (`/v1`)
- Ollama's OpenAI-compatible endpoint (optional, not a hard dependency)
- LM Studio
- vLLM
- a cloud provider as an optional development fallback

Configure via environment variables (see `.env.example`):

```
MODEL_PROVIDER=local
LOCAL_MODEL_BASE_URL=http://127.0.0.1:8080/v1
LOCAL_MODEL_NAME=qwen2.5-coder:1.5b
```

Prefer small coding models that fit limited hardware. The agent has been
validated end-to-end with **Qwen2.5-Coder-1.5B-Instruct** (Q4_K_M GGUF, ~1.1GB)
served by `llama.cpp`/`llama-cpp-python`. `qwen2.5-coder:3b` via Ollama also
works. Do not commit model files; they are served by your local backend.

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

`node index.js` (no task argument) opens the interactive TUI. It is a pure
**observer** of the engine's EventBus: it prints a compact, streaming transcript
of the agent's work as events arrive — no full-screen repaint, no heavy TUI
framework, so it stays light on an old machine and robust under resize.

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
User → TUI/index.js → Orchestrator → Agent (action/observation loop)
                        │
   ┌────────────────────┼─────────────────────┐
   │                    │                     │
ContextSelector      ModelRouter           ToolRegistry
 (repo map,           (local/cloud,          (files, git,
   skills,               OpenAI-compat)        shell, tests)
   memory)
                        │
                  Verification → Corrector → Memory/Experience
```

## Layout

```
src/
  config.js                 env-based configuration
  providers/                OpenAI-compatible model abstraction + router
  engine/
    agent.js                autonomous action/observation loop
    orchestrator.js         wires all subsystems together
    planner.js              architect-phase planning
    context-selector.js     repo map + skills + experiences
    repo-analyzer.js        token-budgeted symbol repo map (Aider-style)
    skill-registry.js       relevance-based skill loading
    memory.js               persistent operational memory + experience retrieval
    verification.js         objective test/command verification
    corrector.js            failure → diagnose → fix → re-verify
    safety.js               protected paths + blocked commands
    event-bus.js            decoupled eventing
  tools/
    tool.js, registry.js    tool base + registry + safety dispatch
    files.js                file/search/shell/git/test/finish tools
  tui/tui.js                interactive terminal UI
  util/minimatch.js         tiny glob matcher
skills/                     curated, de-duplicated skills (loaded dynamically)
tests/                      node:test suite
```

## License

MIT
