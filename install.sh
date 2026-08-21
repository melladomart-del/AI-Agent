#!/bin/sh
# KLYVIA installer — installs KLYVIA globally so `klyvia` works from any dir.
#
# POSIX sh compatible: works with `curl … | sh` (dash/ash/bash) and `./install.sh`.
#
# Two modes:
#   1. curl-pipe (no existing clone):
#        curl -fsSL https://raw.githubusercontent.com/melladomart-del/AI-Agent/feat/local-coding-agent/install.sh | sh
#      → clones into ~/.klyvia/app and installs global commands.
#   2. from a repo clone:
#        git clone <repo> && cd AI-Agent && ./install.sh
#      → uses the current dir as the app code (dev or local install).
#
# What it does:
#   1. detects Linux/macOS
#   2. checks Node.js (and Git for curl-pipe mode)
#   3. installs/updates the app code (clone or in-place)
#   4. installs runtime dependencies (npm install)
#   5. creates ~/.klyvia/{config,runtime} and a config.env (never overwrites)
#   6. installs global commands: klyvia, go, GO (symlinks in ~/.local/bin)
#   7. ensures ~/.local/bin is on PATH (prints guidance if not)
#   8. detects llama.cpp
#   9. runs a non-blocking diagnostic
#
# Idempotent, machine-agnostic, no hardcoded absolute paths, no secrets, no
# model downloads. User configuration survives updates.
set -e

KLYVIA_REPO="${KLYVIA_REPO:-melladomart-del/AI-Agent}"
KLYVIA_BRANCH="${KLYVIA_BRANCH:-feat/local-coding-agent}"
KLYVIA_HOME="${HOME}/.klyvia"
KLYVIA_APP="${KLYVIA_HOME}/app"
KLYVIA_CONFIG_DIR="${KLYVIA_HOME}/config"
KLYVIA_CONFIG_FILE="${KLYVIA_CONFIG_DIR}/config.env"
KLYVIA_RUNTIME="${KLYVIA_HOME}/runtime"

green() { printf '\033[32m%s\033[0m\n' "$1"; }
yellow() { printf '\033[33m%s\033[0m\n' "$1"; }
red() { printf '\033[31m%s\033[0m\n' "$1"; }
step() { printf '\n==> %s\n' "$1"; }

# Detect whether this script is running from a real repo clone vs. curl-pipe.
# Under curl-pipe, $0 is "sh" and there is no script file on disk; under a
# clone, $0 is the script path (e.g. ./install.sh). Use a path that exists and
# contains package.json to decide in-place mode. Bash's BASH_SOURCE is avoided
# so plain `sh` (dash/ash) works for `curl … | sh`.
SCRIPT_PATH=""
if [ -n "${0:-}" ] && [ -f "${0}" ]; then
  SCRIPT_PATH="$(cd "$(dirname "${0}")" && pwd)"
fi
IN_PLACE=0
if [ -n "$SCRIPT_PATH" ] && [ -f "${SCRIPT_PATH}/package.json" ]; then
  IN_PLACE=1
fi

step "Detecting platform"
OS="$(uname -s)"
case "$OS" in
  Linux*) green "Linux x86_64 detected" ;;
  Darwin*) green "macOS detected" ;;
  *) yellow "Unsupported OS: $OS (proceeding anyway)" ;;
esac

step "Checking Node.js"
if ! command -v node >/dev/null 2>&1; then
  red "Node.js is not installed. Install Node.js (v18+) first: https://nodejs.org/"
  exit 1
fi
green "Found Node.js $(node -v)"

if [ "$IN_PLACE" -eq 0 ]; then
  step "Checking Git (required for curl-pipe install)"
  if ! command -v git >/dev/null 2>&1; then
    red "Git is not installed. Install git, or clone the repo manually and run ./install.sh from it."
    exit 1
  fi
  green "Found git $(git --version 2>/dev/null | sed 's/git version //')"

  step "Installing KLYVIA into ${KLYVIA_APP}"
  if [ -d "${KLYVIA_APP}/.git" ]; then
    yellow "Existing install found — updating (your config is preserved)."
    git -C "${KLYVIA_APP}" fetch origin "${KLYVIA_BRANCH}"
    git -C "${KLYVIA_APP}" reset --hard "origin/${KLYVIA_BRANCH}"
  else
    git clone --depth 1 -b "${KLYVIA_BRANCH}" "https://github.com/${KLYVIA_REPO}.git" "${KLYVIA_APP}"
  fi
  APP_DIR="${KLYVIA_APP}"
else
  APP_DIR="${SCRIPT_PATH}"
  green "Using existing repo clone at ${APP_DIR}"
fi
cd "$APP_DIR"

step "Installing dependencies"
if [ -f package.json ]; then
  npm install
  green "Dependencies installed."
else
  red "No package.json found in $APP_DIR"
  exit 1
fi

