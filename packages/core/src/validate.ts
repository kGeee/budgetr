// Hand-rolled contract validators (spec T1). Both apps run these at the trust
// edge: the desktop before applying a decrypted OutboxBatch, the phone before
// rendering a decrypted Summary.
//
// Validation posture:
//   - Unknown extra fields are TOLERATED everywhere except PositionSummary,
//     so future writers can add optional fields without a version bump.
//   - PositionSummary is STRICT (symbol + cents only): cost basis, greeks, or
//     lots leaking onto positions is a security defect, not a compat issue.
//   - A higher format version than we know throws ContractVersionError so the
//     UI can render "update your app" instead of mis-parsing.

import {
  OUTBOX_VERSION,
  SUMMARY_VERSION,
  type Op,
  type OutboxBatch,
  type Summary,
  MAX_RECEIPT_BYTES,
} from './contracts.js';

export class ContractValidationError extends Error {
  constructor(
    public readonly path: string,
    message: string,
  ) {
    super(`${path}: ${message}`);
    this.name = 'ContractValidationError';
  }
}

/** The payload is well-formed but written by a newer app than this reader. */
export class ContractVersionError extends Error {
  constructor(
    public readonly contract: 'summary' | 'outbox',
    public readonly seen: number,
    public readonly known: number,
  ) {
    super(`${contract} v${seen} is newer than supported v${known}`);
    this.name = 'ContractVersionError';
  }
}

const ACCOUNT_KINDS = new Set(['depository', 'credit', 'investment', 'loan', 'other']);
const BUDGET_STATES = new Set(['ok', 'warn', 'over']);
const ALERT_KINDS = new Set(['overspend', 'large_move', 'low_balance', 'other']);
// STRICT-keyed shapes: anything beyond these keys is a privacy leak (basis,
// greeks, payoff legs, lots) and rejects the whole summary.
const POSITION_KEYS = new Set(['symbol', 'cents', 'name', 'dayBp', 'pnlCents', 'qtyLabel', 'sector']);
const SECTOR_KEYS = new Set(['sector', 'cents']);
// curve/breakevens/maxProfitCents/maxLossCents are pre-rendered DISPLAY
// outputs computed on the desktop — allowed. The raw engine fields
// (maxProfit, maxLoss, payoffLegs, breakeven) remain banned: their presence
// means someone wired desktop internals straight onto the wire.
const STRATEGY_KEYS = new Set([
  'id',
  'underlying',
  'label',
  'detail',
  'expiry',
  'cents',
  'curve',
  'breakevens',
  'maxProfitCents',
  'maxLossCents',
]);
const CURVE_KEYS = new Set(['p', 'pnl']);
const CATEGORY_KEYS = new Set(['id', 'name', 'icon', 'group']);
const CATEGORY_GROUPS = new Set(['income', 'spending', 'transfer']);

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

function req(cond: boolean, path: string, message: string): asserts cond {
  if (!cond) throw new ContractValidationError(path, message);
}

/** Integer cents / unix seconds — the only number shape contracts allow. */
function reqInt(x: unknown, path: string): asserts x is number {
  req(typeof x === 'number' && Number.isSafeInteger(x), path, 'must be a safe integer (no floats reach a contract)');
}

function reqStr(x: unknown, path: string): asserts x is string {
  req(typeof x === 'string' && x.length > 0, path, 'must be a non-empty string');
}

function reqArr(x: unknown, path: string): asserts x is unknown[] {
  req(Array.isArray(x), path, 'must be an array');
}

function validateSpark(x: unknown, path: string): void {
  reqArr(x, path);
  let prevD = -Infinity;
  x.forEach((p, i) => {
    const pp = `${path}[${i}]`;
    req(isRecord(p), pp, 'must be an object');
    reqInt(p.d, `${pp}.d`);
    reqInt(p.cents, `${pp}.cents`);
    req(p.d > prevD, `${pp}.d`, 'spark must be strictly ascending by day');
    prevD = p.d as number;
  });
}

