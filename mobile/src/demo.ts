// A self-contained Summary that never came from a Mac.
//
// The app is useless before pairing — it opens on the pairing screen and shows
// nothing until it has scanned a code off a desktop running budgetr. That's
// correct for a user and fatal for a reviewer: an App Review tester has no such
// Mac, so an External TestFlight submission would be evaluated against a screen
// with one camera viewfinder on it. This module is the way past that, and
// doubles as the thing to open when you want to see a screen without waiting on
// a sync.
//
// Everything here is fabricated. It is shaped to be *plausible*, not to be
// anyone's data: the numbers are drawn from a fixed seed so two launches
// produce identical figures (screenshots stay reproducible), and every date is
// relative to now so the month never reads as stale.
//
// Contract rules this file must respect, same as any real summary (see
// packages/core/src/contracts.ts):
//   · money is integer cents, always — no float reaches a contract field
//   · timestamps are unix SECONDS, UTC
//   · the MAX_* bounds are real; a validator rejects payloads that exceed them
//   · category keys are shared across categories / budgets / recent

import {
  MAX_RECENT_TXNS,
  SUMMARY_VERSION,
  type AccountSummary,
  type AlertSummary,
  type BudgetSummary,
  type CategoryInfo,
  type PositionSummary,
  type SparkPoint,
  type Summary,
  type TxnSummary,
} from "@budgetr/core";

const DAY = 86_400;

/** mulberry32 — tiny seeded PRNG. Fixed seed ⇒ identical demo every launch. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** Midnight UTC today, in unix seconds. All demo dates hang off this. */
function today(): number {
  return Math.floor(Date.now() / 1000 / DAY) * DAY;
}

const CATEGORIES: CategoryInfo[] = [
  { id: "groceries", name: "Groceries", icon: "🛒", group: "spending" },
  { id: "dining", name: "Dining", icon: "🍜", group: "spending" },
  { id: "transport", name: "Transport", icon: "🚇", group: "spending" },
  { id: "shopping", name: "Shopping", icon: "🛍️", group: "spending" },
  { id: "utilities", name: "Utilities", icon: "💡", group: "spending" },
  { id: "subscriptions", name: "Subscriptions", icon: "📺", group: "spending" },
  { id: "health", name: "Health", icon: "🩺", group: "spending" },
  { id: "home", name: "Home", icon: "🏠", group: "spending" },
  { id: "salary", name: "Salary", icon: "💼", group: "income" },
  { id: "transfer", name: "Transfer", icon: "↔️", group: "transfer" },
];

/** Merchants per category, so a transaction list reads like a real one. */
const MERCHANTS: Record<string, string[]> = {
  groceries: ["Whole Foods", "Trader Joe's", "Safeway", "H Mart"],
  dining: ["Tartine", "Zuni Café", "Blue Bottle", "Nopalito", "Sightglass"],
  transport: ["BART", "Chevron", "Lyft", "Muni"],
  shopping: ["Uniqlo", "Amazon", "Muji", "Apple Store"],
  utilities: ["PG&E", "Comcast", "AT&T"],
  subscriptions: ["Netflix", "Spotify", "iCloud+", "NYT"],
  health: ["Walgreens", "One Medical", "CVS Pharmacy"],
  home: ["IKEA", "Cole Hardware"],
};

/** Typical spend per category, in cents — [min, max]. */
const TYPICAL: Record<string, [number, number]> = {
  groceries: [2_200, 14_800],
  dining: [1_400, 9_600],
  transport: [420, 6_400],
  shopping: [2_800, 22_000],
  utilities: [4_100, 18_500],
  subscriptions: [999, 2_299],
  health: [1_100, 12_000],
  home: [1_900, 16_400],
};

function buildRecent(r: () => number, t0: number): TxnSummary[] {
  const keys = Object.keys(TYPICAL);
  const out: TxnSummary[] = [];
  for (let i = 0; i < MAX_RECENT_TXNS; i++) {
    // Spread across the last ~24 days, most-recent first, a few per day.
    const dayBack = Math.floor(i * 0.6);
    const key = keys[Math.floor(r() * keys.length)];
    const [lo, hi] = TYPICAL[key];
    const merchants = MERCHANTS[key];
    out.push({
      id: `demo-txn-${i}`,
      ts: t0 - dayBack * DAY - Math.floor(r() * DAY),
      merchant: merchants[Math.floor(r() * merchants.length)],
      cents: -(lo + Math.floor(r() * (hi - lo))),
      category: key,
      pending: i < 2,
    });
  }
  // One paycheck, so income isn't invisible in the ledger.
  out.splice(6, 0, {
    id: "demo-txn-salary",
    ts: t0 - 4 * DAY,
    merchant: "Acme Corp",
    cents: 612_400,
    category: "salary",
    pending: false,
  });
  return out.slice(0, MAX_RECENT_TXNS).sort((a, b) => b.ts - a.ts);
}

// Target utilisation per category — the mix of states the demo should *show*.
// One over, one at the warn threshold, the rest comfortable, which is what a
// real month tends to look like and what makes the screen worth looking at.
const TARGET_PCT: Record<string, number> = {
  groceries: 0.62,
  dining: 0.94, // the alert copy below refers to this number — keep them agreed
  transport: 0.41,
  shopping: 0.78,
  utilities: 0.55,
  subscriptions: 1.08, // over
};

