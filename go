#!/usr/bin/env bash
# KLYVIA launcher wrapper. Resolves symlinks so `go` works globally (via an
# install.sh symlink in ~/.local/bin) as well as via `./go` from the repo root.
set -e
src="${BASH_SOURCE[0]}"
# Follow symlinks to the real file so SCRIPT_DIR is the project root regardless
# of how `go` was invoked.
while [ -L "$src" ]; do
  dir="$(cd -P "$(dirname "$src")" >/dev/null 2>&1 && pwd)"
  src="$(readlink "$src")"
  case "$src" in
    /*) : ;;
    *) src="$dir/$src" ;;
  esac
done
SCRIPT_DIR="$(cd -P "$(dirname "$src")" >/dev/null 2>&1 && pwd)"
exec node "${SCRIPT_DIR}/bin/go.js" "$@"
