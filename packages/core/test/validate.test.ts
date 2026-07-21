import { describe, expect, it } from 'vitest';
import {
  ContractValidationError,
  ContractVersionError,
  OUTBOX_VERSION,
  assertValidOutbox,
  assertValidSummary,
  buildSummary,
  type OutboxBatch,
} from '../src/index.js';

const validSummary = () =>
  JSON.parse(
    JSON.stringify(
      buildSummary({
        now: 1_750_000_000,
        appliedOpIds: ['op-1'],
        netWorthCents: 100,
        netWorthSpark: [{ d: 1_749_000_000, cents: 100 }],
        accounts: [{ id: 'a', name: 'Checking', kind: 'depository', cents: 100 }],
        budgets: [{ category: 'cat_dining', spentCents: 10, limitCents: 100 }],
        transactions: [{ id: 't', ts: 1_749_000_000, merchant: 'x', cents: -1, category: 'cat_dining', pending: false }],
        positions: [{ symbol: 'VTI', cents: 100 }],
        alerts: [{ id: 'al', kind: 'other', text: 'hi', ts: 1_749_000_000 }],
      }),
    ),
  );

const validOutbox = (): OutboxBatch => ({
  v: OUTBOX_VERSION,
  deviceId: 'dev-1',
  batchId: 'b1',
  createdAt: 1_750_000_000,
  ops: [
    { id: 'op-a', ts: 1_750_000_000, kind: 'recategorize', txnId: 't', toCategory: 'cat_misc' },
    { id: 'op-b', ts: 1_750_000_001, kind: 'dismissAlert', alertId: 'al' },
  ],
});

describe('assertValidSummary', () => {
  it('accepts a buildSummary product round-tripped through JSON', () => {
    expect(() => assertValidSummary(validSummary())).not.toThrow();
  });

  it('rejects float cents', () => {
    const s = validSummary();
    s.netWorth.cents = 100.5;
    expect(() => assertValidSummary(s)).toThrow(ContractValidationError);
  });

  it('refuses a newer version gracefully with a typed error', () => {
    const s = validSummary();
    s.v = 99;
    expect(() => assertValidSummary(s)).toThrow(ContractVersionError);
  });

  it('rejects positions carrying raw basis fields beyond the display keys', () => {
    const s = validSummary();
    s.positions[0].costBasisCents = 1;
    expect(() => assertValidSummary(s)).toThrow(/pre-rendered display fields/);
  });

  it('tolerates unknown extra fields outside positions (forward compat)', () => {
    const s = validSummary();
    s.accounts[0].nickname = 'main'; // future optional field
    s.someFutureTopLevel = true;
    expect(() => assertValidSummary(s)).not.toThrow();
  });

  it('rejects a non-ascending spark', () => {
    const s = validSummary();
    s.netWorth.spark = [
      { d: 2, cents: 1 },
      { d: 1, cents: 1 },
    ];
    expect(() => assertValidSummary(s)).toThrow(/ascending/);
  });

  it('rejects garbage without crashing', () => {
    for (const junk of [null, 7, 'hi', [], { v: 'x' }, { v: 1 }]) {
      expect(() => assertValidSummary(junk)).toThrow();
    }
  });
});

describe('assertValidOutbox', () => {
  it('accepts a valid batch', () => {
    expect(() => assertValidOutbox(validOutbox())).not.toThrow();
  });

  it('refuses a newer version with a typed error', () => {
    expect(() => assertValidOutbox({ ...validOutbox(), v: 2 })).toThrow(ContractVersionError);
  });

  it('rejects unknown op kinds — the desktop never guesses at intents', () => {
    const b = validOutbox();
    (b.ops as unknown[]).push({ id: 'op-c', ts: 1, kind: 'deleteEverything' });
    expect(() => assertValidOutbox(b)).toThrow(/unknown op kind/);
  });

  it('rejects ops missing their target ids', () => {
    const b = validOutbox();
    (b.ops[0] as unknown as Record<string, unknown>).txnId = '';
    expect(() => assertValidOutbox(b)).toThrow(ContractValidationError);
  });
});

describe('investments validation', () => {
  const withInvestments = () => {
    const s = validSummary();
    s.investments = {
      valueCents: 100,
      spark: [{ d: 1, cents: 100 }],
      sectors: [{ sector: 'Technology', cents: 100 }],
      strategies: [
        { id: 'x', underlying: 'AAPL', label: 'Long call', detail: '$200 · Aug 21', expiry: 1_787_000_000, cents: 100 },
      ],
    };
    return s;
  };

  it('accepts a valid investments block (and summaries without one)', () => {
    expect(() => assertValidSummary(withInvestments())).not.toThrow();
    expect(() => assertValidSummary(validSummary())).not.toThrow();
  });

  it('rejects basis-derived fields on strategies — the privacy gate', () => {
    const s = withInvestments();
    s.investments.strategies[0].maxProfit = 2000;
    expect(() => assertValidSummary(s)).toThrow(/pre-rendered/);
  });

  it('rejects extra fields on sector slices', () => {
    const s = withInvestments();
    s.investments.sectors[0].costBasisCents = 1;
    expect(() => assertValidSummary(s)).toThrow(/sector \+ cents/);
  });

  it('rejects float cents inside investments', () => {
    const s = withInvestments();
    s.investments.valueCents = 10.5;
    expect(() => assertValidSummary(s)).toThrow(ContractValidationError);
  });
});
