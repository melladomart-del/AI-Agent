# Architecture & Decision Record

## Repository audit (starting point)

The repository before this work was a minimal prototype, not the multi-module
system described in the task brief. It contained:

- `agent.js` — a single OpenRouter-based file that loaded **all** skills into
  every prompt and ran a 30-step tool-calling loop with 7 tools.
- `tools/` — 7 standalone tool modules (`listFiles`, `readFile`, `writeFile`,
  `runCommand`, `gitCommit`, `searchCode`, `deployNetlify`).
- `skills/` — 46 markdown skills, **30 of which were empty 0-byte files**, plus
  duplicates (`visual-ui-design` ≈ `visual-design`, `react-native` ≈
  `expo-react-native`, `accessibility-testing` ≈ `accessibility`).
- `todo-app/index.html` — a demo artifact.
- `.netlify/` — a Netlify state file containing a hardcoded `siteId` and a
  `netlify-cli` dev dependency used only by `deployNetlify`.
- `package.json` listed `netlify-cli` (a heavy dev dependency) and `openai` +
  `dotenv`.

There were **no** `engine/`, `providers/`, `tui/`, `memory/`, `intent-engine/`,
or `web/` directories, and no tests. The systems the brief asked to "reuse"
(memory, planner, orchestrator, verification, corrector, experience, context
selection, model-router, repository analysis) **did not exist**. They have been
built here.

## Foundation decision: which open-source agent to borrow from

Candidates evaluated: OpenHands, OpenCode, Aider, Goose, Cline, Continue.

| Project | License | Interface | Local models | Notes |
| --- | --- | --- | --- | --- |
| OpenHands | MIT | Web/CLI | Yes, model-agnostic | Strongest *architecture* (event-sourced loop, SDK) |
| OpenCode | MIT | Terminal TUI | Yes, Ollama/llama.cpp | Strongest "provider-agnostic" design principle |
| Aider | Apache-2.0 | Terminal/git | Yes | Strongest *context* idea (tree-sitter repo map) |

**Decision:** do **not** import any of these projects whole (they are Python/Go
and would create opaque external dependencies, contradicting the brief). Instead
adopt the strongest *concepts* and implement them in the project's existing
Node.js stack with zero new runtime dependencies:

- **From OpenHands** — the event-sourced action/observation loop, the idea that
  an agent is "a function from event history to the next event, run in a loop",
  provider-agnostic LLM with retry, and security-before-execution. Implemented
  in `engine/agent.js`, `providers/`, `engine/safety.js`, `engine/event-bus.js`.
- **From Aider** — a token-budgeted **repo map** built from extracted symbols
  ranked by reference count, and the **architect/editor split** (plan first,
  then act). Aider uses tree-sitter + PageRank + SQLite; we use a
  dependency-free regex symbol extractor + reference counting, which is far
  lighter and adequate for the small/medium repos targeted on an old PC.
  Implemented in `engine/repo-analyzer.js`, `engine/planner.js`,
  `engine/context-selector.js`.
- **From OpenCode** — the "not coupled to any model vendor" principle: a single
  OpenAI-compatible model interface so llama.cpp, Ollama (optional), LM Studio,
  vLLM, or a cloud provider are interchangeable. Implemented in `providers/`.

## Model abstraction

`providers/provider.js` wraps the `openai` npm client around any
OpenAI-compatible endpoint. `providers/model-router.js` selects the primary
backend (local by default) and optionally falls back to a cloud backend. The
agent engine only ever calls `modelRouter.complete(...)`; it never knows which
inference backend is running. Ollama is **not** a hard dependency — it is just
one possible OpenAI-compatible endpoint.

## Autonomous agent loop

```
task
 → ContextSelector.build(task): repo map + relevant skills + past experiences
 → Planner.plan(): short ordered plan (architect phase)
 → Agent.run(): action/observation loop (editor phase)
     model picks tools → registry.dispatch (with safety checks) → observation
     → repeat until `finish` or step budget
 → Verifier.verify(): run tests / custom command (objective, not the agent's claim)
 → if failed: Corrector.correct(): feed failure back, re-run, re-verify (≤ maxRetries)
 → Memory.record(): store task/plan/actions/errors/result/score as an experience
```

This matches the required loop shape: understand → analyze → plan → select
context → choose tools → execute → observe → test → verify → (success? done :
diagnose → correct → test again).

## Intelligent context (do not send the whole repo)

`RepoAnalyzer` extracts symbols from code files, counts whole-word references
across the repo, ranks symbols by reference count, and emits only the top
symbols within a token budget (`REPO_MAP_MAX_TOKENS`, default 1024). The
`SkillRegistry` selects only the top-K skills relevant to the task by lexical
overlap instead of loading all skills (the old behavior). The `Memory` retrieves
the most similar past experiences by lexical overlap and injects their summary.

## Safety

`engine/safety.js` enforces protected write paths (`PROTECTED_PATHS`) and blocked
shell commands (`BLOCKED_COMMANDS`). Safety violations are returned as
*observations* (strings), not thrown, so the agent can observe and self-correct —
the OpenHands pattern.

## Resource constraints

- Zero new runtime dependencies (uses only the pre-existing `openai` + `dotenv`).
- Tests use the built-in `node:test` runner (no test dependency).
- Repo map and skill selection keep prompts small for a local 3B model.
- No model files are committed; `.agent-memory/` is gitignored.
- Removed the heavy `netlify-cli` dev dependency and the Netlify state file.

## Cleanup performed

- Removed `.netlify/` (hardcoded `siteId` artifact), `netlify-cli` dev
  dependency, and `deployNetlify` tool.
- Removed 30 empty skill files and 3 duplicate skills; recreated a real
  `error-recovery` skill (a core skill referenced by the registry).
- Replaced `agent.js` with a thin shim to the new engine; old `tools/` directory
  superseded by `src/tools/`; removed `test.js` (OpenRouter connectivity test)
  and `hello.txt` (stray artifact).
