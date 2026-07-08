#!/usr/bin/env bash
#
# budgetr one-click launcher (macOS / Linux) — no coding knowledge needed.
#
# Double-click "Start budgetr.command" on macOS, or run ./start.sh in a
# terminal. On first run it will, as needed: download a private copy of
# Node.js into web/.node-runtime, install dependencies, set up the database,
# and build the app. Then it opens budgetr in your browser. Everything stays
# inside this folder — nothing is installed system-wide.
#
# Flags: --rebuild  force a rebuild of the app (after `git pull`, this happens
#                   automatically; use it if something looks stale)

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT/web"

PORT="${PORT:-3001}"
URL="http://localhost:$PORT"
NODE_MAJOR_MIN=20
NODE_SERIES="latest-v24.x"
RUNTIME="$ROOT/web/.node-runtime"

say() { printf '\n\033[1m» %s\033[0m\n' "$*"; }
fail() {
  printf '\n\033[31m✖ %s\033[0m\n' "$*" >&2
  # Keep the window open when launched by double-click so the error is readable.
  read -r -p "Press Enter to close…" _ 2>/dev/null || true
  exit 1
}

node_ok() { "$1" -e "process.exit(parseInt(process.versions.node, 10) >= $NODE_MAJOR_MIN ? 0 : 1)" >/dev/null 2>&1; }

# ── 1. Node.js — use the private copy, then the system one, else download ────
if [ -x "$RUNTIME/bin/node" ] && node_ok "$RUNTIME/bin/node"; then
  export PATH="$RUNTIME/bin:$PATH"
elif command -v node >/dev/null 2>&1 && node_ok "$(command -v node)"; then
  : # system Node is new enough
else
  say "Downloading a private copy of Node.js (one time, ~50 MB)…"
  case "$(uname -s)" in
    Darwin) os=darwin ;;
    Linux) os=linux ;;
    *) fail "Unsupported operating system: $(uname -s). See web/README.md for manual setup." ;;
  esac
  case "$(uname -m)" in
    arm64 | aarch64) arch=arm64 ;;
    x86_64) arch=x64 ;;
    *) fail "Unsupported processor: $(uname -m). Install Node.js 20+ from https://nodejs.org and re-run." ;;
  esac
  tarball="$(curl -fsSL "https://nodejs.org/dist/$NODE_SERIES/SHASUMS256.txt" | grep -o "node-v[0-9.]*-$os-$arch\.tar\.gz" | head -1)" ||
    fail "Couldn't reach nodejs.org — check your internet connection and re-run."
  [ -n "$tarball" ] || fail "No Node.js download available for $os/$arch."
  tmp="$(mktemp -d)"
  curl -fL --progress-bar -o "$tmp/node.tar.gz" "https://nodejs.org/dist/$NODE_SERIES/$tarball" ||
    fail "The Node.js download failed — check your internet connection and re-run."
  rm -rf "$RUNTIME" && mkdir -p "$RUNTIME"
  tar -xzf "$tmp/node.tar.gz" -C "$RUNTIME" --strip-components=1
  rm -rf "$tmp"
  export PATH="$RUNTIME/bin:$PATH"
fi
say "Using Node.js $(node --version)"

# ── 2. Dependencies (skipped when already up to date) ────────────────────────
if [ ! -d node_modules ] || [ package-lock.json -nt node_modules/.package-lock.json ]; then
  say "Installing dependencies — the first run takes a few minutes…"
  npm ci --no-audit --no-fund || fail "Dependency install failed. See the messages above."
fi

# ── 3. Database + settings (idempotent) ───────────────────────────────────────
say "Preparing the database…"
npm run --silent setup || fail "Database setup failed. See the messages above."

# ── 4. Build the app when missing or the code has changed ────────────────────
rev="$(git -C "$ROOT" rev-parse HEAD 2>/dev/null || echo no-git)"
stamp=".next/.budgetr-build-rev"
if [ "${1:-}" = "--rebuild" ] || [ ! -f .next/BUILD_ID ] || [ "$rev" != "$(cat "$stamp" 2>/dev/null || true)" ]; then
  say "Building the app — the first run takes a few minutes…"
  npm run --silent build || fail "Build failed. See the messages above."
  printf '%s' "$rev" >"$stamp"
fi

# ── 5. Start, and open the browser once the server answers ───────────────────
open_url() {
  if command -v open >/dev/null 2>&1; then open "$URL"; elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$URL"; fi
}

if curl -so /dev/null "$URL" 2>/dev/null; then
  say "Something is already running at $URL — opening it in your browser."
  open_url
  exit 0
fi

(
  for _ in $(seq 1 120); do
    sleep 1
    if curl -so /dev/null "$URL" 2>/dev/null; then
      open_url
      exit 0
    fi
  done
) &

say "Starting budgetr at $URL — keep this window open. Press Ctrl+C to stop."
exec npx next start -p "$PORT"
