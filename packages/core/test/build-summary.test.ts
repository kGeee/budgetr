import { describe, expect, it } from 'vitest';
import {
  MAX_APPLIED_OP_IDS,
  MAX_RECENT_TXNS,
  MAX_SPARK_POINTS,
  SUMMARY_VERSION,
  buildSummary,
  computeBudgetState,
  type DesktopReadModel,
} from '../src/index.js';

function baseModel(overrides: Partial<DesktopReadModel> = {}): DesktopReadModel {
  return {
    now: 1_750_000_000,
    appliedOpIds: ['op-1', 'op-2'],
    netWorthCents: 1_234_567,
    netWorthSpark: [
      { d: 1_749_000_000, cents: 1_200_000 },
      { d: 1_749_086_400, cents: 1_234_567 },
    ],
    accounts: [
      { id: 'acc-2', name: 'Visa', kind: 'credit', cents: -50_000 },
      { id: 'acc-1', name: 'Checking', kind: 'depository', cents: 300_000 },
    ],
    budgets: [{ category: 'cat_dining', spentCents: 40_000, limitCents: 50_000 }],
    transactions: [
      { id: 't1', ts: 1_749_900_000, merchant: 'Café Zoë ☕', cents: -1_250, category: 'cat_dining', pending: false },
      { id: 't2', ts: 1_749_950_000, merchant: 'Payroll', cents: 250_000, category: 'cat_income', pending: true },
    ],
    positions: [
      { symbol: 'VTI', cents: 500_000 },
      { symbol: 'AAPL', cents: 700_000 },
    ],
    alerts: [{ id: 'a1', kind: 'overspend', text: 'Dining is over budget', ts: 1_749_990_000 }],
    ...overrides,
  };
}

// Deterministic pseudo-random generator for property-style tests.
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('buildSummary', () => {
  it('is deterministic: same input → byte-identical JSON', () => {
    const a = JSON.stringify(buildSummary(baseModel()));
    const b = JSON.stringify(buildSummary(baseModel()));
    expect(a).toBe(b);
  });

  it('is order-insensitive: shuffled input arrays → identical output', () => {
    const m = baseModel();
    const shuffled = baseModel({
      accounts: [...m.accounts].reverse(),
      transactions: [...m.transactions].reverse(),
      positions: [...m.positions].reverse(),
      netWorthSpark: [...m.netWorthSpark].reverse(),
    });
    expect(JSON.stringify(buildSummary(m))).toBe(JSON.stringify(buildSummary(shuffled)));
  });

  it('bounds arrays: recent ≤ 40 (most recent first), spark ≤ 92, appliedOpIds last 200', () => {
    const m = baseModel({
      transactions: Array.from({ length: 120 }, (_, i) => ({
        id: `t${i}`,
        ts: 1_749_000_000 + i * 60,
        merchant: `m${i}`,
        cents: -100 - i,
        category: 'cat_misc',
        pending: false,
      })),
      netWorthSpark: Array.from({ length: 365 }, (_, i) => ({ d: 1_720_000_000 + i * 86_400, cents: i * 100 })),
      appliedOpIds: Array.from({ length: 500 }, (_, i) => `op-${i}`),
    });
    const s = buildSummary(m);
    expect(s.recent).toHaveLength(MAX_RECENT_TXNS);
    expect(s.recent[0]!.id).toBe('t119'); // newest first
    expect(s.netWorth.spark).toHaveLength(MAX_SPARK_POINTS);
    expect(s.netWorth.spark.at(-1)!.d).toBe(1_720_000_000 + 364 * 86_400); // latest days kept
    expect(s.appliedOpIds).toHaveLength(MAX_APPLIED_OP_IDS);
    expect(s.appliedOpIds.at(-1)).toBe('op-499'); // last 200 kept
  });

  it('rounds float cents to integers; rejects non-finite', () => {
    const s = buildSummary(baseModel({ netWorthCents: 1234.56 }));
    expect(s.netWorth.cents).toBe(1235);
    expect(() => buildSummary(baseModel({ netWorthCents: NaN }))).toThrow(TypeError);
    expect(() => buildSummary(baseModel({ netWorthCents: Infinity }))).toThrow(TypeError);
  });

  it('strips positions to exactly {symbol, cents} — basis/greeks never survive', () => {
    const s = buildSummary(
      baseModel({
        positions: [{ symbol: 'AAPL', cents: 700_000, costBasisCents: 400_000, delta: 0.62, lots: [{}] }],
      }),
    );
    expect(s.positions).toEqual([{ symbol: 'AAPL', cents: 700_000 }]);
    expect(Object.keys(s.positions[0]!)).toEqual(['symbol', 'cents']);
  });

  it('sorts positions descending by value, spark ascending, and dedupes duplicate spark days', () => {
    const s = buildSummary(
      baseModel({
        netWorthSpark: [
          { d: 1_749_086_400, cents: 1 },
          { d: 1_749_000_000, cents: 2 },
          { d: 1_749_086_400, cents: 3 }, // dup day — last write wins
        ],
      }),
    );
    expect(s.positions.map((p) => p.symbol)).toEqual(['AAPL', 'VTI']);
    expect(s.netWorth.spark).toEqual([
      { d: 1_749_000_000, cents: 2 },
      { d: 1_749_086_400, cents: 3 },
    ]);
  });

  it('property: generated models always satisfy the §4 invariants', () => {
    const rand = mulberry32(42);
    const int = (max: number) => Math.floor(rand() * max);
    for (let run = 0; run < 50; run++) {
      const s = buildSummary(
        baseModel({
          netWorthCents: rand() * 10_000_000 - 5_000_000, // deliberate floats
          transactions: Array.from({ length: int(100) }, (_, i) => ({
            id: `t${i}`,
            ts: 1_749_000_000 + int(1_000_000),
            merchant: `m${i}`,
            cents: rand() * 20_000 - 10_000,
            category: 'cat_misc',
            pending: rand() > 0.5,
          })),
          positions: Array.from({ length: int(30) }, (_, i) => ({
            symbol: `SYM${i}`,
            cents: rand() * 1_000_000,
            costBasisCents: rand() * 1_000_000, // must be stripped
          })),
          netWorthSpark: Array.from({ length: int(400) }, (_, i) => ({
            d: 1_700_000_000 + i * 86_400,
            cents: rand() * 1_000_000,
          })),
          appliedOpIds: Array.from({ length: int(400) }, (_, i) => `op-${i}`),
        }),
      );
      const flat = JSON.stringify(s);
      // no float cents anywhere: every number in the JSON is an integer
      for (const n of flat.match(/-?\d+\.\d+/g) ?? []) {
        throw new Error(`float leaked into contract: ${n}`);
      }
      expect(s.v).toBe(SUMMARY_VERSION);
      expect(s.recent.length).toBeLessThanOrEqual(MAX_RECENT_TXNS);
      expect(s.netWorth.spark.length).toBeLessThanOrEqual(MAX_SPARK_POINTS);
      expect(s.appliedOpIds.length).toBeLessThanOrEqual(MAX_APPLIED_OP_IDS);
      for (const p of s.positions) expect(Object.keys(p)).toEqual(['symbol', 'cents']);
    }
  });
});

