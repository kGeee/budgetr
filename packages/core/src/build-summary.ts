// buildSummary — the only way a Summary comes into existence (spec T1).
//
// Deterministic and pure: the same DesktopReadModel produces byte-identical
// JSON, so an unchanged desktop state never churns the relay blob. All §4
// invariants are enforced here at generation time: integer cents, bounded
// arrays, precomputed budget state, and positions stripped to symbol + value.

import {
  MAX_APPLIED_OP_IDS,
  MAX_RECENT_TXNS,
  MAX_SPARK_POINTS,
  SUMMARY_VERSION,
  type AccountKind,
  type AlertKind,
  type BudgetState,
  type Summary,
} from './contracts.js';
import { assertValidSummary } from './validate.js';

// The desktop reads its DB into this plain snapshot, then hands it over.
// Nothing here holds a DB handle; arrays may be unbounded and unsorted.
// Position inputs may carry extra fields (basis, greeks, …) — buildSummary
// strips them; they never reach the contract.
export interface DesktopReadModel {
  now: number; // unix seconds — caller supplies the clock (purity)
  appliedOpIds: string[]; // full applied-op history, newest last
  netWorthCents: number;
  netWorthSpark: Array<{ d: number; cents: number }>;
  accounts: Array<{ id: string; name: string; kind: AccountKind; cents: number }>;
  budgets: Array<{ category: string; spentCents: number; limitCents: number }>;
  transactions: Array<{
    id: string;
    ts: number;
    merchant: string;
    cents: number;
    category: string;
    pending: boolean;
  }>;
  positions: Array<{ symbol: string; cents: number; [extra: string]: unknown }>;
  alerts: Array<{ id: string; kind: AlertKind; text: string; ts: number }>;
}

// warn at ≥85% of limit, over when spent exceeds limit. Integer-only math.
// TODO(T4): replace with the pacing logic extracted from web/ if it proves
// smarter than a flat threshold (e.g. day-of-month aware).
export function computeBudgetState(spentCents: number, limitCents: number): BudgetState {
  if (limitCents <= 0) return spentCents > 0 ? 'over' : 'ok';
  if (spentCents > limitCents) return 'over';
  if (spentCents * 100 >= limitCents * 85) return 'warn';
  return 'ok';
}

/** Round to integer cents; reject anything that isn't a finite number. */
function cents(x: number, what: string): number {
  if (typeof x !== 'number' || !Number.isFinite(x)) {
    throw new TypeError(`${what}: expected a finite number, got ${x}`);
  }
  return Math.round(x);
}

function seconds(x: number, what: string): number {
  return cents(x, what); // same rule: finite → integer
}

export function buildSummary(model: DesktopReadModel): Summary {
  // Sort ascending, round, then dedupe by day (last write wins) so the spark
  // is strictly ascending — the validator rejects duplicate day keys.
  const sparkByDay = new Map<number, number>();
  for (const [i, p] of [...model.netWorthSpark].sort((a, b) => a.d - b.d).entries()) {
    sparkByDay.set(seconds(p.d, `spark[${i}].d`), cents(p.cents, `spark[${i}].cents`));
  }
  const spark = [...sparkByDay.entries()]
    .sort((a, b) => a[0] - b[0])
    .slice(-MAX_SPARK_POINTS)
    .map(([d, c]) => ({ d, cents: c }));

  const accounts = [...model.accounts]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((a) => ({ id: a.id, name: a.name, kind: a.kind, cents: cents(a.cents, `account ${a.id}`) }));

  const budgets = [...model.budgets]
    .sort((a, b) => (a.category < b.category ? -1 : a.category > b.category ? 1 : 0))
    .map((b) => {
      const spentCents = cents(b.spentCents, `budget ${b.category} spent`);
      const limitCents = cents(b.limitCents, `budget ${b.category} limit`);
      return { category: b.category, spentCents, limitCents, state: computeBudgetState(spentCents, limitCents) };
    });

  const recent = [...model.transactions]
    .sort((a, b) => b.ts - a.ts || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .slice(0, MAX_RECENT_TXNS)
    .map((t) => ({
      id: t.id,
      ts: seconds(t.ts, `txn ${t.id} ts`),
      merchant: t.merchant,
      cents: cents(t.cents, `txn ${t.id}`),
      category: t.category,
      pending: t.pending,
    }));

  // Strip to exactly {symbol, cents}: cost basis, greeks, and lots must be
  // unreconstructable from the wire (spec invariant 2).
  const positions = [...model.positions]
    .sort((a, b) => b.cents - a.cents || (a.symbol < b.symbol ? -1 : a.symbol > b.symbol ? 1 : 0))
    .map((p) => ({ symbol: p.symbol, cents: cents(p.cents, `position ${p.symbol}`) }));

  const alerts = [...model.alerts]
    .sort((a, b) => b.ts - a.ts || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((a) => ({ id: a.id, kind: a.kind, text: a.text, ts: seconds(a.ts, `alert ${a.id} ts`) }));

  const summary: Summary = {
    v: SUMMARY_VERSION,
    asOf: seconds(model.now, 'now'),
    appliedOpIds: model.appliedOpIds.slice(-MAX_APPLIED_OP_IDS),
    netWorth: { cents: cents(model.netWorthCents, 'netWorth'), spark },
    accounts,
    budgets,
    recent,
    positions,
    alerts,
  };

  assertValidSummary(summary); // generation is also the trust edge
  return summary;
}
