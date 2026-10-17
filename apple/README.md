# Budgetr — Native (macOS + iOS)

SwiftUI app, one target for both platforms, backed by Core Data + CloudKit
(`NSPersistentCloudKitContainer`, private database) for multi-device iCloud sync.
This is the native client; the existing Next.js app under `../web` doubles as the
thin **backend proxy** that holds the Plaid / Finnhub secrets.

See `../SWIFT_MIGRATION_PLAN.md` for the full plan and rationale.

## Project generation

The Xcode project is generated from `project.yml` with [XcodeGen] (so the repo
doesn't carry a hand-merged `.pbxproj`):

```sh
brew install xcodegen        # once
cd apple && xcodegen generate
open Budgetr.xcodeproj
```

Regenerate any time `project.yml` or the file layout changes.

## What's in here (Phase 1 scaffold — builds today)

```
apple/
├── project.yml                         # XcodeGen spec (iOS 17 / macOS 14, one app target)
└── Budgetr/
    ├── BudgetrApp.swift                # @main, injects the managed object context
    ├── Persistence/
    │   ├── PersistenceController.swift # NSPersistentCloudKitContainer (private DB)
    │   └── Model.xcdatamodeld          # 14 CloudKit-safe entities (mirrors web/db/schema.ts)
    ├── Domain/                         # pure logic ports (unit-testable, no UI/CoreData)
    │   ├── BudgetPacing.swift          #   ← web/app/budgets/page.tsx
    │   ├── AutoTagging.swift           #   ← web/lib/tag-rules.ts
    │   ├── CategoryMapping.swift       #   ← category override + transfer filtering
    │   └── VendorGrouping.swift        #   ← web/lib/actions.ts vendor merge
    ├── Services/
    │   ├── ProxyClient.swift           # calls the Next.js secret proxy
    │   ├── KeychainStore.swift         # iCloud-Keychain-synced key storage
    │   └── AppCrypto.swift             # AES-256-GCM (← web/lib/crypto.ts)
    └── Features/
        ├── RootView.swift              # adaptive NavigationSplitView
        ├── DashboardView.swift         # Phase 2 placeholder
        ├── TransactionsView.swift      # @FetchRequest list
        └── BudgetsView.swift           # @FetchRequest list + pace math
```

Build from the command line (compile check, no signing):

```sh
xcodebuild -project Budgetr.xcodeproj -scheme Budgetr \
  -destination 'platform=macOS' CODE_SIGNING_ALLOWED=NO build
```

Both `platform=macOS` and `generic/platform=iOS Simulator` build green.

## Ship it to TestFlight

EAS builds the Expo companion (`mobile/`); it can't build this target. The
native app ships with Xcode's own tooling instead, under the same Apple team:

1. **Once:** create the App Store Connect record — Apps → **+** → New App,
   platform iOS, bundle ID `com.budgetr.app` (register it under Certificates,
   Identifiers & Profiles first if it isn't listed). If that ID is taken, pick
   another and pass it as `BUNDLE_ID`.
2. **Upload** — either:
   - from a Mac with Xcode signed in to the team:
     `scripts/testflight.sh` (or `--no-upload` for just an `.ipa`), or
   - from GitHub: Actions → **TestFlight** → Run workflow (or push a tag
     `ios-v1.0.0`). Needs the `ASC_KEY_ID`, `ASC_ISSUER_ID` and `ASC_KEY_P8`
     repository secrets — an App Store Connect API key with the Admin role;
     see the top of `.github/workflows/testflight.yml`.
3. The build appears under TestFlight after processing (5–15 min). Add
   yourself to an internal testing group and install from the TestFlight app.

Build numbers are a UTC stamp (`yymmdd.HHMM`), so uploads from a desk and from
CI share one increasing sequence. Export compliance is pre-answered in
`Budgetr/Support/Info.plist` (the only crypto is exempt), so uploads don't stop
to ask. The `Apple` workflow builds both platforms and runs the domain tests on
every push that touches `apple/`.

On a fresh install with no ledger, the Spending screen offers **Explore with
sample data** — a believable ~90-day ledger, clearly ribboned, removed in one
tap — so a tester can judge every screen before AirDropping `budgetr.db`.

## Pair with your Mac (companion mode)

On iPhone the app opens on **Pair your Mac**: in budgetr on the Mac, Settings →
Phone companion → Pair phone, then scan the code (or paste it). From then on
the phone shows the summary the Mac publishes — Spending, Activity, Budgets and
Holdings — refreshed on launch, on foreground and on pull. It can pair
alongside the Expo companion; both read the same channel.

This build is **read-only**: it never writes to the relay, so recategorising,
dismissing alerts, splitting bills and receipt scans stay on the Mac (or the
Expo app) for now.

- `Sync/SecretBox.swift` — NaCl secretbox (XSalsa20-Poly1305) in pure Swift,
  tested byte-for-byte against `packages/sync-crypto/test/vectors.json`.
- `Sync/Pairing.swift` — the `budgetr1.` code; the key goes to this device's
  Keychain only (not iCloud Keychain).
- `Sync/SummaryContract.swift` — the Summary v2 contract; a newer format reads
  as "update the app", never as corrupt data.
- `Sync/CompanionModel.swift` — the month-to-date re-slicing from
  `mobile/src/spending.ts`; the phone computes nothing financial.
- `Sync/CompanionStore.swift` — pairing, the relay GET with ETag, and a
  file-protected cache so the app opens on numbers.

Importing a `budgetr.db` and the sample ledger are still there, under the
pairing screen and in More.

## Design system

`Budgetr/UI/` is the companion's design system (`mobile/src/ui/*`) in SwiftUI,
so the three apps read as one product:

- `Components.swift` — gradient `Card`s with a lit edge and soft drop, the
  brass `Eyebrow`, `StatTile` wells, the pill `Segmented` control, the striped
  allowance `StripedMeter`, `AnimatedMoney` (digits roll to a new value), the
  `PressScale` button style, the aurora backdrop, and category glyphs.
- `Charts.swift` — scrubbable daily bars with haptic detents, the cumulative
  pace line that draws itself in, the selectable mix donut, mini bars.
- `Screen.swift` — `BScreen`: the Fraunces page head, a compact material header
  that appears only once content scrolls under it, aurora parallax, and the
  shared sheet chrome.
- `FloatingTabBar.swift` — the phone's floating pill tab bar.

Tokens live in `Support/Theme.swift` (colours, faces, springs); haptics in
`Support/Haptics.swift`. Everything respects Reduce Motion and Dynamic Type.

## Phase 0 — you must do these in Xcode (need an Apple Developer account)

These can't be scripted; they require your signing identity and the CloudKit dashboard:

1. **Signing**: open the project, select the `Budgetr` target → Signing & Capabilities
   → pick your Team. (Or set `DEVELOPMENT_TEAM` in `project.yml` and regenerate.)
2. **iCloud capability**: add the **iCloud** capability with **CloudKit** checked, and a
   container named **`iCloud.com.budgetr.app`** (must match `PersistenceController` and
   `Budgetr.entitlements`). Also add the **Background Modes → Remote notifications** capability.
3. **Push the CloudKit schema**: run once on a signed-in device/simulator with
   `try? container.initializeCloudKitSchema(options: [])` temporarily uncommented in
   `PersistenceController.init` (DEBUG block), then re-comment. This creates the record
   types in the CloudKit **development** environment. Promote to production in the
   CloudKit Dashboard before shipping.

## Phase 1 remaining

- One-time importer: read the existing `../web/data/budgetr.db` (raw SQLite) and upsert
  into Core Data on first launch. Dedup on the business `id` attribute (CloudKit has no
  unique constraints — see the model notes).
- Verify two-device sync with seeded data before building features.

## Notes on the CloudKit-shaped data model

`Model.xcdatamodeld` deliberately differs from `web/db/schema.ts`:

- No uniqueness constraints (CloudKit forbids them) — dedup happens in code on `id`.
- Every attribute is optional or has a default value.
- Every relationship is optional with an inverse; FK cascades become Core Data delete rules.
- The `transaction_tags` join collapses into a native many-to-many
  (`CDTransaction.tags` ↔ `CDTag.transactions`).

[XcodeGen]: https://github.com/yonaskolb/XcodeGen
