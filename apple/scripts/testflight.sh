#!/usr/bin/env bash
#
# Archive the iOS app and upload it to TestFlight.
#
# EAS builds the Expo companion (mobile/); this is the same job for the native
# Swift app, which EAS can't build. Same Apple team (B9UFFWUAD8), separate App
# Store Connect record.
#
#   scripts/testflight.sh              archive, sign, upload to App Store Connect
#   scripts/testflight.sh --no-upload  archive and export an .ipa to build/export
#
# Signing is Xcode's automatic signing. Two ways to authenticate it:
#   * On a Mac where Xcode is signed in to the team (Xcode > Settings >
#     Accounts), nothing else is needed.
#   * Headless (CI), set an App Store Connect API key — Users and Access >
#     Integrations > App Store Connect API, role Admin so Xcode may create the
#     distribution certificate and profile it needs:
#       ASC_KEY_ID      the key's ID
#       ASC_ISSUER_ID   the issuer ID shown above the keys table
#       ASC_KEY_PATH    path to the downloaded AuthKey_<ID>.p8
#
# Optional:
#   BUILD_NUMBER   defaults to a UTC stamp (yymmdd.HHMM), so every upload is
#                  unique and increasing — App Store Connect rejects a repeat
#   BUNDLE_ID      defaults to com.budgetr.app; must match the App Store
#                  Connect app record (create it once under Apps > +)
#   TEAM_ID        defaults to B9UFFWUAD8
set -euo pipefail
cd "$(dirname "$0")/.."

UPLOAD=1
[[ "${1:-}" == "--no-upload" ]] && UPLOAD=0

BUILD_NUMBER="${BUILD_NUMBER:-$(date -u +%y%m%d.%H%M)}"
BUNDLE_ID="${BUNDLE_ID:-com.budgetr.app}"
TEAM_ID="${TEAM_ID:-B9UFFWUAD8}"
ARCHIVE="build/Budgetr.xcarchive"
EXPORT_DIR="build/export"

command -v xcodegen >/dev/null || { echo "✗ xcodegen not installed — brew install xcodegen" >&2; exit 1; }
xcodegen generate >/dev/null

AUTH=()
if [[ -n "${ASC_KEY_ID:-}" ]]; then
  : "${ASC_ISSUER_ID:?ASC_ISSUER_ID is required with ASC_KEY_ID}"
  : "${ASC_KEY_PATH:?ASC_KEY_PATH is required with ASC_KEY_ID}"
  [[ -f "$ASC_KEY_PATH" ]] || { echo "✗ no API key at $ASC_KEY_PATH" >&2; exit 1; }
  AUTH=(-authenticationKeyPath "$ASC_KEY_PATH" -authenticationKeyID "$ASC_KEY_ID" -authenticationKeyIssuerID "$ASC_ISSUER_ID")
fi

rm -rf "$ARCHIVE" "$EXPORT_DIR"
mkdir -p build

echo "→ archiving $BUNDLE_ID $(sed -n 's/.*MARKETING_VERSION: "\(.*\)"/\1/p' project.yml) ($BUILD_NUMBER)"
xcodebuild \
  -project Budgetr.xcodeproj \
  -scheme Budgetr \
  -configuration Release \
  -destination 'generic/platform=iOS' \
  -archivePath "$ARCHIVE" \
  -allowProvisioningUpdates \
  ${AUTH[@]+"${AUTH[@]}"} \
  CURRENT_PROJECT_VERSION="$BUILD_NUMBER" \
  PRODUCT_BUNDLE_IDENTIFIER="$BUNDLE_ID" \
  DEVELOPMENT_TEAM="$TEAM_ID" \
  CODE_SIGN_STYLE=Automatic \
  archive | grep -E 'error:|warning: .*(deprecat|unused)|ARCHIVE (SUCCEEDED|FAILED)' || true

[[ -d "$ARCHIVE" ]] || { echo "✗ archive failed — rerun without the grep filter to see why" >&2; exit 1; }

# App Store Connect rejects a repeated build number, so refuse to upload one
# that didn't make it into the bundle.
STAMPED=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' "$ARCHIVE/Products/Applications/Budgetr.app/Info.plist")
[[ "$STAMPED" == "$BUILD_NUMBER" ]] || { echo "✗ archived CFBundleVersion is '$STAMPED', expected '$BUILD_NUMBER'" >&2; exit 1; }

# `app-store-connect` with destination `upload` makes -exportArchive sign for
# distribution and send the build straight to App Store Connect, where it
# appears in TestFlight once processing finishes (usually 5–15 minutes).
DESTINATION=upload
(( UPLOAD )) || DESTINATION=export
cat > build/ExportOptions.plist <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key><string>app-store-connect</string>
  <key>destination</key><string>$DESTINATION</string>
  <key>teamID</key><string>$TEAM_ID</string>
  <key>signingStyle</key><string>automatic</string>
  <key>uploadSymbols</key><true/>
  <key>manageAppVersionAndBuildNumber</key><false/>
  <key>testFlightInternalTestingOnly</key><false/>
</dict>
</plist>
PLIST

echo "→ exporting ($DESTINATION)"
xcodebuild \
  -exportArchive \
  -archivePath "$ARCHIVE" \
  -exportPath "$EXPORT_DIR" \
  -exportOptionsPlist build/ExportOptions.plist \
  -allowProvisioningUpdates \
  ${AUTH[@]+"${AUTH[@]}"}

if (( UPLOAD )); then
  echo "✓ uploaded build $BUILD_NUMBER — it shows in App Store Connect > TestFlight after processing"
else
  echo "✓ $(ls "$EXPORT_DIR"/*.ipa)"
fi
