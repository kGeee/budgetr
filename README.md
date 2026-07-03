# budgetr

A personal finance app, in two forms that share one data model:

| Path     | App                          | Stack                                                                 |
| -------- | ---------------------------- | --------------------------------------------------------------------- |
| `web/`   | Next.js web app (original)   | Next.js 16, TypeScript, SQLite (Drizzle), Plaid + Finnhub + Yahoo      |
| `apple/` | Native macOS + iOS app       | SwiftUI, Core Data + CloudKit (private-database iCloud sync)           |

## Quick start

**Web**

```bash
cd web
npm install
npm run setup   # .env.local + encryption key + migrate + seed (idempotent)
npm run dev     # http://localhost:3000  (Plaid sandbox: user_good / pass_good)
```

See [`web/README.md`](web/README.md) for env vars, database commands, testing, and Plaid setup.

**Apple**

```bash
cd apple
brew install xcodegen   # once
xcodegen generate
open Budgetr.xcodeproj
```

See [`apple/README.md`](apple/README.md) for signing, the iCloud container, and the SQLite → Core Data importer. The overall migration plan lives in [`SWIFT_MIGRATION_PLAN.md`](SWIFT_MIGRATION_PLAN.md).

## Architecture

The Next.js app stays as the source of truth for business logic and as a thin backend proxy holding the Plaid/Finnhub secrets (these can't ship inside an app binary). The Apple app syncs across devices via Core Data + `NSPersistentCloudKitContainer` against the user's private CloudKit database.
