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
LOCAL_MODEL_NAME=qwen2.5-coder:3b
```

Prefer small coding models (e.g. `qwen2.5-coder:3b`) that fit limited hardware.
Do not commit model files; they are served by your local backend.

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
