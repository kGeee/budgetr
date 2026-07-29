# Changelog

All notable changes to budgetr are recorded here. Versions map to the `v*` git
tags that publish the macOS desktop app via the Release workflow.

The format is loosely based on [Keep a Changelog](https://keepachangelog.com/).

## [0.9.0] — 2026-07-28

### Added

- **The options module builds strategies like OptionStrat.** One-click templates
  — long call/put, vertical debit/credit spreads, straddle, strangle, iron
  condor, iron butterfly, call butterfly — pick their strikes off the live chain
  relative to spot, and a structure with no room for its wings is disabled in
  the picker rather than offered and then failing. The payoff diagram overlays a
  dashed "value now" curve over the solid expiry line, Black-Scholes-priced at
  any date with a slider to scrub from today to expiry, and a price × date P/L
  heatmap colours jade→coral with spot and breakeven marked. Net Γ joins the
  position greeks. The engine is pure and unit-tested against put-call parity,
  and every analytic runs through the shared safety panel, so the ranked
  suggestions get the same treatment as a hand-built position.
- **Readouts follow the cursor.** Hovering the payoff diagram raises a crosshair
  with the underlying price, P&L at expiry and — when the curve is shown — P&L
  at today's value. The heatmap highlights the cell under the cursor and prints
  its exact price · date · P&L above the grid, switchable between P/L in dollars
  and P/L as a percentage of capital. The grid itself is behind a toggle so the
  safety panel stays compact.
- **Dashboard widgets have range and order controls.** Widgets already stored a
  config that nothing could change, so the defaults were effectively hardcoded.
  Cashflow now takes 3/6/12/24 months; spend-by-category and top-vendors take
  7d/30d/90d/1y, with ordering by amount, count or name, and top-vendors also
  takes 5/8/12 rows. The pills sit in read mode rather than behind the Edit
  toggle — changing a window is exploring your data, not rearranging your board
  — and each choice persists per widget, merged over the stored config so one
  control can't clobber another's key.
- Marketing has a video series bible and four scripts (flagship long-form, two
  shorts, and a download-to-first-dashboard walkthrough), written against the
  existing onboarding copy so the video and the product can't disagree.

### Changed

- **One brand mark everywhere.** The marks had drifted: the browser tab on the
  marketing site still showed the stock Next triangle, mobile shipped a green
  line-chart glyph, and the Android adaptive layers were untouched scaffold art.
  A single script now derives every icon from the canonical serif "b." —
  flattening alpha for iOS, which rejects it, and insetting the bare glyph for
  Android, which composites foreground over background before masking.
- **The sync banner only speaks when spoken to.** It announced "synced Xm ago"
  permanently, including after background syncs nobody asked for. The
  confirmation now shows for four seconds after a pull-to-refresh or an explicit
  Sync now. Errors, stale data and queued edits still show unconditionally —
  those are states you need, not confirmations.
- Ordering on a widget re-sorts the rows the query already returned rather than
  pushing the sort into SQL: the query picks the top N by amount, and re-sorting
  that slice is what the control means. Sorting inside the query would silently
  swap which rows appear.
- The volatility surface drew its axis labels in a hardcoded system mono — the
  one chart not set in Spline Sans Mono. It now resolves the font off the
  element, rejecting an unresolved var, since an invalid canvas font assignment
  keeps the previous font instead of erroring.
- Widget category bars drop the overspend dot; the amount beside the row already
  answers the question.
- README no longer documents the unverified-developer `xattr` workaround — the
  DMG has been signed and notarized since v0.8.0 and opens on a double-click.

### Fixed

- **Every new install's Insights page was empty.** Seeded `recurring_streams`
  rows were written with their average and latest amounts set to the same
  hardcoded value, and the price-creep detector fires on `last >= avg * 1.15` —
  so with the two always equal it was structurally unable to fire. Streams are
  now derived from the charges actually written, so a subscription raised
  partway through the window carries a genuine gap and the two can't drift apart
  again. Real syncs were never affected.
- **Demo history was too short for the views that read a year.** Transactions
  spanned 90 days and balance snapshots 180, so Review's this-year/last-year
  tabs, the trailing-year spend heatmap and the 12-month category charts all
  rendered against a quarter of a year. One knob now covers 400 days, with
  discretionary spend drifting across the window so the year-scale charts have a
  trend to show.

## [0.8.0] — 2026-07-27

### Added

- **Spending is the companion app's first screen.** Replaces Overview with a
  single-screen, no-scroll view of where the month went: a month-to-date hero
  with a like-for-like comparison against the same span of last month, one chart
  slot that switches between daily bars / cumulative-vs-pace / a category donut,
  and a grid of category tiles you tap into for that category's budget, day-by-day
  chart and transactions. Net worth, accounts and alerts moved behind the wallet
  chip; Settings stays behind the gear.
- **Five new Home and Lock Screen widgets**, joining net worth and budget pace:
  ranked top categories (small + medium), a category-mix donut (medium), this
  week's spending against last week (small), a month-at-a-glance large widget
  combining hero, pace and categories, and a Lock Screen pair — a budget-used
  ring (circular) and left-to-spend (rectangular).
- The widget payload now carries per-category month totals, a 7-day series and
  the prior-month comparison. It derives them with the same helpers the Spending
  screen uses, so a widget can't disagree with the app beside it. Every new field
  is optional, so an older app build shows an empty state rather than a zero.

### Changed

- **Budget pace widget is full-bleed.** The chart now runs corner to corner with
  the readout overlaid inside it, and its x-axis spans the days elapsed rather
  than the whole month, so the spend line reaches the trailing edge instead of
  stopping partway across.
- Companion app version is now 1.1.0. Its `runtimeVersion` follows `appVersion`,
  so this bump keeps OTA JS updates off binaries built before the widget
  extension existed.

### Fixed

- **Widgets never worked in any build.** The `ExtensionStorage` native module
  that writes the App Group payload declares `ios 16.4`, but the app's
  deployment target was Expo's default 15.1 — and Expo's autolinking *silently
  skips* a pod whose platform the target doesn't support. Every build shipped the
  widget extension with no way for the app to feed it, and the app could only
  report "unavailable in this build". Added `expo-build-properties` with
  `ios.deploymentTarget: 16.4`; verified `pod install` now installs
  `ExtensionStorage` and links it into the app target.
- **Wheel calculator mis-grouped same-direction option legs.** Two or more legs
  sharing an expiry and right that all point the same way (e.g. two cash-secured
  puts at different strikes) were folded into a generic "combo", which hid them
  from every per-leg risk consumer — wheel collateral and uncovered-call counts
  zeroed out. Only a group holding both a long and a short is a combined
  structure now; a same-direction group emits each leg as its own single.

## [0.7.2] — 2026-07-24

### Fixed

- **Onboarding keys flow could crash.** The keys form and the demo-teardown step
  awaited Server Actions with no error handling, so a thrown action (e.g. a
  failed encrypt/DB write, a dropped connection) took down the whole flow. The
  actions now return errors instead of throwing, and the form/modal surface them
  inline and keep working.
- **Overview layout was wiped on the demo→real switch.** Clearing the demo data
  (`wipeFinancialData`) deleted every dashboard, including the reserved Overview
  board — throwing away a customized landing layout. The reserved Overview board
  and its widgets are now preserved; only custom dashboards are cleared.

## [0.7.1] — 2026-07-24

### Fixed

- **First-run crash on the desktop app** — demo seeding could throw a UNIQUE
  constraint on `balance_snapshots` (and take down the whole app with "a server
  error occurred") whenever the seeded date window spanned a daylight-saving
  spring-forward. The demo date helper now does its day math in UTC to match its
  UTC formatting, so two adjacent days can no longer collapse onto one date.

## [0.7.0] — 2026-07-24

### Added

- **Customizable Overview** — the landing screen is now the same editable,
  drag-to-reorder widget grid as a custom dashboard. Choose what you see and how
  it's arranged. Reserved, undeletable "Overview" board seeded on first run.
- **Overview widgets** — net-worth hero, spending review (this month vs last with
  the biggest movers, folding in the standalone Review), review queue, recent
  activity, and upcoming bills, alongside the existing chart widgets.
- **Free trial + licensing** — a 14-day free trial, then an offline
  Ed25519-signed license key verified locally (no phone-home). Enforced across the
  self-hosted web app and the desktop app by one shared guard, with an in-app
  activation panel in Settings. Self-hosters can opt out with
  `BUDGETR_LICENSE_DISABLED=1`.
- **Investments tab bar** — Portfolio and Analysis now share a segmented control,
  so Analysis reads as part of the Investments group.

### Changed

- **Benchmark comparison is now time-weighted** — the portfolio-vs-SPY/QQQ figure
  backs out deposits/withdrawals, so adding cash no longer inflates measured
  return. The standalone market-value line is unchanged.
- Sidebar highlights the single most-specific route, so exactly one nav item is
  active (fixes Analysis/Investments both lighting up).
- Various mobile companion UI updates.

### Fixed

- **Demo data no longer needs a refresh** — the example dataset seeds at server
  cold start (in `instrumentation.register()`) instead of racing parallel page
  renders, so pages no longer render blank on first load.

[0.9.0]: https://github.com/kGeee/budgetr/releases/tag/v0.9.0
[0.8.0]: https://github.com/kGeee/budgetr/releases/tag/v0.8.0
[0.7.2]: https://github.com/kGeee/budgetr/releases/tag/v0.7.2
[0.7.1]: https://github.com/kGeee/budgetr/releases/tag/v0.7.1
[0.7.0]: https://github.com/kGeee/budgetr/releases/tag/v0.7.0
