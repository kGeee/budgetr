// buildSummary — the only way a Summary comes into existence (spec T1).
//
// Deterministic and pure: the same DesktopReadModel produces byte-identical
// JSON, so an unchanged desktop state never churns the relay blob. All §4
// invariants are enforced here at generation time: integer cents, bounded
// arrays, precomputed budget state, and positions stripped to symbol + value.

import {
  MAX_APPLIED_OP_IDS,
  MAX_RECENT_TXNS,
  MAX_SECTOR_SLICES,
  MAX_SPARK_POINTS,
  MAX_STRATEGIES,
  SUMMARY_VERSION,
  type AccountKind,
  type AlertKind,
  type BudgetState,
  type InvestmentsSummary,
  type SparkPoint,
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
  // Daily spending totals, positive cents. Optional.
  spendByDay?: Array<{ d: number; cents: number }>;
  // Optional investments detail. Strategy inputs may carry extra fields
  // (maxProfit, payoffLegs, …) — buildSummary strips to the contract shape.
  investments?: {
    valueCents: number;
    spark: Array<{ d: number; cents: number }>;
    sectors: Array<{ sector: string; cents: number }>;
    strategies: Array<{
      id: string;
      underlying: string;
      label: string;
      detail: string;
      expiry: number;
      cents: number;
      [extra: string]: unknown;
    }>;
  };
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

// Sort ascending, round, then dedupe by day (last write wins) so the spark is
// strictly ascending — the validator rejects duplicate day keys.
function buildSpark(raw: Array<{ d: number; cents: number }>, what: string): SparkPoint[] {
  const byDay = new Map<number, number>();
  for (const [i, p] of [...raw].sort((a, b) => a.d - b.d).entries()) {
    byDay.set(seconds(p.d, `${what}[${i}].d`), cents(p.cents, `${what}[${i}].cents`));
  }
  return [...byDay.entries()]
    .sort((a, b) => a[0] - b[0])
    .slice(-MAX_SPARK_POINTS)
    .map(([d, c]) => ({ d, cents: c }));
}

function buildInvestments(inv: NonNullable<DesktopReadModel['investments']>): InvestmentsSummary {
  // Descending by value; everything past the cap collapses into "Other" so
  // the donut stays legible and the blob stays bounded.
  const sorted = [...inv.sectors]
    .map((s) => ({ sector: s.sector, cents: cents(s.cents, `sector ${s.sector}`) }))
    .sort((a, b) => b.cents - a.cents || (a.sector < b.sector ? -1 : a.sector > b.sector ? 1 : 0));
  const kept = sorted.slice(0, MAX_SECTOR_SLICES - 1);
  const rest = sorted.slice(MAX_SECTOR_SLICES - 1);
  const sectors =
    rest.length > 1
      ? [...kept, { sector: 'Other', cents: rest.reduce((acc, s) => acc + s.cents, 0) }]
      : sorted.slice(0, MAX_SECTOR_SLICES);

  // "Topical" = soonest expiry first. Strip to exactly the contract keys:
  // anything basis-derived (maxProfit, payoffLegs, …) dies here.
  const strategies = [...inv.strategies]
    .sort((a, b) => a.expiry - b.expiry || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .slice(0, MAX_STRATEGIES)
    .map((st) => ({
      id: st.id,
      underlying: st.underlying,
      label: st.label,
      detail: st.detail,
      expiry: seconds(st.expiry, `strategy ${st.id} expiry`),
      cents: cents(st.cents, `strategy ${st.id}`),
    }));

  return {
    valueCents: cents(inv.valueCents, 'investments value'),
    spark: buildSpark(inv.spark, 'investments.spark'),
    sectors,
    strategies,
  };
}

export function buildSummary(model: DesktopReadModel): Summary {
  const spark = buildSpark(model.netWorthSpark, 'spark');

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
    ...(model.investments ? { investments: buildInvestments(model.investments) } : {}),
    ...(model.spendByDay ? { spendByDay: buildSpark(model.spendByDay, 'spendByDay') } : {}),
  };

  assertValidSummary(summary); // generation is also the trust edge
  return summary;
}
