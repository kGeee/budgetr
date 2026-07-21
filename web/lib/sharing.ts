import { db } from "@/db";
import { sql } from "drizzle-orm";
import { cleanTransactionName } from "@/lib/utils";

// The allocation math is a separate, db-free module so client components can
// import it directly; re-exported here so server callers have one entry point.
export {
  computeSplit,
  type ComputedSplit,
  type SplitMode,
  type SplitParticipant,
} from "@/lib/split-math";

/**
 * Shared expenses — you front the bill, friends pay you back.
 *
 * This module owns the read/compute half: allocating a total across people
 * without losing cents, reporting who owes what, and suggesting which incoming
 * Venmo/Zelle/Apple Cash transactions are repayments. Mutations live in
 * lib/actions-sharing.ts.
 *
 * Sign convention follows transactions.amount throughout: positive = money left
 * your account. So a share of 40 means "they owe you 40", and a settlement of 25
 * means "they paid you 25" — even though the underlying inflow row is -25.
 */

/** Payment rails people actually pay each other back on. */
const SETTLEMENT_NAME_RE = /venmo|zelle|cash\s?app|apple\s?cash|paypal|square cash/i;

// ── Balances ─────────────────────────────────────────────────────────────────

export type PersonRow = {
  id: string;
  name: string;
  handle: string | null;
  color: string | null;
  archived: boolean;
};

export type PersonBalance = PersonRow & {
  /** Lifetime total they've owed you. */
  owed: number;
  /** Lifetime total they've paid back. */
  settled: number;
  /** owed − settled. Positive = they still owe you; negative = you owe them. */
  balance: number;
  expenseCount: number;
};

/**
 * Every person with their running balance. Archived people are included (a
 * balance shouldn't vanish because you tidied the list) — callers filter.
 */
export function getPeopleBalances(): PersonBalance[] {
  return db
    .all<{
      id: string;
      name: string;
      handle: string | null;
      color: string | null;
      archived: number;
      owed: number | null;
      settled: number | null;
      expenseCount: number | null;
    }>(sql`
      SELECT p.id, p.name, p.handle, p.color, p.archived,
             (SELECT COALESCE(SUM(ABS(es.amount)), 0)
                FROM expense_shares es WHERE es.person_id = p.id) AS owed,
             (SELECT COALESCE(SUM(s.amount), 0)
                FROM settlements s WHERE s.person_id = p.id) AS settled,
             (SELECT COUNT(*) FROM expense_shares es WHERE es.person_id = p.id) AS expenseCount
      FROM people p
      ORDER BY p.archived ASC, p.name COLLATE NOCASE ASC`)
    .map((r) => {
      const owed = Number(r.owed ?? 0);
      const settled = Number(r.settled ?? 0);
      return {
        id: r.id,
        name: r.name,
        handle: r.handle,
        color: r.color,
        archived: Boolean(r.archived),
        owed,
        settled,
        balance: Math.round((owed - settled) * 100) / 100,
        expenseCount: Number(r.expenseCount ?? 0),
      };
    });
}

export type SharedExpenseRow = {
  id: string;
  transactionId: string;
  date: string;
  displayName: string;
  total: number;
  myShare: number;
  note: string | null;
  currency: string | null;
  shares: { personId: string; personName: string; amount: number }[];
};

/**
 * Shared expenses newest-first, each with its per-person shares attached.
 * `personId` narrows to expenses that person is part of.
 */
