# Changelog

All notable changes to budgetr are recorded here. Versions map to the `v*` git
tags that publish the macOS desktop app via the Release workflow.

The format is loosely based on [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

## [0.11.0] — 2026-08-17

Two pieces of work and three fixes. Bill splitting finally does the thing it was
always supposed to do — photograph the receipt, tap who ate what — and the
Portfolio desk stops describing your holdings and starts answering the question
you opened it with. The receipt scanner is built entirely on-device, because
shipping one that uploaded your receipts would have quietly retired the promise
printed on every page of this app.

### Added

- **Split a bill by item, from a photograph.** A fourth mode on the bill
  splitter: scan the receipt, and each line is listed with a tap-target for
  whoever ate it. One gesture does the whole job — pick whose turn it is, then
  tap down the receipt — because people claim their own food, and hunting for
  one person's chip on every row is what a grid turns into with three people and
  ten lines. A shared plate is just everyone at weight 1, so there's no
  shared-vs-individual switch to explain; uneven portions ("I had two of the
  three buns") sit behind a per-line control.
- **Nothing is uploaded.** Recognition runs through Apple's Vision framework on
  this machine, via a small Swift helper compiled on first use — no model, no API
  key, no network call. Parsing is rule-based: two-column observations are
  grouped into visual rows by vertical overlap, quantities and per-unit prices
  are read off the line, and unpriced options are attached to the item above. A
  bracketed price is a modifier upcharge rather than a new line, which is the
  difference between a $77 subtotal and an $83 one. Where on-device recognition
  isn't available the editor falls back to typing the lines in.
- **Tax and tip follow the food.** They're never assignable, and they prorate by
  what each person actually ate — order the $48 ramen and you carry more of the
  tax than someone who shared the $13 plate. Every stage allocates whole cents by
  largest remainder, so three-way splits land on the total exactly rather than a
  penny off.
- **The receipt outranks a charge that hasn't caught up.** A $90.00 check
  authorised at $83.64 is a tip still settling, not a bad scan, so the split
  follows the paper and says why. The reverse — a receipt short of the charge —
  is a tip tapped on the terminal after printing, and folds into the tip field
  automatically. Whichever document was written last wins.
- **Disconnect a linked institution.** Connecting a bank was one click;
  disconnecting one was a SQL statement, which sits badly with an app whose whole
  argument is that the data is yours. Revokes at Plaid first — once the row is
  gone the access token is too, and the link would live on upstream, still
  billable — then deletes locally, and doesn't let a Plaid failure trap rows in
  the database. Type-to-confirm, with the reversible hide toggle offered
  alongside, since that's what most people reaching for it actually want.

### Changed

- **The Portfolio desk leads with how you're doing, not what you hold.** Market
  value rises whenever you deposit, so it can't answer the question; it drops to
  a tile. In its place: the time-weighted return against the benchmark, in
  percentage *points*, over the longest window with data. Every figure was
  already computed on each page load and rendered only as a buried table row.
- **The holdings table is grouped by what a row actually is** — funds, stocks,
  crypto, options, cash — each with a subtotal, weight and P&L. Sorting is on
  magnitude, so a short-dominant spread worth −$1,538 stops filing below $2.27 of
  dust; those rows now say `liability`. The sub-1% tail folds into one line with
  its subtotal, and three `CUR:USD` balances merge into the one cash row they
  always were.
- **The options desk moved to the options desk.** An expiration calendar, payoff
  cards, a Greeks table and full option chains were rendering inline for
  positions worth 0.1% of the portfolio, while `/investments/options` already
  showed the identical panel. What's left is a three-number summary that leads
  with the only urgent thing — legs expiring inside a week. The Portfolio page
  went from 1.61 MB and 1.55s to 1.01 MB and 0.22s, and stopped re-fetching a
  7.3 MB option chain on every single render.
- **One allocation panel instead of two that disagreed.** Asset class said cash
  11.3%, sector said 12.5%, both labelled with the same total and nothing on the
  page able to explain the difference. Asset class, sector and region are now
  tabs of one card.
- **Dividends count payers that pay.** Four of "28 payers" last paid in 2024 and
  showed `$0.00 ×0` — history, not income. They move behind a toggle, each payer
  carries a share bar, and the ex-dividend calendar renders only when there are
  dates. An empty state that appears on every load is a permanent fixture, not an
  empty state.
- **The mark on the web is the app's own.** The logo was a `₿` glyph, which reads
  as "Bitcoin app" and matched nothing you'd already seen — the Dock icon, the
  DMG, the favicon and the install prompt all show the italic serif `b.`

### Fixed

- **The live demo was returning 500 on every dashboard route.** Migration 0021
  added `recurring_streams.user_label`; the DDL bundled for the demo's in-memory
  database was never regenerated, so seeding threw during the instrumentation
  hook and took the server start down with it.
- **Never render a computed zero as a measurement.** Before quotes arrived, day
  change summed to a confident `+$0.00 · 0% of value has a live quote` —
  indistinguishable from a flat market. It now says it's still pricing. The
  no-cost-basis caveat, which silently qualifies two headline numbers, is stated
  outright rather than left in tile fine print.
- The Accounts page grouped by institution *name*, so two links to the same bank
  merged into one card — and, once disconnect existed, one delete button that
  couldn't say which connection it meant.

## [0.10.0] — 2026-08-15

The release is mostly about one thing: pages that say how much they know. The
arithmetic on these screens was never wrong, but a correct number presented
without its provenance is worse than an obvious error, because you act on it.
A stalled sync, a bank disconnected since June, a list capped at 500 of 817
entries — all of it rendered with total confidence. Every page now qualifies
its own figures. Alongside that, the two heaviest pages were measured and cut,
and the LEAPS desk lands as the release's one new tool.

### Added

- **LEAPS desk — one long-dated call against 100 shares.** A new tool on the
  Options desk that answers the stock-replacement question with arithmetic
  rather than vibes: what the contract costs against the shares, how much
  capital it frees, how much exposure it actually buys, and what the leverage
  costs per year. The comparison credits both sides properly — dividends to the
  shares, interest to the cash the call doesn't tie up — because omitting those
  is what makes LEAPS look worse than they are on a plain payoff chart.
- Two facts fall out of the maths and are stated outright rather than left for
  the reader to infer from a chart: above the strike both positions gain a
  dollar per dollar, so the call trails (or beats) the shares by a **fixed**
  amount however far the stock runs — there is no upside crossover, and
  leverage shows up in return on capital, not in dollars. And there is a price
  below which the call wins, because its loss stops at the premium while the
  shares keep falling.
- The strike ladder carries an **implied borrow rate** — the annualised cost of
  controlling the shares through the option, quoted against the capital freed —
  which is directly comparable to a margin rate. It's blank out of the money,
  where the call isn't standing in for the shares and the number would flatter
  a lottery ticket. A delta-weighted **cost per unit of exposure** ranks every
  strike on one scale instead.
- **Every page says how current its numbers are.** Three shared primitives —
  how old the ledger is, whether a reporting period can be honestly reported,
  and the three health detectors that actually fire (broken connection, stale
  sync, unreviewed backlog) — wired through Overview, Review, Budgets, Cashflow
  and Insights. Review falls back to the last complete month and says so;
  Budgets always fell back silently and now admits which month and why;
  Cashflow stamps the balance's age wherever it appears. The alerts are not
  dismissible, because permanently hiding "Chase is disconnected" would restore
  the exact silence they exist to break. A period is measured against its end
  **or today, whichever is sooner**, so an unfinished current month isn't
  mistaken for a gap.
- **Broken and stale bank connections are surfaced.** Chase had been in an
  error state for 47 days with its balance rendering exactly like six healthy
  institutions. A chip on each institution header, a banner for the worst
  problem, and the full list in Settings. Health keys off the last actual
  refresh rather than the last *attempt* — a failed sync still stamps the item,
  so a broken connection otherwise looks freshly synced. Known Plaid error
  codes get copy in the user's terms and say whether re-linking is really the
  remedy.
- **Transactions states its cap honestly and totals what's in view.** The
  header read "500 most recent entries", which parses as a total when it's a
  ceiling — there are 817. It now reads "817 entries · Mar 26 – Aug 12 ·
  showing 500 most recent", with out/in totals aggregated over every match
  rather than the capped slice. Transfers are split out rather than netted
  away, and those rows dim their amount: a $2,145 move between your own
  accounts had been rendering as the largest purchase on the page.
- **Categories ranks by spend and compares it to normal.** Each category's
  recent window sits beside its own trailing average, so a genuinely quiet
  quarter doesn't get flagged for an ordinary month. Dormant categories
  collapse into one expandable line instead of padding the list with dashes,
  and the headline names the most interesting mover — filtered to changes over
  15% on categories worth at least 5% of the total, so noise on a $2 category
  can't win the sentence.
- **Budgets shows the ratio.** "$1,037.73 of $300.00" makes the reader do the
  division; "346%" is the judgement itself. Unbudgeted chips now say "$8.00
  spent", since a bare amount reads equally as a budget or as a spend.
- **Recurring splits overdue from upcoming, normalises to monthly, and lets
  you name a stream.** Streams with a date in the past move to their own
  "Awaiting confirmation" section with a days-late chip — worded *unconfirmed*
  rather than *missed*, because Plaid predicts the date and a stale sync
  produces overdue rows that are entirely expected. Mixed frequencies normalise
  using 52/12 and 26/12 rather than 4 and 2, so a $20 weekly subscription is
  $86.67 a month rather than $80. Streams Plaid names no merchant for can be
  labelled by hand (migration 0021), and the label carries through to Cashflow
  and the Overview bills widget.
- **Vendors ranks merchants first and folds money movement into its own list.**
  The top three rows were card payments and brokerage transfers — bank plumbing
  ranked above every real merchant. Rows are now classified by where the
  majority of their spend sits, so a merchant with one stray transfer stays a
  merchant. The page leads with merchant spend and the most frequent merchant,
  since 151 Walmart visits is a more actionable fact than the $1,054 it adds
  up to.
- **A social-share card.** OpenGraph and Twitter `summary_large_image`
  metadata plus the 1200×630 card, so a shared budgetr.dev link renders richly.

### Changed

- **The vendor page no longer ships the vendor list once per row.** Every row
  rendered a merge button holding the entire rest of the vendor list — at 293
  vendors, 86,100 serialized candidates crossing the server/client boundary on
  every navigation, growing as N². The list crosses once through a context and
  the buttons read from there, with suggestions ranked lazily on dialog open.
  Payload 5,055 KB → 1,186 KB, render 0.45–0.62s → ~0.054s, growth O(N²) → O(N).
- **The IV snapshot table is bounded and the database maintains itself.**
  `option_iv_snapshots` had a read window but no delete — 208k rows, 29 MB of a
  31 MB database, only the last 30 days ever readable. Capture prunes past a
  35-day retention window (a 5-day margin so a timezone edge can't drop a day
  still on screen), throttled to once a day. Startup runs prune, WAL checkpoint,
  `PRAGMA optimize`, and vacuums only when the freelist is ≥20% of the file;
  every step is guarded, since maintenance failing is not a reason to refuse to
  boot.
- **The IV capture is off the response path.** Both desk routes wrote a
  few-thousand-row upsert synchronously during render, so every visit waited on
  a write it mostly didn't need. It now runs after the response is sent.
  /chain 1.99s → ~0.94–1.04s warm, /vol 1.39s → ~1.12–1.31s. The residual is
  the live chain fetch, not the write.
- **Price series are downsampled at the client boundary.** A full twelve months
  of daily history crossed to the client so a 60px sparkline could draw it,
  each close arriving as float32 widened to full double precision — fourteen
  characters of noise per point. Thinned to 130 points and rounded to cents,
  both endpoints always preserved. Valuation, the value curve and the TWR index
  still use the raw server-side series. Price points 5,726 → 2,730, 299 KB →
  113 KB (−62%), page weight −11%.

### Fixed

- **The LEAPS view is usable, and no longer quotes a crossover that isn't one.**
  AAPL lists 393 calls beyond a year and the first cut put every one in a pill
  picker *and* a table — a ~19,000px page fronted by 400 buttons. Now scoped
  the way the decision is made: pick an expiry, then a strike, defaulting to
  the ones behaving like the shares. 19,461px → 1,874px. Separately, when
  interest on the freed capital exceeds time value and dividends, the
  break-even root lands above the strike and the page printed a flat
  contradiction; that case is the call winning everywhere, and it now says so.
- **A mangled PEM signing key is repaired rather than fatal.** Env UIs collapse
  PEM line breaks, leaving the key on one line, which OpenSSL can't parse —
  license minting threw `DECODER routines::unsupported` after the signature
  check had already passed. The key is now un-escaped and re-wrapped from the
  base64 body between the markers.
- **The demo database is shared across module layers.** Next instantiates the
  module once per bundle layer, so an in-memory demo DB gave each layer its own
  empty copy: instrumentation seeded one while pages queried another. Any route
  reached by clicking rather than loading could come back blank until a manual
  refresh. Every layer now points at one temp file per process.

## [0.9.0] — 2026-08-01

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
- **The companion app can be explored without a Mac.** "Look around with sample
  data" on the pairing screen fills every screen and both widget families with a
  fabricated but contract-valid summary, so the app can be evaluated by someone
  who has nothing to pair with — an App Review tester, or you, before setting up
  a desktop. Nothing is persisted and nothing can reach the relay; a permanent
  brass ribbon marks the data as invented, and tapping it leaves.
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

[0.11.0]: https://github.com/kGeee/budgetr/releases/tag/v0.11.0
[0.10.0]: https://github.com/kGeee/budgetr/releases/tag/v0.10.0
[0.9.0]: https://github.com/kGeee/budgetr/releases/tag/v0.9.0
[0.8.0]: https://github.com/kGeee/budgetr/releases/tag/v0.8.0
[0.7.2]: https://github.com/kGeee/budgetr/releases/tag/v0.7.2
[0.7.1]: https://github.com/kGeee/budgetr/releases/tag/v0.7.1
[0.7.0]: https://github.com/kGeee/budgetr/releases/tag/v0.7.0
