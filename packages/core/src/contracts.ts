// Shared wire contracts for the budgetr companion (spec §4).
//
// These types are the single source of truth for everything crossing the
// relay. Do not redefine them in any other package — import them from
// @budgetr/core. The relay never imports them except in tests; it treats
// payloads as opaque ciphertext.
//
// Invariants (enforced by buildSummary + validate.ts, tested in test/):
//   1. Money is integer cents. No float ever reaches a contract.
//   2. Summary is derived and lossy by design — lots, cost basis, and full
//      transaction history must be unreconstructable from it. This is a
//      security property, not a nicety.
//   3. Ops are intents, not state.
//   4. Ids are stable; the same op id applied twice is a no-op.
//   5. Versioned: a reader seeing a higher `v` than it knows must refuse
//      gracefully, never crash or partially parse.
//
// All timestamps are unix SECONDS (UTC). Format for display only at the view
// layer.

// ── Format version. Bump on any breaking change to Summary/Outbox. ──
export const SUMMARY_VERSION = 1;
export const OUTBOX_VERSION = 1;

// ── Desktop → Phone ────────────────────────────────────────────────

export interface Summary {
  v: number; // === SUMMARY_VERSION at write time
  asOf: number; // unix seconds, when the desktop generated this
  appliedOpIds: string[]; // op ids the desktop has applied (bounded: last 200).
  // The phone uses this to clear its local outbox.
  netWorth: {
    cents: number;
    spark: SparkPoint[]; // ascending by day; ~90 points
  };
  accounts: AccountSummary[];
  budgets: BudgetSummary[];
  recent: TxnSummary[]; // most-recent first; ~40 items
  positions: PositionSummary[]; // descending by value
  alerts: AlertSummary[];
  investments?: InvestmentsSummary; // optional: older writers simply omit it
  // Daily spending totals (positive cents per day, days with no spend absent),
  // ascending, ≤ MAX_SPARK_POINTS. Backs the Budgets/Activity charts.
  spendByDay?: SparkPoint[];
}

export interface SparkPoint {
  d: number; // unix seconds (day)
  cents: number;
}

export type AccountKind = 'depository' | 'credit' | 'investment' | 'loan' | 'other';

export interface AccountSummary {
  id: string;
  name: string;
  kind: AccountKind;
  cents: number; // signed; liabilities negative
}

export type BudgetState = 'ok' | 'warn' | 'over';

export interface BudgetSummary {
  category: string; // stable category key, matches TxnSummary.category
  spentCents: number;
  limitCents: number;
  state: BudgetState; // desktop computes; phone never recomputes pace
}

export interface TxnSummary {
  id: string; // stable desktop txn id
  ts: number; // unix seconds
  merchant: string;
  cents: number; // signed; outflow negative
  category: string; // current category key
  pending: boolean;
}

export interface PositionSummary {
  symbol: string;
  cents: number; // current market value
  // NOTE: no cost basis, no greeks, no lots. The phone must never receive these.
}

// ── Investments (optional Summary extension — added post-v1, no bump) ──
// Everything here is derived and lossy: market values, sector buckets, and
// PRE-RENDERED strategy labels. maxProfit / maxLoss / breakevens / payoff
// legs are basis-derived on the desktop and MUST NOT cross the wire —
// validators are strict-keyed on these shapes to enforce that.

export interface SectorSlice {
  sector: string; // display name, e.g. "Technology", "Other", "Unclassified"
  cents: number; // current market value in this bucket
}

/** One vertex of the expiry payoff polyline (piecewise linear between them). */
export interface PayoffVertex {
  p: number; // underlying price, cents
  pnl: number; // P&L at expiry at that price, cents (signed)
}

export interface StrategySummary {
  id: string; // stable slug, e.g. "AAPL:2026-08-21:bull-call-spread"
  underlying: string; // ticker
  label: string; // pre-rendered, e.g. "Bull call spread"
  detail: string; // pre-rendered, e.g. "$430 / $450 · Aug 21 '26"
  expiry: number; // unix seconds — drives "topical" ordering + DTE display
  cents: number; // current market value of the structure (signed)
  // Pre-rendered payoff visualization, computed ON THE DESKTOP. These are
  // finished display outputs (like label/detail) — the raw inputs that made
  // them (per-leg premiums, payoffLegs) still never cross the wire.
  // Field semantics: absent = unknown (no basis recorded), null = unbounded.
  curve?: PayoffVertex[]; // ≤ MAX_CURVE_POINTS vertices, ascending by price
  breakevens?: number[]; // underlying prices, cents, ascending
  maxProfitCents?: number | null;
  maxLossCents?: number | null; // positive magnitude
}

export interface InvestmentsSummary {
  valueCents: number;
  spark: SparkPoint[]; // investment accounts only; ascending; ≤ MAX_SPARK_POINTS
  sectors: SectorSlice[]; // descending by value; ≤ MAX_SECTOR_SLICES (rest in "Other")
  strategies: StrategySummary[]; // soonest expiry first; ≤ MAX_STRATEGIES
}

export type AlertKind = 'overspend' | 'large_move' | 'low_balance' | 'other';

export interface AlertSummary {
  id: string;
  kind: AlertKind;
  text: string; // pre-rendered, human-readable
  ts: number;
}

// ── Phone → Desktop ────────────────────────────────────────────────

export interface OutboxBatch {
  v: number; // === OUTBOX_VERSION
  deviceId: string; // stable per install
  batchId: string; // uuid v4; idempotency key for the whole batch
  createdAt: number; // unix seconds
  ops: Op[];
}

export type Op = RecategorizeOp | DismissAlertOp;

export interface OpBase {
  id: string; // uuid v4; idempotency key for the single op
  ts: number; // unix seconds, when the user made the edit
}

export interface RecategorizeOp extends OpBase {
  kind: 'recategorize';
  txnId: string; // must reference a TxnSummary.id the phone has seen
  toCategory: string; // must be a known category key
}

export interface DismissAlertOp extends OpBase {
  kind: 'dismissAlert';
  alertId: string;
}

// ── Contract bounds (shared by buildSummary and validators) ────────
export const MAX_APPLIED_OP_IDS = 200;
export const MAX_RECENT_TXNS = 40;
export const MAX_SPARK_POINTS = 92;
export const MAX_SECTOR_SLICES = 10;
export const MAX_STRATEGIES = 8;
export const MAX_CURVE_POINTS = 16;
