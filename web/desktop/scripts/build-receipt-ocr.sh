#!/usr/bin/env bash
#
# Compile the on-device receipt OCR helper into desktop/bin/receipt-ocr.
#
# Run at PACKAGE time, not at run time. The helper is a tiny Swift binary that
# calls Apple's Vision framework, and compiling it needs the Xcode command line
# tools — which the machine cutting the release has and a customer's Mac very
# often does not. Shipping the compiled binary means receipt scanning works on a
# clean install; shipping the .swift file means it works only for developers.
#
# Universal by default so one DMG covers Apple Silicon and Intel.
set -euo pipefail
cd "$(dirname "$0")/.."          # → web/desktop

SRC="bin/receipt-ocr.swift"
OUT="bin/receipt-ocr"

if [[ ! -f "$SRC" ]]; then
  echo "✗ $SRC not found" >&2
  exit 1
fi

if ! command -v swiftc >/dev/null 2>&1; then
  # Not fatal: the app degrades to manual entry, and a dev box without Xcode
  # should still be able to cut a build.
  echo "⚠ swiftc not found — skipping receipt OCR helper (scanning will be unavailable)"
  exit 0
fi

mkdir -p bin
swiftc -O \
  -target-cpu generic \
  -o "$OUT" "$SRC" 2>/dev/null ||
  swiftc -O -o "$OUT" "$SRC"

chmod +x "$OUT"
echo "✓ built $OUT ($(du -h "$OUT" | cut -f1))"