describe('computeBudgetState', () => {
  it('ok below 85%, warn at ≥85%, over past the limit', () => {
    expect(computeBudgetState(0, 50_000)).toBe('ok');
    expect(computeBudgetState(42_499, 50_000)).toBe('ok');
    expect(computeBudgetState(42_500, 50_000)).toBe('warn'); // exactly 85%
    expect(computeBudgetState(50_000, 50_000)).toBe('warn'); // at limit, not over
    expect(computeBudgetState(50_001, 50_000)).toBe('over');
  });

  it('zero/negative limit: over only when money was actually spent', () => {
    expect(computeBudgetState(0, 0)).toBe('ok');
    expect(computeBudgetState(1, 0)).toBe('over');
  });
});

describe('investments extension', () => {
  const inv = () => ({
    valueCents: 1_200_000,
    spark: [
      { d: 1_749_000_000, cents: 1_100_000 },
      { d: 1_749_086_400, cents: 1_200_000 },
    ],
    sectors: Array.from({ length: 14 }, (_, i) => ({ sector: `Sector${String(i).padStart(2, '0')}`, cents: (14 - i) * 10_000 })),
    strategies: [
      {
        id: 'AAPL:2026-08-21:bull-call-spread',
        underlying: 'AAPL',
        label: 'Bull call spread',
        detail: '$430 / $450 · Aug 21 ’26',
        expiry: 1_787_000_000,
        cents: 45_000,
        // basis-derived fields that MUST be stripped:
        maxProfit: 2_000,
        maxLoss: 500,
        payoffLegs: [{ strike: 430 }],
      },
      {
        id: 'SPY:2026-07-24:short-put',
        underlying: 'SPY',
        label: 'Short put',
        detail: '$560 · Jul 24 ’26',
        expiry: 1_784_700_000,
        cents: -12_000,
      },
    ],
  });

  it('is omitted when the model has no investments', () => {
    const s = buildSummary(baseModel());
    expect(s.investments).toBeUndefined();
  });

  it('buckets sectors past the cap into "Other" and keeps them descending', () => {
    const s = buildSummary(baseModel({ investments: inv() }));
    const sectors = s.investments!.sectors;
    expect(sectors).toHaveLength(10);
    expect(sectors.at(-1)!.sector).toBe('Other');
    const total = sectors.reduce((a, x) => a + x.cents, 0);
    expect(total).toBe(inv().sectors.reduce((a, x) => a + x.cents, 0));
    for (let i = 1; i < sectors.length - 1; i++) {
      expect(sectors[i - 1]!.cents).toBeGreaterThanOrEqual(sectors[i]!.cents);
    }
  });

  it('sorts strategies soonest-expiry-first and strips basis-derived fields', () => {
    const s = buildSummary(baseModel({ investments: inv() }));
    const st = s.investments!.strategies;
    expect(st.map((x) => x.underlying)).toEqual(['SPY', 'AAPL']); // topical first
    expect(Object.keys(st[1]!).sort()).toEqual(['cents', 'detail', 'expiry', 'id', 'label', 'underlying']);
  });
});
