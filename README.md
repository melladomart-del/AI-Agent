# KLYVIA

> Local-first AI coding agent.

[Quick Start](#quick-start) ·
[Installation](#installation) ·
[Commands](#commands) ·
[Configuration](#configuration) ·
[Local Models](#local-models) ·
[KLYVIA Server](#klyvia-server) ·
[Development](#development)

KLYVIA is a modular, open-source AI coding agent that runs on your own
machine. It understands a repository, plans a task, selects the relevant
context, edits files, runs commands, verifies its changes, and corrects its own
mistakes — all driven by a local model you control.

## What You Get

- **Local-first.** Your code and prompts never leave your machine.
- **One-command install.** `curl … | sh`, then `klyvia` from anywhere.
- **Global `klyvia` command.** Works from any directory.
- **Automatic llama.cpp startup.** Set `MODEL_PATH` and KLYVIA starts the server
  for you, waits for it to be ready, and reaps it on exit.
- **GGUF model support.** Any small coding model that runs in llama.cpp.
- **Terminal interface.** A streaming TUI that stays cheap on an old machine.
- **Local / remote architecture.** `KLYVIA_MODE` switches between a local
  backend, a future KLYVIA server, or automatic fallback.
- **Safe by design.** Protected paths, blocked commands, no secrets in code.

## Quick Start

### Install

```bash
curl -fsSL https://raw.githubusercontent.com/melladomart-del/AI-Agent/feat/local-coding-agent/install.sh | sh
```

This clones KLYVIA into `~/.klyvia/app`, installs dependencies, creates a
config (never overwriting an existing one), and installs the global commands
`klyvia`, `go`, and `GO` in `~/.local/bin`.

> The distribution branch is **`feat/local-coding-agent`** (verified — that is
> where the launcher work lives). Override with `KLYVIA_REPO` and
> `KLYVIA_BRANCH` env vars if you fork.

### Configure

```bash
klyvia config
```

Edit `~/.klyvia/config/config.env` and point KLYVIA at your model:

```env
KLYVIA_MODE=local
LOCAL_MODEL_BASE_URL=http://127.0.0.1:8080/v1
LOCAL_MODEL_NAME=qwen2.5-coder
MODEL_PATH=/home/you/models/qwen.gguf
LLAMA_BIN=                 # leave empty to auto-detect ~/.local/bin/llama
LLAMA_CONTEXT=4096
```

### Launch

```bash
cd ~/projects/my-app
klyvia
```

KLYVIA starts `llama serve -m <MODEL_PATH> --port 8080 --host 127.0.0.1 -c 4096`,
waits for the model to be ready, then launches the TUI against **your project**
(not the install directory). On exit, the model server is stopped cleanly.

## Installation

### One-command (curl-pipe)

```bash
curl -fsSL https://raw.githubusercontent.com/melladomart-del/AI-Agent/feat/local-coding-agent/install.sh | sh
```

Installs into `~/.klyvia/`:

```
~/.klyvia/
├── app/          # the KLYVIA code (git clone)
├── config/       # config.env — survives updates
└── runtime/      # pid + logs (gitignored, ephemeral)
```

Global commands are symlinked into `~/.local/bin`:

```
~/.local/bin/klyvia   ~/.local/bin/go   ~/.local/bin/GO
```

If `~/.local/bin` is not on your `PATH`, the installer prints the exact line
to add to your shell profile.

### From a clone (developers)

```bash
git clone https://github.com/melladomart-del/AI-Agent.git
cd AI-Agent
./install.sh
```

In this mode KLYVIA runs from the clone itself; config lives in the repo's
`.env`. Useful for development.

### Update

```bash
klyvia update
```

Pulls the latest code from GitHub, reinstalls dependencies, and **preserves
your configuration**. Only works on managed installs (`~/.klyvia/app`); for a
dev clone it tells you to `git pull` manually.

### Uninstall

```bash
klyvia uninstall            # prompts for confirmation
klyvia uninstall --yes      # no prompt
klyvia uninstall --purge    # also removes your configuration
```

By default KLYVIA removes the app code, runtime, and global symlinks, but
**keeps your configuration, your models, and llama.cpp**. Use `--purge` to also
remove the configuration.

## Commands

```
klyvia            start the backend + launch the TUI
klyvia start      start the model server (if configured)
klyvia stop       stop services managed by klyvia
klyvia restart    stop + start
klyvia status     show service readiness + active backend
klyvia logs       tail model-server logs
klyvia doctor     run a full diagnostic
klyvia config     show configuration (secrets masked)
klyvia update     update the app from GitHub (managed installs)
klyvia uninstall  remove KLYVIA (config kept unless --purge)
klyvia help       show usage
klyvia --version  print the version
```

`go` and `GO` are aliased to `klyvia` and accept the same subcommands. All
commands work from any directory.

## Configuration

KLYVIA reads configuration from (in priority order): environment variables, the
config file (`~/.klyvia/config/config.env` for managed installs, `.env` for dev
clones), then built-in defaults. Run `klyvia config` to see the resolved values
(secrets are masked, never printed in full).

Key variables:

| Variable | Default | Purpose |
|---|---|---|
| `KLYVIA_MODE` | `auto` | `local` / `remote` / `auto` (see [KLYVIA Server](#klyvia-server)) |
| `LOCAL_MODEL_BASE_URL` | `http://127.0.0.1:8080/v1` | Local model server endpoint (OpenAI-compatible) |
| `LOCAL_MODEL_NAME` | `qwen2.5-coder-1.5b-instruct` | Model id exactly as the server exposes it |
| `MODEL_PATH` | _(empty)_ | Path to your `.gguf` — enables auto-start |
| `LLAMA_BIN` | _(auto-detect)_ | Path to the llama.cpp binary |
| `LLAMA_CONTEXT` | `4096` | Context size passed to `llama serve -c` |
| `LLAMA_HOST` | `127.0.0.1` | Host passed to `llama serve --host` |
| `KLYVIA_SERVER_URL` | _(empty)_ | Future KLYVIA server URL (remote mode) |
| `KLYVIA_API_KEY` | _(empty)_ | API key for the KLYVIA server (masked in output) |

## Local Models

KLYVIA speaks the OpenAI HTTP API, so any OpenAI-compatible local server works
(llama.cpp, LM Studio, vLLM, …). The default and recommended backend is
**llama.cpp**, served on `http://127.0.0.1:8080/v1`.

### Automatic startup

Set `MODEL_PATH` to your `.gguf` file and KLYVIA builds and runs:

```bash
llama serve -m /home/you/models/qwen.gguf --port 8080 --host 127.0.0.1 -c 4096
```

It waits for `/v1/models` to respond before launching the TUI, prevents a
second instance if the endpoint is already up, and stops the server cleanly
(SIGTERM, then SIGKILL if needed) when the TUI exits. No orphan processes.

### Recommended small models

For a low-resource machine (4 CPUs, ~6 GB RAM, no GPU), use a small coding
model such as **Qwen2.5-Coder-1.5B-Instruct** (Q4_K_M GGUF, ~1.1 GB), which
runs end-to-end on modest hardware. Download GGUF files out of band — KLYVIA
never downloads model weights.

### Custom server

If you use a different server (or want full control over the start command),
set `MODEL_START_CMD` and `MODEL_START_ARGS` instead of `MODEL_PATH`.

## KLYVIA Server

KLYVIA supports three modes via `KLYVIA_MODE`:

- **`local`** — only the local backend (llama.cpp). Default for local-first use.
- **`remote`** — require the future KLYVIA server (`KLYVIA_SERVER_URL`). If it
  is unreachable, KLYVIA **fails hard** and does not silently fall back to the
  local backend.
- **`auto`** (default) — if `KLYVIA_SERVER_URL` is configured and reachable,
  use it; otherwise fall back to the local backend, and say so in `klyvia doctor`.

```
KLYVIA_SERVER_URL configured?
        │
       YES
        │
        ▼
   reachable?
    │      │
   YES    NO
    │      │
    ▼      ▼
 remote  local (auto fallback)
```

The KLYVIA server protocol is not yet finalized; the abstraction is in place so
a remote backend can be added without changing the agent loop.

## Development

```bash
git clone https://github.com/melladomart-del/AI-Agent.git
cd AI-Agent
npm install
npm test                # node --test tests/test-*.js
node index.js "task"    # one-shot mode
node index.js           # interactive TUI
```

### Architecture

```
USER → TUI → Orchestrator → {Planner, ContextSelector, Memory, Skills}
                                  ↓
                            Model Layer (OpenAI-compatible)
                                  ↓
                         Tools {Files, Terminal, Git}
                                  ↓
                       Verification → Auto-correction → Memory
```

- **`bin/go.js`** — the `klyvia`/`go` launcher and service manager.
- **`src/engine/`** — orchestrator, planner, context-selector, verification,
  corrector, memory, agent, event-bus, skill-registry, repo-analyzer, safety.
- **`src/providers/`** — provider-agnostic model layer + router.
- **`src/tools/`** — file, terminal, git tools with a safety guard.
- **`src/tui/`** — streaming terminal UI (pure observer of the event bus).
- **`skills/`** — bundled markdown skills, loaded dynamically per task.

`rootDir` (the user's project) and `appRoot` (KLYVIA's code) are separate, so a
global `klyvia` targets the project you are in, not its own install directory.
Memory is per-project; skills are bundled with the app.

### Tests

```bash
npm test                 # 140 tests, 0 fail (4 live-gated, skipped)
AI_AGENT_LIVE=1 npm test # includes live model-endpoint tests
```

## License

MIT. No model weights are included; bring your own GGUF.