export function assertValidSummary(s: unknown): asserts s is Summary {
  req(isRecord(s), '$', 'must be an object');
  reqInt(s.v, '$.v');
  if (s.v > SUMMARY_VERSION) throw new ContractVersionError('summary', s.v, SUMMARY_VERSION);
  req(s.v === SUMMARY_VERSION, '$.v', `unsupported version ${s.v}`);
  reqInt(s.asOf, '$.asOf');

  reqArr(s.appliedOpIds, '$.appliedOpIds');
  s.appliedOpIds.forEach((id, i) => reqStr(id, `$.appliedOpIds[${i}]`));

  req(isRecord(s.netWorth), '$.netWorth', 'must be an object');
  reqInt(s.netWorth.cents, '$.netWorth.cents');
  validateSpark(s.netWorth.spark, '$.netWorth.spark');

  reqArr(s.accounts, '$.accounts');
  s.accounts.forEach((a, i) => {
    const path = `$.accounts[${i}]`;
    req(isRecord(a), path, 'must be an object');
    reqStr(a.id, `${path}.id`);
    reqStr(a.name, `${path}.name`);
    req(typeof a.kind === 'string' && ACCOUNT_KINDS.has(a.kind), `${path}.kind`, 'unknown account kind');
    reqInt(a.cents, `${path}.cents`);
  });

  reqArr(s.budgets, '$.budgets');
  s.budgets.forEach((b, i) => {
    const path = `$.budgets[${i}]`;
    req(isRecord(b), path, 'must be an object');
    reqStr(b.category, `${path}.category`);
    reqInt(b.spentCents, `${path}.spentCents`);
    reqInt(b.limitCents, `${path}.limitCents`);
    req(typeof b.state === 'string' && BUDGET_STATES.has(b.state), `${path}.state`, 'unknown budget state');
  });

  reqArr(s.recent, '$.recent');
  s.recent.forEach((t, i) => {
    const path = `$.recent[${i}]`;
    req(isRecord(t), path, 'must be an object');
    reqStr(t.id, `${path}.id`);
    reqInt(t.ts, `${path}.ts`);
    req(typeof t.merchant === 'string', `${path}.merchant`, 'must be a string');
    reqInt(t.cents, `${path}.cents`);
    reqStr(t.category, `${path}.category`);
    req(typeof t.pending === 'boolean', `${path}.pending`, 'must be a boolean');
  });

  reqArr(s.positions, '$.positions');
  s.positions.forEach((p, i) => {
    const path = `$.positions[${i}]`;
    req(isRecord(p), path, 'must be an object');
    reqStr(p.symbol, `${path}.symbol`);
    reqInt(p.cents, `${path}.cents`);
    if (p.name !== undefined) reqStr(p.name, `${path}.name`);
    if (p.dayBp !== undefined) reqInt(p.dayBp, `${path}.dayBp`);
    if (p.pnlCents !== undefined) reqInt(p.pnlCents, `${path}.pnlCents`);
    if (p.qtyLabel !== undefined) reqStr(p.qtyLabel, `${path}.qtyLabel`);
    if (p.sector !== undefined) reqStr(p.sector, `${path}.sector`);
    // STRICT: anything beyond the pre-rendered display keys (raw basis,
    // greeks, lots, …) is a privacy leak — reject the whole summary.
    for (const k of Object.keys(p)) {
      req(POSITION_KEYS.has(k), `${path}.${k}`, 'positions carry only pre-rendered display fields');
    }
  });

  reqArr(s.alerts, '$.alerts');
  s.alerts.forEach((a, i) => {
    const path = `$.alerts[${i}]`;
    req(isRecord(a), path, 'must be an object');
    reqStr(a.id, `${path}.id`);
    req(typeof a.kind === 'string' && ALERT_KINDS.has(a.kind), `${path}.kind`, 'unknown alert kind');
    reqStr(a.text, `${path}.text`);
    reqInt(a.ts, `${path}.ts`);
  });

  if (s.spendByDay !== undefined) validateSpark(s.spendByDay, '$.spendByDay');

  if (s.categories !== undefined) {
    reqArr(s.categories, '$.categories');
    s.categories.forEach((c, i) => {
      const path = `$.categories[${i}]`;
      req(isRecord(c), path, 'must be an object');
      reqStr(c.id, `${path}.id`);
      reqStr(c.name, `${path}.name`);
      if (c.icon !== undefined) reqStr(c.icon, `${path}.icon`);
      req(typeof c.group === 'string' && CATEGORY_GROUPS.has(c.group), `${path}.group`, 'unknown category group');
      for (const k of Object.keys(c)) {
        req(CATEGORY_KEYS.has(k), `${path}.${k}`, 'categories carry only id/name/icon/group');
      }
    });
  }

  // ── v2: shared expenses. Optional throughout — an install that has never
  // split a bill omits them, and a v2 phone must render an empty tab rather
  // than reject the whole payload.
  if (s.people !== undefined) {
    reqArr(s.people, '$.people');
    s.people.forEach((p, i) => {
      const path = `$.people[${i}]`;
      req(isRecord(p), path, 'must be an object');
      reqStr(p.id, `${path}.id`);
      reqStr(p.name, `${path}.name`);
      reqInt(p.cents, `${path}.cents`);
      reqInt(p.openCount, `${path}.openCount`);
      if (p.color != null) reqStr(p.color, `${path}.color`);
      if (p.lastSettledAt != null) reqInt(p.lastSettledAt, `${path}.lastSettledAt`);
    });
  }

  if (s.shared !== undefined) {
    reqArr(s.shared, '$.shared');
    s.shared.forEach((e, i) => {
      const path = `$.shared[${i}]`;
      req(isRecord(e), path, 'must be an object');
      reqStr(e.id, `${path}.id`);
      reqStr(e.txnId, `${path}.txnId`);
      reqInt(e.ts, `${path}.ts`);
      reqStr(e.merchant, `${path}.merchant`);
      reqInt(e.cents, `${path}.cents`);
      reqInt(e.myCents, `${path}.myCents`);
      reqArr(e.shares, `${path}.shares`);
      e.shares.forEach((sh, j) => {
        const sp = `${path}.shares[${j}]`;
        req(isRecord(sh), sp, 'must be an object');
        reqStr(sh.personId, `${sp}.personId`);
        reqInt(sh.cents, `${sp}.cents`);
      });
      req(typeof e.itemized === 'boolean', `${path}.itemized`, 'must be a boolean');
      if (e.note != null) reqStr(e.note, `${path}.note`);
    });
  }

  if (s.settleSuggestions !== undefined) {
    reqArr(s.settleSuggestions, '$.settleSuggestions');
    s.settleSuggestions.forEach((sg, i) => {
      const path = `$.settleSuggestions[${i}]`;
      req(isRecord(sg), path, 'must be an object');
      reqStr(sg.txnId, `${path}.txnId`);
      reqStr(sg.personId, `${path}.personId`);
      reqInt(sg.ts, `${path}.ts`);
      reqInt(sg.cents, `${path}.cents`);
      reqStr(sg.detail, `${path}.detail`);
    });
  }

  if (s.investments !== undefined) {
    const inv = s.investments;
    req(isRecord(inv), '$.investments', 'must be an object');
    reqInt(inv.valueCents, '$.investments.valueCents');
    validateSpark(inv.spark, '$.investments.spark');

    reqArr(inv.sectors, '$.investments.sectors');
    inv.sectors.forEach((sl, i) => {
      const path = `$.investments.sectors[${i}]`;
      req(isRecord(sl), path, 'must be an object');
      reqStr(sl.sector, `${path}.sector`);
      reqInt(sl.cents, `${path}.cents`);
      for (const k of Object.keys(sl)) {
        req(SECTOR_KEYS.has(k), `${path}.${k}`, 'sector slices may only carry sector + cents');
      }
    });

    reqArr(inv.strategies, '$.investments.strategies');
    inv.strategies.forEach((st, i) => {
      const path = `$.investments.strategies[${i}]`;
      req(isRecord(st), path, 'must be an object');
      reqStr(st.id, `${path}.id`);
      reqStr(st.underlying, `${path}.underlying`);
      reqStr(st.label, `${path}.label`);
      req(typeof st.detail === 'string', `${path}.detail`, 'must be a string');
      reqInt(st.expiry, `${path}.expiry`);
      reqInt(st.cents, `${path}.cents`);
      if (st.curve !== undefined) {
        reqArr(st.curve, `${path}.curve`);
        let prevP = -Infinity;
        st.curve.forEach((v, j) => {
          const vp = `${path}.curve[${j}]`;
          req(isRecord(v), vp, 'must be an object');
          reqInt(v.p, `${vp}.p`);
          reqInt(v.pnl, `${vp}.pnl`);
          req((v.p as number) > prevP, `${vp}.p`, 'curve must be ascending by price');
          prevP = v.p as number;
          for (const k of Object.keys(v)) {
            req(CURVE_KEYS.has(k), `${vp}.${k}`, 'curve vertices carry only p + pnl');
          }
        });
      }
      if (st.breakevens !== undefined) {
        reqArr(st.breakevens, `${path}.breakevens`);
        st.breakevens.forEach((b, j) => reqInt(b, `${path}.breakevens[${j}]`));
      }
      if (st.maxProfitCents !== undefined && st.maxProfitCents !== null) reqInt(st.maxProfitCents, `${path}.maxProfitCents`);
      if (st.maxLossCents !== undefined && st.maxLossCents !== null) reqInt(st.maxLossCents, `${path}.maxLossCents`);
      // STRICT: raw engine fields (maxProfit, payoffLegs, …) must never cross
      // the wire — only the pre-rendered *Cents/curve outputs above may.
      for (const k of Object.keys(st)) {
        req(STRATEGY_KEYS.has(k), `${path}.${k}`, 'strategies carry only pre-rendered labels and value');
      }
    });
  }
}

