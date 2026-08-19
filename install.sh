#!/usr/bin/env bash
# KLYVIA installer — prepares the project for daily use with `go`.
#
#   git clone <repo> && cd AI-Agent && ./install.sh && go
#
# What it does:
#   1. checks for Node.js
#   2. installs runtime dependencies (npm install)
#   3. copies .env.example -> .env if none exists (no secrets are written)
#   4. makes the launcher executable
#   5. offers to make `go` available globally (symlink into ~/.local/bin)
#
# It is idempotent and machine-agnostic: no hardcoded absolute paths, no
# secrets, no model downloads. Everything model-related is configured later
# via .env (see MODEL_START_CMD / LOCAL_MODEL_BASE_URL).
set -e

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_DIR"

green() { printf '\033[32m%s\033[0m\n' "$1"; }
yellow() { printf '\033[33m%s\033[0m\n' "$1"; }
red() { printf '\033[31m%s\033[0m\n' "$1"; }
step() { printf '\n==> %s\n' "$1"; }

step "Checking Node.js"
if ! command -v node >/dev/null 2>&1; then
  red "Node.js is not installed. Install Node.js (v18+) first: https://nodejs.org/"
  exit 1
fi
green "Found Node.js $(node -v)"

step "Installing dependencies"
if [ -f package.json ]; then
  npm install
  green "Dependencies installed."
else
  red "No package.json found in $PROJECT_DIR"
  exit 1
fi

step "Preparing configuration"
if [ ! -f .env ]; then
  cp .env.example .env
  yellow "Created .env from .env.example — edit it to point at your local model server."
else
  green ".env already exists (left untouched)."
fi

step "Making the launcher executable"
chmod +x ./go
chmod +x ./bin/go.js
green "Launcher ready: ./go"

# Offer a global `go` command (symlink into ~/.local/bin, which is usually on PATH).
step "Making 'go' available globally"
BIN_DIR="${HOME}/.local/bin"
mkdir -p "$BIN_DIR"
ln -sf "${PROJECT_DIR}/go" "${BIN_DIR}/go"
if echo ":${PATH}:" | grep -q ":${BIN_DIR}:"; then
  green "'go' is on your PATH at ${BIN_DIR}/go"
else
  yellow "Symlinked ${BIN_DIR}/go, but ${BIN_DIR} is not on your PATH."
  yellow "Add this line to your shell profile (~/.bashrc or ~/.zshrc) and restart your shell:"
  printf '    export PATH="${HOME}/.local/bin:${PATH}"\n'
fi

green ""
green "Installation complete."
printf 'Next: edit .env to point at your local model server (LOCAL_MODEL_BASE_URL, MODEL_START_CMD), then run:\n'
printf '    go            # start services + launch the TUI\n'
printf '    go doctor     # verify the setup\n'
