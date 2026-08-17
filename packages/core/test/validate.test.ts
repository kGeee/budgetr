import { describe, expect, it } from 'vitest';
import {
  ContractValidationError,
  ContractVersionError,
  MAX_RECEIPT_BYTES,
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
    // Relative to the current version, so this keeps testing what it means
    // after the next bump rather than silently becoming a no-op.
    expect(() => assertValidOutbox({ ...validOutbox(), v: OUTBOX_VERSION + 1 })).toThrow(
      ContractVersionError,
    );
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

/**
 * The v2 ops carry money and, in one case, an image. The desktop applies these
 * against a real ledger, so the validator is the only thing standing between a
 * malformed op and a wrong balance.
 */
describe('assertValidOutbox — v2 ops', () => {
  const batch = (op: Record<string, unknown>) => ({
    v: OUTBOX_VERSION,
    deviceId: 'dev-1',
    batchId: 'b1',
    createdAt: 1_750_000_000,
    ops: [{ id: 'op-1', ts: 1_750_000_000, ...op }],
  });

  const splitBill = {
    kind: 'splitBill',
    txnId: 't1',
    shares: [{ personId: 'p1', cents: 3937 }],
  };

  it('accepts a well-formed split', () => {
    expect(() => assertValidOutbox(batch(splitBill))).not.toThrow();
  });

  it('accepts the optional pending-tip basis and the round-tripped receipt', () => {
    expect(() =>
      assertValidOutbox(batch({ ...splitBill, basisCents: 9000, itemsJson: '{"v":1}' })),
    ).not.toThrow();
  });

  it('refuses a split with nobody on it', () => {
    expect(() => assertValidOutbox(batch({ ...splitBill, shares: [] }))).toThrow();
  });

  it('refuses a negative or zero share', () => {
    // A negative share would invert who owes whom, on a device that cannot see
    // the ledger to notice.
    expect(() =>
      assertValidOutbox(batch({ ...splitBill, shares: [{ personId: 'p1', cents: -100 }] })),
    ).toThrow();
    expect(() =>
      assertValidOutbox(batch({ ...splitBill, shares: [{ personId: 'p1', cents: 0 }] })),
    ).toThrow();
  });

  it('accepts a settlement, and refuses one that pays nothing', () => {
    expect(() =>
      assertValidOutbox(batch({ kind: 'recordSettlement', personId: 'p1', cents: 5714 })),
    ).not.toThrow();
    expect(() =>
      assertValidOutbox(batch({ kind: 'recordSettlement', personId: 'p1', cents: 0 })),
    ).toThrow();
  });

  it('accepts a receipt photo', () => {
    expect(() =>
      assertValidOutbox(batch({ kind: 'scanReceipt', txnId: 't1', imageBase64: 'AAAA' })),
    ).not.toThrow();
  });

  it('refuses a receipt photo past the size ceiling', () => {
    // An unbounded upload through a shared relay is a denial-of-service on your
    // own channel, and the relay cannot tell a receipt from a video.
    const huge = 'A'.repeat(Math.ceil(MAX_RECEIPT_BYTES / 3) * 4 + 4);
    expect(() =>
      assertValidOutbox(batch({ kind: 'scanReceipt', txnId: 't1', imageBase64: huge })),
    ).toThrow();
  });

  it('still refuses an op kind it does not know', () => {
    expect(() => assertValidOutbox(batch({ kind: 'transferMoney', to: 'someone' }))).toThrow();
  });
});


describe('assertValidSummary — v2 shared sections', () => {
  const withShared = (extra: Record<string, unknown>) => ({ ...validSummary(), ...extra });

  it('accepts a summary that omits them entirely', () => {
    // An install that has never split a bill. A v2 phone must show an empty tab,
    // not an "update required" screen.
    expect(() => assertValidSummary(validSummary())).not.toThrow();
  });

  it('accepts people, bills and settlement suggestions', () => {
    expect(() =>
      assertValidSummary(
        withShared({
          people: [{ id: 'p1', name: 'Eesh', color: '#6fe3a6', cents: 5714, openCount: 2 }],
          shared: [
            {
              id: 'se1',
              txnId: 't1',
              ts: 1_750_000_000,
              merchant: 'Ippudo',
              cents: 9000,
              myCents: 3429,
              shares: [{ personId: 'p1', cents: 3934 }],
              itemized: true,
            },
          ],
          settleSuggestions: [
            { txnId: 't2', personId: 'p1', ts: 1_750_000_500, cents: 5714, detail: 'Venmo' },
          ],
        }),
      ),
    ).not.toThrow();
  });

  it('rejects a person whose balance is not an integer number of cents', () => {
    expect(() =>
      assertValidSummary(withShared({ people: [{ id: 'p1', name: 'E', cents: 12.5, openCount: 0 }] })),
    ).toThrow();
  });

  it('requires the itemized flag, so the phone never has to guess', () => {
    expect(() =>
      assertValidSummary(
        withShared({
          shared: [
            {
              id: 'se1',
              txnId: 't1',
              ts: 1,
              merchant: 'X',
              cents: 100,
              myCents: 50,
              shares: [{ personId: 'p1', cents: 50 }],
            },
          ],
        }),
      ),
    ).toThrow();
  });
});
