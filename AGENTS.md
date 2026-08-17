# AI-Agent — repository memory

## What this project is
A modular, local-first, open-source AI coding agent in Node.js. It runs an
autonomous understand→plan→edit→verify→correct loop against an interchangeable
OpenAI-compatible local model backend. Target deployment: an old, low-resource
local server.

## Key facts for future sessions
- Stack: Node.js (CommonJS). Runtime deps: only `openai` + `dotenv`. Tests use
  the built-in `node:test` runner (`node --test tests/`). **Do not add heavy
  runtime or test dependencies.**
- Entry: `node index.js "task"` (one-shot) or `node index.js` (TUI). `agent.js`
  is a backward-compatible shim to `index.js`.
- Config via env / `.env` (see `.env.example`). `MODEL_PROVIDER=local` +
  `LOCAL_MODEL_BASE_URL` point at any OpenAI-compatible server (llama.cpp,
  Ollama optional, LM Studio, vLLM). Ollama is NOT a hard dependency.
- The model engine only calls `modelRouter.complete(...)`; it never knows the
  backend. Add backends in `src/providers/`.

## Architecture map
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
- `.agent-memory/` and `.env` are gitignored. Never commit model files.
- See `docs/ARCHITECTURE.md` for the foundation decision (OpenHands + Aider +
  OpenCode concepts, implemented natively rather than imported wholesale).
