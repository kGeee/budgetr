#!/usr/bin/env bash
#
# Install (or refresh) the budgetr always-on server + Caddy proxy as macOS LaunchAgents.
#
# After running this, open http://budgetr.localhost in your browser to install the PWA.
# Run again after pulling new code (rebuilds automatically if .next is missing).
#
set -euo pipefail

SERVER_LABEL="dev.budgetr.server"
CADDY_LABEL="dev.budgetr.caddy"
PORT="${PORT:-3000}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
CADDYFILE="$SCRIPT_DIR/Caddyfile"

NODE_BIN="$(command -v node)"
NODE_DIR="$(dirname "$NODE_BIN")"
NEXT_BIN="$APP_DIR/node_modules/next/dist/bin/next"
CADDY_BIN="$(command -v caddy)"

SERVER_PLIST="$HOME/Library/LaunchAgents/$SERVER_LABEL.plist"
CADDY_PLIST="$HOME/Library/LaunchAgents/$CADDY_LABEL.plist"

[ -x "$NODE_BIN" ] || { echo "node not found on PATH"; exit 1; }
[ -f "$NEXT_BIN" ] || { echo "next not installed — run 'npm install' in $APP_DIR"; exit 1; }
[ -x "$CADDY_BIN" ] || { echo "caddy not found — run: brew install caddy"; exit 1; }

# Production build required.
if [ ! -d "$APP_DIR/.next" ]; then
  echo "No build found — running 'npm run build' first…"
  ( cd "$APP_DIR" && npm run build )
fi

# ── /etc/hosts entry ──────────────────────────────────────────────────────────
if ! grep -q "budgetr.localhost" /etc/hosts; then
  echo "Adding budgetr.localhost to /etc/hosts (requires sudo)…"
  echo "127.0.0.1  budgetr.localhost" | sudo tee -a /etc/hosts > /dev/null
  echo "Added."
fi

mkdir -p "$HOME/Library/LaunchAgents"

# ── Next.js server agent ──────────────────────────────────────────────────────
echo "Writing $SERVER_PLIST"
cat > "$SERVER_PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$SERVER_LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE_BIN</string>
    <string>$NEXT_BIN</string>
    <string>start</string>
    <string>--port</string>
    <string>$PORT</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$APP_DIR</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>$NODE_DIR:/usr/local/bin:/usr/bin:/bin</string>
    <key>NODE_ENV</key>
    <string>production</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>/tmp/budgetr-server.out.log</string>
  <key>StandardErrorPath</key>
  <string>/tmp/budgetr-server.err.log</string>
</dict>
</plist>
PLIST

# ── Caddy proxy agent ─────────────────────────────────────────────────────────
echo "Writing $CADDY_PLIST"
cat > "$CADDY_PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$CADDY_LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$CADDY_BIN</string>
    <string>run</string>
    <string>--config</string>
    <string>$CADDYFILE</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>/tmp/budgetr-caddy.out.log</string>
  <key>StandardErrorPath</key>
  <string>/tmp/budgetr-caddy.err.log</string>
</dict>
</plist>
PLIST

# ── Load both agents ──────────────────────────────────────────────────────────
launchctl unload "$SERVER_PLIST" 2>/dev/null || true
launchctl load -w "$SERVER_PLIST"
echo "Loaded $SERVER_LABEL (next start on :$PORT)"

launchctl unload "$CADDY_PLIST" 2>/dev/null || true
launchctl load -w "$CADDY_PLIST"
echo "Loaded $CADDY_LABEL (caddy proxy on :80 / :443)"

echo ""
echo "Trust Caddy's local CA so the browser accepts the certificate:"
echo "  sudo caddy trust"
echo ""
echo "Then open: http://budgetr.localhost"
