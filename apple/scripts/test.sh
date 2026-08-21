#!/usr/bin/env bash
#
# Run the domain test suite.
#
# The tests compile the pure domain sources directly rather than hosting the
# app: the app is sandboxed, and a sandboxed ad-hoc-signed host hangs before the
# XCTest runner can connect. Nothing under test needs an app to exist.
set -euo pipefail
cd "$(dirname "$0")/.."
xcodegen generate >/dev/null

xcodebuild \
  -project Budgetr.xcodeproj \
  -scheme Budgetr \
  -destination 'platform=macOS' \
  -derivedDataPath build \
  CODE_SIGN_STYLE=Manual \
  CODE_SIGN_IDENTITY="-" \
  DEVELOPMENT_TEAM="" \
  PROVISIONING_PROFILE_SPECIFIER="" \
  test 2>&1 | grep -E 'error:|Executed .* test|TEST (SUCCEEDED|FAILED)' | tail -5
