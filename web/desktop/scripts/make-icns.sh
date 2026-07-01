#!/usr/bin/env bash
# Generate desktop/build/icon.icns from the existing 512px PWA icon.
# macOS only — uses the built-in `sips` and `iconutil` tools.
set -euo pipefail

cd "$(dirname "$0")/../.."

SRC="public/icons/icon-512.png"
OUT_DIR="desktop/build"
OUT="$OUT_DIR/icon.icns"

if [[ ! -f "$SRC" ]]; then
  echo "make-icns: source icon not found at $SRC" >&2
  exit 1
fi

mkdir -p "$OUT_DIR"
ICONSET="$(mktemp -d)/icon.iconset"
mkdir -p "$ICONSET"

# Apple's required iconset members. The 1024px @2x is upscaled from 512 — slight
# softening, but fine for a build-your-own desktop icon.
sips -z 16 16     "$SRC" --out "$ICONSET/icon_16x16.png"      >/dev/null
sips -z 32 32     "$SRC" --out "$ICONSET/icon_16x16@2x.png"   >/dev/null
sips -z 32 32     "$SRC" --out "$ICONSET/icon_32x32.png"      >/dev/null
sips -z 64 64     "$SRC" --out "$ICONSET/icon_32x32@2x.png"   >/dev/null
sips -z 128 128   "$SRC" --out "$ICONSET/icon_128x128.png"    >/dev/null
sips -z 256 256   "$SRC" --out "$ICONSET/icon_128x128@2x.png" >/dev/null
sips -z 256 256   "$SRC" --out "$ICONSET/icon_256x256.png"    >/dev/null
sips -z 512 512   "$SRC" --out "$ICONSET/icon_256x256@2x.png" >/dev/null
sips -z 512 512   "$SRC" --out "$ICONSET/icon_512x512.png"    >/dev/null
sips -z 1024 1024 "$SRC" --out "$ICONSET/icon_512x512@2x.png" >/dev/null

iconutil -c icns "$ICONSET" -o "$OUT"
echo "make-icns: wrote $OUT"
