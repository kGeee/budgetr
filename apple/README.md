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
