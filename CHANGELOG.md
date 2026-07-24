# Changelog

All notable changes to budgetr are recorded here. Versions map to the `v*` git
tags that publish the macOS desktop app via the Release workflow.

The format is loosely based on [Keep a Changelog](https://keepachangelog.com/).

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

[0.7.0]: https://github.com/kGeee/budgetr/releases/tag/v0.7.0
