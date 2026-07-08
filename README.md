# budgetr

A personal finance app, in two forms that share one data model:

| Path     | App                          | Stack                                                                 |
| -------- | ---------------------------- | --------------------------------------------------------------------- |
| `web/`   | Next.js web app (original)   | Next.js 16, TypeScript, SQLite (Drizzle), Plaid + Finnhub + Yahoo      |
| `apple/` | Native macOS + iOS app       | SwiftUI, Core Data + CloudKit (private-database iCloud sync)           |

## Get it running

You don't need to be a programmer. Pick the option that fits you:

**Option 1 — download the app (macOS, easiest).**
Grab `budgetr-mac.dmg` from the [latest release](../../releases/latest), drag
budgetr into Applications, and open it. First launch only: right-click → Open
(the build is unsigned), or approve it under System Settings → Privacy &
Security → *Open Anyway*. To link real banks, open **Settings → Open Settings
File** inside the app (or press `⌘,`), paste in your Plaid keys, and relaunch —
see [Settings & where your data lives](#settings--where-your-data-lives).

**Option 2 — run from source with one double-click (macOS / Linux).**
[Download this repo](../../archive/refs/heads/main.zip) (or `git clone` it),
then double-click **`Start budgetr.command`** (macOS) or run `./start.sh`
(Linux). The launcher takes care of everything — it even downloads its own
private copy of Node.js if your machine doesn't have one — then opens
budgetr in your browser. Nothing is installed system-wide; delete the folder
and it's gone.

**Option 3 — Windows.** Install [Node.js LTS](https://nodejs.org), then
double-click **`start.bat`**.

**Option 4 — Docker / homelab.** See [`web/README.md`](web/README.md#docker-self-hosting).

**Option 5 — developers.**

```bash
cd web
npm install
npm run setup   # .env.local + encryption key + migrate + seed (idempotent)
npm run dev     # http://localhost:3000  (Plaid sandbox: user_good / pass_good)
```

Out of the box budgetr runs against Plaid **Sandbox** — connect a fake bank
with the test login `user_good` / `pass_good` and explore. Your data never
leaves your machine: it lives in a local SQLite file, and the only outbound
calls are to the data providers (Plaid/Finnhub/Yahoo) you configure.

See [`web/README.md`](web/README.md) for env vars, database commands, testing, and Plaid setup.

## Settings & where your data lives

Everything is stored locally; the only "configuration" is a small text file of
API keys. Where it is depends on how you run budgetr:

| How you run it | Settings file (API keys) | Your data (SQLite) |
| --- | --- | --- |
| **Desktop app (DMG)** | `~/Library/Application Support/budgetr/budgetr.env` — or just use **Settings → Open Settings File** (`⌘,`) in the app | same folder (`budgetr.db`); **Settings → Show Data Folder** |
| **From source** (`Start budgetr.command`, `start.sh`, `start.bat`, `npm run dev`) | `web/.env.local` (created for you on first run) | `web/data/budgetr.db` |
| **Docker** | `web/.env.local`, passed in via `env_file` | the `budgetr-data` volume |

The settings file is plain text with comments explaining each key — open it,
paste in your [Plaid keys](https://dashboard.plaid.com/developers/keys) (and
optionally a [Finnhub key](https://finnhub.io) for live prices), then restart
budgetr (desktop app: **Settings → Relaunch to Apply Settings**). The
`APP_ENCRYPTION_KEY` in that file encrypts your bank tokens at rest — it's
generated for you; don't change it once accounts are linked. Without any keys,
budgetr still runs in Plaid Sandbox mode with fake data.

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
