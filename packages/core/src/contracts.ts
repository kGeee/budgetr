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
export const SUMMARY_VERSION = 2;
export const OUTBOX_VERSION = 2;

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
  // Active categories in the desktop's display order; ≤ MAX_CATEGORIES.
  categories?: CategoryInfo[];
  // ── v2: shared expenses ──────────────────────────────────────────
  // People you split with, and what each of them nets out to. Optional so a
  // v2 phone against a v1-shaped payload degrades to an empty tab rather than
  // failing validation.
  people?: PersonSummary[]; // ≤ MAX_PEOPLE
  shared?: SharedExpenseSummary[]; // most recent first; ≤ MAX_SHARED
  // Repayments the desktop believes it has spotted (a Venmo inflow matching an
  // outstanding share), for one-tap confirmation on the phone.
  settleSuggestions?: SettleSuggestionSummary[]; // ≤ MAX_SETTLE_SUGGESTIONS
}

export interface PersonSummary {
  id: string;
  name: string;
  /** Hex, desktop-assigned, so both clients colour a person identically. */
  color?: string | null;
  /**
   * Net position, signed: positive = they owe you. Already netted against
   * settlements on the desktop; the phone never recomputes a balance.
   */
  cents: number;
  /** Unsettled bills they appear on. */
  openCount: number;
  /** Last settlement, unix seconds — null if you have never squared up. */
  lastSettledAt?: number | null;
}

export interface SharedExpenseSummary {
  /** The shared-expense row id, not the transaction's. */
  id: string;
  txnId: string;
  ts: number;
  merchant: string;
  /** The whole bill, positive cents. */
  cents: number;
  /** Your own slice of it. */
  myCents: number;
  shares: { personId: string; cents: number }[];
  /** True when this split was built from a receipt, for the "by item" chip. */
  itemized: boolean;
  note?: string | null;
}

export interface SettleSuggestionSummary {
  /** The inflow transaction that looks like a repayment. */
  txnId: string;
  personId: string;
  ts: number;
  cents: number;
  /** Pre-rendered on the desktop, e.g. "Venmo · matches their Ippudo share". */
  detail: string;
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
  // Optional pre-rendered display fields (all computed on the desktop):
  name?: string; // security name, e.g. "SPDR S&P 500 ETF Trust"
  dayBp?: number; // day move in basis points, signed int (+82 = +0.82%)
  pnlCents?: number; // unrealized P&L, signed — a conscious, pre-rendered
  // output (reveals aggregate basis for THIS position; per-lot detail stays home)
  qtyLabel?: string; // pre-rendered quantity, e.g. "46" or "17,919.28"
  sector?: string; // assigned sector display name
  // NOTE: still no per-lot data, no greeks, no raw basis fields — the strict
  // validator rejects anything beyond the keys above.
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

// The user's category vocabulary — real display names and icons, so every
// client shows identical labels. Phones fall back to prettifying the key
// only when a summary predates this field.
export interface CategoryInfo {
  id: string; // stable key, matches TxnSummary.category / BudgetSummary.category
  name: string; // display name, e.g. "Food & Drink"
  icon?: string; // lucide icon name or emoji, as configured on the desktop
  group: 'income' | 'spending' | 'transfer';
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

export type Op =
  | RecategorizeOp
  | DismissAlertOp
  | SplitBillOp
  | RecordSettlementOp
  | ScanReceiptOp;

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

/**
 * Split a bill the phone is looking at.
 *
 * Carries resolved per-person amounts rather than a mode plus inputs: the
 * allocator is shared code (`allocateReceipt`), so the phone can compute the
 * exact cents and the desktop stores them. The desktop still owns the
 * accounting — it routes this through the same saveSharedExpense path the
 * desktop UI uses, including the reimbursable transfer-category overlay.
 */
export interface SplitBillOp extends OpBase {
  kind: 'splitBill';
  txnId: string;
  /** Positive cents owed, per person. Must reference known PersonSummary ids. */
  shares: { personId: string; cents: number }[];
  /**
   * What the split was computed over, when it isn't the transaction's own
   * amount — a restaurant that authorises pre-tip and settles the tip later.
   */
  basisCents?: number | null;
  /** Receipt lines + assignment, opaque JSON, round-tripped for re-editing. */
  itemsJson?: string | null;
  note?: string | null;
}

/** "They paid me back." */
export interface RecordSettlementOp extends OpBase {
  kind: 'recordSettlement';
  personId: string;
  cents: number; // positive
  /** The inflow this settles, when confirming a suggestion. */
  txnId?: string | null;
}

/**
 * A photographed receipt for the desktop to read.
 *
 * The phone cannot do this itself: Expo Go loads no custom native modules, so
 * there is no on-device text recognition available to it. The Mac has Apple's
 * Vision framework already wired, so the photo travels — sealed in the same
 * end-to-end encrypted envelope as every other op, through a relay that holds
 * only ciphertext — and the parsed lines come back in the next Summary.
 *
 * This is a weaker privacy claim than the desktop's ("never leaves your Mac")
 * and the UI must say the weaker one.
 */
export interface ScanReceiptOp extends OpBase {
  kind: 'scanReceipt';
  txnId: string;
  /** JPEG bytes, base64. Resized on device — see MAX_RECEIPT_BYTES. */
  imageBase64: string;
}

// ── Contract bounds (shared by buildSummary and validators) ────────
export const MAX_APPLIED_OP_IDS = 200;
export const MAX_RECENT_TXNS = 40;
export const MAX_SPARK_POINTS = 92;
export const MAX_SECTOR_SLICES = 10;
export const MAX_STRATEGIES = 8;
export const MAX_CURVE_POINTS = 16;
export const MAX_CATEGORIES = 96;
export const MAX_PEOPLE = 32;
export const MAX_SHARED = 40;
export const MAX_SETTLE_SUGGESTIONS = 10;
/**
 * Ceiling for a receipt photo, before base64. Every other op is a small JSON
 * object; this one carries an image, and an unbounded upload through a shared
 * relay is a denial-of-service on your own channel. A 1600px-wide JPEG of a
 * receipt lands around 250-400 KB, so 2 MB is headroom rather than a target.
 */
export const MAX_RECEIPT_BYTES = 2 * 1024 * 1024;