function assertValidOp(op: unknown, path: string): asserts op is Op {
  req(isRecord(op), path, 'must be an object');
  reqStr(op.id, `${path}.id`);
  reqInt(op.ts, `${path}.ts`);
  reqStr(op.kind, `${path}.kind`);
  switch (op.kind) {
    case 'recategorize':
      reqStr(op.txnId, `${path}.txnId`);
      reqStr(op.toCategory, `${path}.toCategory`);
      return;
    case 'dismissAlert':
      reqStr(op.alertId, `${path}.alertId`);
      return;
    case 'splitBill': {
      reqStr(op.txnId, `${path}.txnId`);
      reqArr(op.shares, `${path}.shares`);
      req(op.shares.length > 0, `${path}.shares`, 'must name at least one person');
      op.shares.forEach((sh, i) => {
        const p = `${path}.shares[${i}]`;
        req(isRecord(sh), p, 'must be an object');
        reqStr(sh.personId, `${p}.personId`);
        reqInt(sh.cents, `${p}.cents`);
        // A share of nothing is not a share, and a negative one would invert
        // who owes whom on a device that cannot see the ledger to notice.
        req((sh.cents as number) > 0, `${p}.cents`, 'must be positive');
      });
      if (op.basisCents != null) reqInt(op.basisCents, `${path}.basisCents`);
      if (op.itemsJson != null) reqStr(op.itemsJson, `${path}.itemsJson`);
      if (op.note != null) reqStr(op.note, `${path}.note`);
      return;
    }
    case 'recordSettlement':
      reqStr(op.personId, `${path}.personId`);
      reqInt(op.cents, `${path}.cents`);
      req((op.cents as number) > 0, `${path}.cents`, 'must be positive');
      if (op.txnId != null) reqStr(op.txnId, `${path}.txnId`);
      return;
    case 'scanReceipt':
      reqStr(op.txnId, `${path}.txnId`);
      reqStr(op.imageBase64, `${path}.imageBase64`);
      // Bounded here rather than at the transport: the relay stores ciphertext
      // and cannot tell a receipt from a video, so the size rule has to live
      // with the only code that knows what the field is meant to hold.
      req(
        (op.imageBase64 as string).length <= Math.ceil(MAX_RECEIPT_BYTES / 3) * 4,
        `${path}.imageBase64`,
        'receipt image is too large',
      );
      return;
    default:
      // Unknown op kinds are a hard error: the desktop must never guess at an
      // intent it doesn't understand. New op kinds require an OUTBOX_VERSION bump.
      throw new ContractValidationError(`${path}.kind`, `unknown op kind '${op.kind}'`);
  }
}

export function assertValidOutbox(b: unknown): asserts b is OutboxBatch {
  req(isRecord(b), '$', 'must be an object');
  reqInt(b.v, '$.v');
  if (b.v > OUTBOX_VERSION) throw new ContractVersionError('outbox', b.v, OUTBOX_VERSION);
  req(b.v === OUTBOX_VERSION, '$.v', `unsupported version ${b.v}`);
  reqStr(b.deviceId, '$.deviceId');
  reqStr(b.batchId, '$.batchId');
  reqInt(b.createdAt, '$.createdAt');
  reqArr(b.ops, '$.ops');
  b.ops.forEach((op, i) => assertValidOp(op, `$.ops[${i}]`));
}
