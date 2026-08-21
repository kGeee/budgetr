#!/usr/bin/env bash
#
# Build (and optionally run) the macOS app without an Apple ID in Xcode.
#
# Automatic signing needs Xcode signed into a developer account, which a fresh
# machine — or a headless build — doesn't have. The entitlements here are only
# app-sandbox + network-client, both of which an ad-hoc signature supports, so
# local development doesn't need a real certificate at all.
#
#   scripts/build-mac.sh          build
#   scripts/build-mac.sh --run    build, then launch it
#
# Once Xcode has the account (and for anything involving CloudKit, which needs a
# paid team), plain `xcodebuild` with the project's Automatic signing is the
# right path and this script stops being necessary.
set -euo pipefail
cd "$(dirname "$0")/.."

command -v xcodegen >/dev/null || { echo "✗ xcodegen not installed — brew install xcodegen" >&2; exit 1; }
xcodegen generate >/dev/null

xcodebuild \
  -project Budgetr.xcodeproj \
  -scheme Budgetr \
  -destination 'platform=macOS' \
  -configuration Debug \
  -derivedDataPath build \
  CODE_SIGN_STYLE=Manual \
  CODE_SIGN_IDENTITY="-" \
  DEVELOPMENT_TEAM="" \
  PROVISIONING_PROFILE_SPECIFIER="" \
  "$@" 2>&1 | grep -E 'error:|warning: .*(deprecat|unused)|BUILD (SUCCEEDED|FAILED)' || true

APP="build/Build/Products/Debug/Budgetr.app"
[[ -d "$APP" ]] || { echo "✗ no app at $APP" >&2; exit 1; }
echo "✓ $APP"