export function getSharedExpenses(
  opts: { personId?: string; transactionId?: string; limit?: number } = {},
): SharedExpenseRow[] {
  const { personId, transactionId, limit = 200 } = opts;
  const rows = db.all<{
    id: string;
    transactionId: string;
    date: string;
    name: string;
    merchant: string | null;
    total: number;
    myShare: number;
    note: string | null;
    currency: string | null;
  }>(sql`
    SELECT se.id, se.transaction_id AS transactionId, t.date, t.name, t.merchant_name AS merchant,
           t.amount AS total, se.my_share AS myShare, se.note, t.iso_currency_code AS currency
    FROM shared_expenses se
    JOIN transactions t ON t.id = se.transaction_id
    WHERE 1 = 1
    ${transactionId ? sql`AND se.transaction_id = ${transactionId}` : sql``}
    ${personId
      ? sql`AND EXISTS (SELECT 1 FROM expense_shares es
                        WHERE es.shared_expense_id = se.id AND es.person_id = ${personId})`
      : sql``}
    ORDER BY t.date DESC, se.rowid DESC
    LIMIT ${limit}`);

  if (rows.length === 0) return [];

  const shareRows = db.all<{
    sharedExpenseId: string;
    personId: string;
    personName: string;
    amount: number;
  }>(sql`
    SELECT es.shared_expense_id AS sharedExpenseId, es.person_id AS personId,
           p.name AS personName, es.amount
    FROM expense_shares es
    JOIN people p ON p.id = es.person_id
    WHERE es.shared_expense_id IN (${sql.join(rows.map((r) => sql`${r.id}`), sql`, `)})`);

  const byExpense = new Map<string, SharedExpenseRow["shares"]>();
  for (const s of shareRows) {
    if (!byExpense.has(s.sharedExpenseId)) byExpense.set(s.sharedExpenseId, []);
    byExpense.get(s.sharedExpenseId)!.push({
      personId: s.personId,
      personName: s.personName,
      amount: Number(s.amount),
    });
  }

  return rows.map((r) => ({
    id: r.id,
    transactionId: r.transactionId,
    date: r.date,
    displayName: cleanTransactionName(r.merchant ?? r.name),
    total: Number(r.total),
    myShare: Number(r.myShare),
    note: r.note,
    currency: r.currency,
    shares: byExpense.get(r.id) ?? [],
  }));
}

/** The shared-expense overlay on one transaction, for the detail drawer. */
export function getSharedExpenseForTransaction(txnId: string): SharedExpenseRow | null {
  return getSharedExpenses({ transactionId: txnId, limit: 1 })[0] ?? null;
}

export type SettlementRow = {
  id: string;
  personId: string;
  personName: string;
  transactionId: string | null;
  amount: number;
  date: string;
  note: string | null;
};

/** Recorded repayments, newest first. */
export function getSettlements(opts: { personId?: string; limit?: number } = {}): SettlementRow[] {
  const { personId, limit = 200 } = opts;
  return db
    .all<{
      id: string;
      personId: string;
      personName: string;
      transactionId: string | null;
      amount: number;
      date: string;
      note: string | null;
    }>(sql`
      SELECT s.id, s.person_id AS personId, p.name AS personName,
             s.transaction_id AS transactionId, s.amount, s.date, s.note
      FROM settlements s
      JOIN people p ON p.id = s.person_id
      ${personId ? sql`WHERE s.person_id = ${personId}` : sql``}
      ORDER BY s.date DESC, s.rowid DESC
      LIMIT ${limit}`)
    .map((r) => ({ ...r, amount: Number(r.amount) }));
}

// ── Repayment suggestions ────────────────────────────────────────────────────

export type SettlementSuggestion = {
  txnId: string;
  date: string;
  displayName: string;
  /** Positive — what landed in your account. */
  amount: number;
  currency: string | null;
  accountName: string | null;
  personId: string;
  personName: string;
  /** Human-readable justification, shown next to the suggestion. */
  reason: string;
  /** Higher = more confident. Suggestions below CONFIDENCE_FLOOR are dropped. */
  score: number;
};

const CONFIDENCE_FLOOR = 2;

/**
 * Dismissals reuse the dismissed_alerts table rather than adding a tombstone
 * table of their own — it's already a keyed "user said no to this" ledger.
 */
export function settlementDismissKey(txnId: string): string {
  return `settle:${txnId}`;
}

/** Lowercased word set of a name, for loose "is this person named here" checks. */
function nameTokens(name: string): string[] {
  return name
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3);
}

/**
 * Propose which uncategorized inflows are friends paying you back.
 *
 * Candidates are money-in transactions on a peer-payment rail that aren't
 * already recorded as a settlement. Each is scored against every person who
 * currently owes you:
 *   +3  the person's name appears in the transaction description (Venmo puts it
 *       there; Zelle usually does too) — by far the strongest signal
 *   +3  the amount exactly matches one of their outstanding shares
 *   +1  the amount is within their outstanding balance (plausible part-payment)
 *   +1  the inflow is dated after the expense that created the debt
 *
 * Only the best-scoring person per transaction is returned, and only above
 * CONFIDENCE_FLOOR — so a bare $20 Venmo with no name match and no amount match
 * stays out of the inbox rather than guessing between three friends.
 */
