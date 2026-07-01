#!/usr/bin/env bash
#
# Stop and remove the budgetr LaunchAgents (server + Caddy proxy).
#
set -euo pipefail

SERVER_PLIST="$HOME/Library/LaunchAgents/dev.budgetr.server.plist"
CADDY_PLIST="$HOME/Library/LaunchAgents/dev.budgetr.caddy.plist"

launchctl unload "$SERVER_PLIST" 2>/dev/null || true
launchctl unload "$CADDY_PLIST" 2>/dev/null || true
rm -f "$SERVER_PLIST" "$CADDY_PLIST"

echo "Removed budgetr agents. The server and proxy will no longer start at login."
echo ""
echo "To also remove the /etc/hosts entry:"
echo "  sudo sed -i '' '/budgetr.localhost/d' /etc/hosts"