step "Preparing KLYVIA home (~/.klyvia)"
mkdir -p "${KLYVIA_CONFIG_DIR}" "${KLYVIA_RUNTIME}"

# Configuration: never overwrite an existing user config. For managed installs,
# write config.env (pointing RUNTIME_DIR at the absolute runtime path) if none.
# For in-place dev installs, use the repo .env as today.
if [ "$IN_PLACE" -eq 0 ]; then
  if [ ! -f "${KLYVIA_CONFIG_FILE}" ]; then
    {
      echo "# KLYVIA configuration (managed install). Edit freely; survives updates."
      echo "KLYVIA_MODE=auto"
      echo "MODEL_PROVIDER=local"
      echo "LOCAL_MODEL_BASE_URL=http://127.0.0.1:8080/v1"
      echo "LOCAL_MODEL_NAME=qwen2.5-coder-1.5b-instruct"
      echo "MODEL_PATH="
      echo "LLAMA_BIN="
      echo "LLAMA_CONTEXT=4096"
      echo "LLAMA_HOST=127.0.0.1"
      echo "KLYVIA_SERVER_URL="
      echo "KLYVIA_API_KEY="
      echo "# Absolute runtime dir so pid/logs go to ~/.klyvia/runtime, not the app dir."
      echo "RUNTIME_DIR=${KLYVIA_RUNTIME}"
      echo "# Point the app at this config + its own code when launched globally."
      echo "KLYVIA_APP_ROOT=${KLYVIA_APP}"
    } > "${KLYVIA_CONFIG_FILE}"
    yellow "Created ${KLYVIA_CONFIG_FILE} — edit it to set MODEL_PATH etc."
  else
    green "Existing config preserved at ${KLYVIA_CONFIG_FILE}"
  fi
  # Symlink the config into the app dir as .env so the app finds it.
  ln -sf "${KLYVIA_CONFIG_FILE}" "${APP_DIR}/.env"
else
  if [ ! -f .env ]; then
    cp .env.example .env
    yellow "Created .env from .env.example — edit it to point at your local model server."
  else
    green ".env already exists (left untouched)."
  fi
fi

step "Making the launcher executable"
chmod +x ./klyvia ./go ./bin/go.js 2>/dev/null || chmod +x ./go ./bin/go.js
green "Launcher ready"

step "Installing global commands (klyvia, go, GO)"
BIN_DIR="${HOME}/.local/bin"
mkdir -p "$BIN_DIR"
ln -sf "${APP_DIR}/klyvia" "${BIN_DIR}/klyvia" 2>/dev/null || ln -sf "${APP_DIR}/go" "${BIN_DIR}/klyvia"
ln -sf "${APP_DIR}/go" "${BIN_DIR}/go"
ln -sf "${APP_DIR}/go" "${BIN_DIR}/GO"
if echo ":${PATH}:" | grep -q ":${BIN_DIR}:"; then
  green "Commands installed: klyvia, go, GO (on PATH at ${BIN_DIR})"
else
  yellow "Symlinks created in ${BIN_DIR}, but it is not on your PATH."
  yellow "Add this to your shell profile (~/.bashrc or ~/.zshrc) and restart your shell:"
  printf '    export PATH="${HOME}/.local/bin:${PATH}"\n'
fi

step "Detecting llama.cpp (optional, for auto-start)"
LLAMA_FOUND=""
for cand in llama llama-server; do
  if command -v "$cand" >/dev/null 2>&1; then LLAMA_FOUND="$(command -v "$cand")"; break; fi
done
if [ -z "$LLAMA_FOUND" ] && [ -x "${HOME}/.local/bin/llama" ]; then
  LLAMA_FOUND="${HOME}/.local/bin/llama"
fi
if [ -n "$LLAMA_FOUND" ]; then
  green "Found llama.cpp at ${LLAMA_FOUND}"
  green "  Set MODEL_PATH in your config to your .gguf and klyvia will start the server for you."
else
  yellow "llama.cpp not found on PATH or ~/.local/bin/llama."
  yellow "  (Optional) install llama.cpp, or set MODEL_START_CMD in your config."
fi

step "Diagnostic"
set +e
node "${APP_DIR}/bin/go.js" doctor
DOCTOR_RC=$?
set -e
if [ "$DOCTOR_RC" -eq 0 ]; then
  green "Doctor passed."
else
  yellow "Doctor reported issues above — expected before you set MODEL_PATH. Run 'klyvia doctor' again after configuring."
fi

green ""
green "Installation complete."
printf 'Next steps:\n'
printf '    klyvia config    # review/edit configuration\n'
printf '    klyvia doctor    # verify the setup\n'
printf '    klyvia           # start the backend + launch the TUI\n'
if [ "$IN_PLACE" -eq 0 ]; then
  printf '\nInstall URL for this branch:\n  https://raw.githubusercontent.com/%s/%s/install.sh\n' "$KLYVIA_REPO" "$KLYVIA_BRANCH"
fi
exit 0
