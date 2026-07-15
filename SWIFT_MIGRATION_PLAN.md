# budgetr → Native Swift (macOS + iOS) Migration Plan

**Status:** In progress, tracking parity against web/. See "Parity backlog" below for current phase status.
**Target:** Single SwiftUI codebase for macOS 14+ / iOS 17+, data synced via iCloud (Core Data + CloudKit).
**Source app:** Next.js 16 + TypeScript, SQLite (Drizzle, 37 tables as of 2026-07), Plaid + Finnhub + Yahoo Finance, single-user, no auth.

This is a **rewrite**, not a port — no TS/React code is reusable — but the design maps cleanly to native, and the single-user/local-first shape is ideal for it.

---

## Parity backlog (added 2026-07-09)

web/ grew substantially past the scope this plan originally described (37 DB tables vs. the 17 assumed below; options-trading analytics, tax lots, multi-currency, custom dashboards, FIRE calculator, and more were added after apple/ was scaffolded and then paused). This section tracks closing that gap, phased so each phase is independently buildable/verifiable via `xcodebuild`.

- [x] **Phase A — Core Data schema parity.** Model.xcdatamodeld now covers all 37 web tables (23 entities added: BudgetRollover, InvestmentTransaction, ManualHolding, InvestmentSector, AllocationTarget, InvestmentAssetClass, InvestmentGeography, HoldingCostBasisOverride, CostBasisMethod, TaxLotOverride, DismissedAlert, SavingsGoal, SavingsContribution, FireSettings, NetWorthMilestone, TransactionSplit, TransactionMatch, Attachment, SavedFilter, ExchangeRate, AppSetting, Dashboard, DashboardWidget). Also backfilled `CDAccount.excluded`, which was missing even for the original 15-table scope. Note: `CDTagRule` still lacks `matchType`/`minAmount`/`maxAmount`/`accountId`/`categoryId` from the current web schema — carried forward as a follow-up, not blocking.
- [x] **Phase B — Core CRUD screens parity.** Accounts, Categories, Vendors, Rules, Recurring, Settings — read-only MVP screens matching the existing Dashboard/Budgets/Transactions maturity level (list views, no add/edit forms yet). Wired into RootView navigation (sidebar now has 9 sections). Builds green on both macOS and iOS destinations.
- [ ] **Phase C — Business logic ports (low/med risk).** tag-rules engine, recurrence, currency/rates, allocation, benchmark, dividends, matching, anomalies, forecast — pure Swift ports of web/lib/*.ts.
- [ ] **Phase D — Investments subsystem.** portfolio-history.ts (high risk — forward-fill + price merge) and tax-lots.ts (FIFO/LIFO/specid), Investments + Realized Gains screens, holdings/manual holdings/investment transactions CRUD, cost basis overrides.
- [ ] **Phase E — Sync engine + Plaid/Finnhub/Yahoo.** Port lib/sync.ts cursor-based Plaid sync (dedup without DB unique constraints — CloudKit constraint from §3 below), Plaid LinkKit, Finnhub live quotes via WebSocket, Yahoo historical via ProxyClient.
- [ ] **Phase F — Remaining screens.** Dashboards (custom widget builder), Reports, FIRE, Goals, Insights, Review, Cashflow.
- [ ] **Phase G — Options trading subsystem (lowest priority, scope TBD).** options.ts/option-analytics.ts/greeks.ts/payoff.ts/cboe.ts — added to web after this plan was written; not obviously mobile-relevant. Confirm with user before investing time here.
- [ ] **Phase H — Polish.** Platform-specific layout, empty/error/offline states, background refresh, App Store/notarization prep.

---

## 1. Target architecture

```
┌─────────────────────────────────────────────┐
│  SwiftUI app (shared) — macOS + iOS          │
│                                              │
│  Views (SwiftUI)        Charts (Swift Charts)│
│  ViewModels (@Observable)                    │
│  Domain logic (pure Swift):                  │
│    BudgetPacing · AutoTagging · VendorGroup  │
│    PortfolioReconstruction                   │
│  Data: Core Data  ──(NSPersistentCloudKit)──┐│
│  Keychain (CryptoKit AES-GCM, key)          ││
└──────────────────────────────────────────┬──┘│
                                            │   │
              iCloud (private CloudKit DB) ←┘   │  ← per-user, free, Apple-managed
                                                │
                     ┌──────────────────────────┘
                     ▼  HTTPS (no secrets in app)
        ┌──────────────────────────────────┐
        │  Thin backend proxy (keep on      │
        │  Vercel/serverless)               │
        │   • holds PLAID_SECRET / keys     │
        │   • /plaid/exchange, /sync proxy  │
        │   • Finnhub/Yahoo passthrough     │
        └──────────────────────────────────┘
```

**Why a backend at all?** Plaid's `PLAID_SECRET` and Finnhub key cannot ship inside an app binary — they're trivially extractable. The proxy holds them and forwards requests. It can be a near-trivial reuse of your existing `api/plaid/*` and `api/prices` routes. Everything else (DB, sync state, logic, UI) moves into the app.

---

## 2. Stack decisions

| Concern | Choice | Notes |
|---|---|---|
| UI | SwiftUI | One codebase; `#if os(macOS)` for the few platform splits (sidebar, window sizing) |
| Charts | **Swift Charts** | Native replacement for Recharts; covers line/area/bar used in dashboard, budgets, investments |
| Persistence + sync | **Core Data + `NSPersistentCloudKitContainer`** | Row-level iCloud sync, private DB, free, no sync code to maintain |
| Networking | `URLSession` + async/await | Plaid/Yahoo/Finnhub REST |
| Live quotes | `URLSessionWebSocketTask` | Replaces Finnhub client WebSocket |
| Token encryption | **CryptoKit** AES-GCM, key in **Keychain** (iCloud Keychain synced) | Replaces `lib/crypto.ts` + env-var key |
| Plaid linking | **Plaid LinkKit** native iOS SDK | Better than the current web flow on mobile |

---

## 3. Data model mapping (the CloudKit constraints matter)

All 17 Drizzle tables → Core Data entities. **CloudKit imposes rules the current schema violates**, so the model must be adjusted:

- ❌ **No unique constraints** — CloudKit won't enforce them. Dedup (e.g. Plaid `transaction_id`, `transactionTags` M2M) must be handled in code with INSERT-OR-IGNORE-style upserts before save.
- ❌ **No non-optional attributes without defaults** — every attribute needs a default or must be optional.
- ❌ **All relationships must be optional and have an inverse** — your FK cascade deletes (`items→accounts→transactions`) become Core Data relationships with delete rules; verify cascade semantics survive.
- ⚠️ **No store-level encryption flag with CloudKit** — encrypted Plaid tokens stay app-managed (CryptoKit), not a DB feature.

Entity groups (unchanged from current schema):
- **Banking:** Item, Account, Transaction, BalanceSnapshot
- **Organization:** Category, Tag, TransactionTag (join), TagRule
- **Budgeting:** Budget, TagBudget, VendorGroup, VendorGroupMember
- **Investments:** Security, Holding, InvestmentTransaction, ManualHolding
- **Recurring:** RecurringStream

> Migration note: there's no automatic path from the existing `.db` into CloudKit. First launch imports the local `budgetr.db` (one-time read via GRDB or raw SQLite) → writes into Core Data → CloudKit propagates.

---

## 4. Logic port (pure Swift, no platform deps)

| Source | Target | Risk |
|---|---|---|
| `lib/queries.ts` | `@FetchRequest` / Core Data fetches + aggregation | Low |
| `lib/actions.ts` mutations | Repository methods on the managed context | Low |
| Budget pacing (`budgets/page.tsx:28-50`) | `BudgetPacing` struct (pure math) | Low |
| `lib/tag-rules.ts` auto-tagging | `NSPredicate`/Swift string match, idempotent upsert | Low |
| Vendor grouping + category fallback | Pure Swift | Low |
| `lib/sync.ts` cursor sync | `SyncEngine` actor; careful Core Data transactions + dedup | **Med** |
| `lib/portfolio-history.ts` | `PortfolioReconstruction` (forward-fill + price merge) | **Med-High** |

---

## 5. Phased plan

**Phase 0 — Decisions & scaffolding (2–3 days)**
- Confirm min OS targets, Apple Developer account + CloudKit container, bundle IDs.
- Stand up the backend proxy (reuse existing `api/plaid/*`, `api/prices`).
- Xcode project: shared SwiftUI target, macOS + iOS destinations.

**Phase 1 — Data foundation (3–5 days)**
- Author Core Data model (17 entities, CloudKit-compatible per §3).
- `NSPersistentCloudKitContainer` wired to private DB; verify two-device sync with dummy data.
- One-time importer from existing `budgetr.db`.

**Phase 2 — Read-only MVP (4–6 days)**
- Dashboard, Transactions, Categories, Budgets screens (read + categorize/budget mutations).
- Swift Charts for net worth / cashflow / category breakdown / budget pace.
- Validates the whole UI + sync + logic stack before touching external services.

**Phase 3 — Sync engine (5–8 days)**
- Port `lib/sync.ts`: cursor-based added/modified/removed, cascade handling, tag-rule application on sync.
- Keychain + CryptoKit token encryption.
- Plaid LinkKit flow → backend exchange → store encrypted token → first sync.

**Phase 4 — Investments & live data (5–8 days)**
- Holdings, manual holdings, investment ledger.
- Portfolio reconstruction port (highest-risk logic).
- Finnhub WebSocket live quotes; Yahoo historical via proxy.

**Phase 5 — Polish & platform fit (4–6 days)**
- macOS-specific layout (real sidebar, window behavior) vs iOS tab/navigation.
- Recurring, Rules, Vendors, Accounts screens.
- Empty/error/offline states, background refresh, App Store / notarization prep.

**Rough total:** ~2–3 weeks to MVP (through Phase 2), ~6–10 weeks to full parity (solo, Swift-fluent).

---

## 6. Top risks / watch-items

1. **CloudKit schema rules** (§3) — the single most likely source of churn; design the model for them up front rather than retrofitting.
2. **No secrets in the binary** — the backend proxy is non-negotiable for Plaid/Finnhub; don't try to embed keys.
3. **Sync correctness** — dedup without DB unique constraints; cursor state must live somewhere device-agnostic (sync it via CloudKit too, or keep sync server-side in the proxy).
4. **Portfolio reconstruction** — most complex logic; port with test fixtures captured from the current TS output to verify parity.
5. **iCloud, not iCloud Drive** — do **not** sync the live SQLite/WAL file via iCloud Documents (corruption). CloudKit row-sync is the supported path; a raw `.db` in iCloud Drive is only safe as a manual backup snapshot.

---

## 7. Open questions for next round
- Keep the backend proxy on Vercel, or move to a different host (Cloudflare Worker, etc.)?
- Is multi-device the goal, or is iCloud mainly for backup? (Affects how hard we lean on CloudKit live sync.)
- Ship both platforms day one, or iOS-first / macOS-first?
- App Store distribution, or personal/TestFlight-only? (Affects Plaid production approval needs.)