function buildBudgets(recent: TxnSummary[]): BudgetSummary[] {
  return Object.entries(TARGET_PCT).map(([category, target]) => {
    // Spend is derived from the transactions actually generated, so the budget
    // rings can't contradict the list you get when you tap into a category.
    const fromTxns = recent
      .filter((t) => t.category === category && t.cents < 0)
      .reduce((sum, t) => sum + Math.abs(t.cents), 0);
    // Recent only covers ~3 weeks; scale to a month-ish figure.
    const spentCents = Math.max(1_200, Math.round(fromTxns * 1.35));
    // The limit follows the spend rather than the other way round. Hardcoding
    // limits against randomly generated transactions is how you end up with six
    // categories all reading "over" — the numbers have to be derived from the
    // same source to stay consistent.
    const limitCents = Math.round(spentCents / target / 500) * 500; // nearest $5
    const pct = spentCents / limitCents;
    const state = pct >= 1 ? "over" : pct >= 0.85 ? "warn" : "ok";
    return { category, spentCents, limitCents, state } as BudgetSummary;
  });
}

function buildSpark(r: () => number, t0: number, days: number, start: number, drift: number): SparkPoint[] {
  const pts: SparkPoint[] = [];
  let v = start;
  for (let i = days - 1; i >= 0; i--) {
    v += Math.round((r() - 0.42) * drift);
    pts.push({ d: t0 - i * DAY, cents: Math.max(0, v) });
  }
  return pts;
}

function buildSpendByDay(r: () => number, t0: number, days: number): SparkPoint[] {
  const pts: SparkPoint[] = [];
  for (let i = days - 1; i >= 0; i--) {
    // Not every day has spend — a gap is more honest than a zero, and the
    // contract says days with no spend are simply absent.
    if (r() < 0.18) continue;
    const weekend = new Date((t0 - i * DAY) * 1000).getUTCDay() % 6 === 0;
    const base = weekend ? 9_500 : 5_200;
    pts.push({ d: t0 - i * DAY, cents: base + Math.floor(r() * (weekend ? 14_000 : 9_000)) });
  }
  return pts;
}

const ACCOUNTS: AccountSummary[] = [
  { id: "demo-acct-checking", name: "Everyday Checking", kind: "depository", cents: 842_310 },
  { id: "demo-acct-savings", name: "Emergency Fund", kind: "depository", cents: 2_140_000 },
  { id: "demo-acct-card", name: "Sapphire Card", kind: "credit", cents: -128_450 },
  { id: "demo-acct-brokerage", name: "Brokerage", kind: "investment", cents: 4_863_920 },
];

const POSITIONS: PositionSummary[] = [
  { symbol: "VTI", name: "Vanguard Total Stock Market ETF", cents: 1_842_600, dayBp: 41, pnlCents: 312_400, qtyLabel: "62", sector: "Diversified" },
  { symbol: "AAPL", name: "Apple Inc.", cents: 986_400, dayBp: -63, pnlCents: 148_900, qtyLabel: "38", sector: "Technology" },
  { symbol: "MSFT", name: "Microsoft Corporation", cents: 812_050, dayBp: 88, pnlCents: 201_330, qtyLabel: "17", sector: "Technology" },
  { symbol: "COST", name: "Costco Wholesale Corporation", cents: 604_870, dayBp: 12, pnlCents: -22_140, qtyLabel: "6", sector: "Consumer Staples" },
  { symbol: "NVDA", name: "NVIDIA Corporation", cents: 418_000, dayBp: 236, pnlCents: 96_800, qtyLabel: "21", sector: "Technology" },
  { symbol: "BTC-USD", name: "Bitcoin", cents: 200_000, dayBp: -145, pnlCents: 41_260, qtyLabel: "0.0184", sector: "Crypto" },
];

/**
 * A complete, contract-valid Summary with nothing real in it.
 * Safe to hand to any screen or to publishWidgetData().
 */
export function buildDemoSummary(): Summary {
  const t0 = today();
  const r = rng(0x62_75_64_67); // "budg" — fixed, so the demo never shifts

  const recent = buildRecent(r, t0);
  const budgets = buildBudgets(recent);
  const netWorthCents = ACCOUNTS.reduce((sum, a) => sum + a.cents, 0);

  const alerts: AlertSummary[] = [
    { id: "demo-alert-1", kind: "overspend", text: "Dining is 94% through its budget with 9 days left", ts: t0 - 2 * DAY },
    { id: "demo-alert-2", kind: "large_move", text: "NVDA moved +2.4% today — your largest single-day gain this week", ts: t0 - 1 * DAY },
    { id: "demo-alert-3", kind: "other", text: "Netflix went up 35% — $22.99 above the usual $17.07", ts: t0 - 5 * DAY },
  ];

  return {
    v: SUMMARY_VERSION,
    asOf: Math.floor(Date.now() / 1000),
    appliedOpIds: [],
    netWorth: {
      cents: netWorthCents,
      spark: buildSpark(r, t0, 90, netWorthCents - 480_000, 92_000),
    },
    accounts: ACCOUNTS,
    budgets,
    recent,
    positions: POSITIONS,
    alerts,
    spendByDay: buildSpendByDay(r, t0, 62),
    categories: CATEGORIES,
    investments: {
      valueCents: POSITIONS.reduce((sum, p) => sum + p.cents, 0),
      spark: buildSpark(r, t0, 90, 4_320_000, 74_000),
      sectors: [
        { sector: "Technology", cents: 2_216_450 },
        { sector: "Diversified", cents: 1_842_600 },
        { sector: "Consumer Staples", cents: 604_870 },
        { sector: "Crypto", cents: 200_000 },
      ],
      strategies: [
        {
          id: "AAPL:demo:covered-call",
          underlying: "AAPL",
          label: "Covered call",
          detail: "$250 strike · 24 Aug '26",
          expiry: t0 + 27 * DAY,
          cents: 41_200,
          breakevens: [24_180_00],
          maxProfitCents: 62_000,
          maxLossCents: null,
        },
      ],
    },
  };
}