export function suggestSettlements(limit = 50): SettlementSuggestion[] {
  const balances = getPeopleBalances().filter((p) => p.balance > 0.01);
  if (balances.length === 0) return [];

  const inflows = db.all<{
    id: string;
    date: string;
    name: string;
    merchant: string | null;
    amount: number;
    currency: string | null;
    accountName: string | null;
  }>(sql`
    SELECT t.id, t.date, t.name, t.merchant_name AS merchant, t.amount,
           t.iso_currency_code AS currency, a.name AS accountName
    FROM transactions t
    LEFT JOIN accounts a ON a.id = t.account_id
    WHERE t.amount < 0
      AND t.pending = 0
      AND NOT EXISTS (SELECT 1 FROM settlements s WHERE s.transaction_id = t.id)
      AND NOT EXISTS (
        SELECT 1 FROM transaction_matches m
        WHERE m.status = 'confirmed' AND (m.txn_a_id = t.id OR m.txn_b_id = t.id))
      AND NOT EXISTS (
        SELECT 1 FROM dismissed_alerts d
        WHERE d.alert_key = 'settle:' || t.id AND d.snooze_until IS NULL)
    ORDER BY t.date DESC
    LIMIT 400`);

  // Outstanding per-share amounts, so an exact-figure match can be spotted.
  const shareAmounts = new Map<string, number[]>();
  const shareDates = new Map<string, string[]>();
  for (const r of db.all<{ personId: string; amount: number; date: string }>(sql`
    SELECT es.person_id AS personId, ABS(es.amount) AS amount, t.date
    FROM expense_shares es
    JOIN shared_expenses se ON se.id = es.shared_expense_id
    JOIN transactions t ON t.id = se.transaction_id`)) {
    if (!shareAmounts.has(r.personId)) {
      shareAmounts.set(r.personId, []);
      shareDates.set(r.personId, []);
    }
    shareAmounts.get(r.personId)!.push(Number(r.amount));
    shareDates.get(r.personId)!.push(r.date);
  }

  const out: SettlementSuggestion[] = [];
  for (const txn of inflows) {
    const haystack = `${txn.name} ${txn.merchant ?? ""}`;
    if (!SETTLEMENT_NAME_RE.test(haystack)) continue;
    const lower = haystack.toLowerCase();
    const paid = Math.abs(Number(txn.amount));

    let best: SettlementSuggestion | null = null;
    for (const person of balances) {
      const reasons: string[] = [];
      let score = 0;

      const tokens = nameTokens(person.name);
      const named = tokens.length > 0 && tokens.some((w) => lower.includes(w));
      if (named) {
        score += 3;
        reasons.push(`${person.name} is named on the payment`);
      }
      const handle = person.handle?.toLowerCase().replace(/^@/, "");
      if (handle && handle.length >= 3 && lower.includes(handle)) {
        score += 3;
        reasons.push(`matches handle ${person.handle}`);
      }

      const amounts = shareAmounts.get(person.id) ?? [];
      if (amounts.some((a) => Math.abs(a - paid) < 0.01)) {
        score += 3;
        reasons.push("exactly matches a share they owe");
      } else if (paid <= person.balance + 0.01) {
        score += 1;
        reasons.push("fits within their outstanding balance");
      }

      const dates = shareDates.get(person.id) ?? [];
      if (dates.some((d) => d <= txn.date)) score += 1;

      if (score > (best?.score ?? 0)) {
        best = {
          txnId: txn.id,
          date: txn.date,
          displayName: cleanTransactionName(txn.merchant ?? txn.name),
          amount: paid,
          currency: txn.currency,
          accountName: txn.accountName,
          personId: person.id,
          personName: person.name,
          reason: reasons.join(" · "),
          score,
        };
      }
    }

    if (best && best.score >= CONFIDENCE_FLOOR) out.push(best);
    if (out.length >= limit) break;
  }

  return out.sort((a, b) => b.score - a.score || b.date.localeCompare(a.date));
}
