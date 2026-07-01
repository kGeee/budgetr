import { db } from "@/db";
import { sql } from "drizzle-orm";
import { cleanTransactionName } from "@/lib/utils";

/**
 * Refund & transfer matching — de-dupe offsetting +/- transactions.
 *
 * Two real transactions can cancel each other out:
 *  - a `transfer` between your own accounts (money out of one, in to another), or
 *  - a `refund` reversing an earlier purchase (same account).
 * Counting both sides double-counts, so once a pair is *confirmed* in
 * transaction_matches both legs are excluded from cashflow and category spend
 * (see lib/queries.ts). This module computes the candidate pairs and exposes the
 * set of confirmed-matched transaction ids for those exclusions.
 */

const DATE_WINDOW_DAYS = 5;

export type MatchKind = "refund" | "transfer";

export type MatchSuggestion = {
  kind: MatchKind;
  /** The two legs, `a` always the earlier/positive-outflow-ish side by query order. */
  a: MatchLeg;
  b: MatchLeg;
  /** Whole-days between the two transaction dates. */
  daysApart: number;
};

export type MatchLeg = {
  id: string;
  date: string;
  displayName: string;
  amount: number;
  currency: string | null;
  accountName: string | null;
};

/**
 * Suggest offsetting pairs not already recorded (confirmed OR dismissed) in
 * transaction_matches. A pair qualifies when the two amounts are exact negatives
 * (equal magnitude, opposite sign) within DATE_WINDOW_DAYS days and either:
 *  - different accounts → a `transfer`, or
 *  - same account → a `refund`.
 *
 * Self-join is ordered `a.amount > b.amount` so the outflow (positive, Plaid
 * convention) is always the `a` leg and each pair surfaces once. Pending rows are
 * excluded — they're not final. Legs already claimed by a confirmed match are
 * skipped so one transaction can't be suggested for two different matches.
 */
export function suggestMatches(limit = 50): MatchSuggestion[] {
  const rows = db.all<{
    kind: MatchKind;
    aId: string;
    aDate: string;
    aName: string;
    aMerchant: string | null;
    aAmount: number;
    aCurrency: string | null;
    aAccount: string | null;
    bId: string;
    bDate: string;
    bName: string;
    bMerchant: string | null;
    bAmount: number;
    bCurrency: string | null;
    bAccount: string | null;
    daysApart: number;
  }>(sql`
    SELECT
      CASE WHEN a.account_id = b.account_id THEN 'refund' ELSE 'transfer' END AS kind,
      a.id AS aId, a.date AS aDate, a.name AS aName, a.merchant_name AS aMerchant,
      a.amount AS aAmount, a.iso_currency_code AS aCurrency, aa.name AS aAccount,
      b.id AS bId, b.date AS bDate, b.name AS bName, b.merchant_name AS bMerchant,
      b.amount AS bAmount, b.iso_currency_code AS bCurrency, ba.name AS bAccount,
      CAST(ABS(julianday(a.date) - julianday(b.date)) AS INTEGER) AS daysApart
    FROM transactions a
    JOIN transactions b
      ON b.amount = -a.amount
     AND b.id != a.id
     AND ABS(julianday(a.date) - julianday(b.date)) <= ${DATE_WINDOW_DAYS}
    LEFT JOIN accounts aa ON aa.id = a.account_id
    LEFT JOIN accounts ba ON ba.id = b.account_id
    WHERE a.amount > 0 AND a.pending = 0 AND b.pending = 0
      AND NOT EXISTS (
        SELECT 1 FROM transaction_matches m
        WHERE (m.txn_a_id = a.id AND m.txn_b_id = b.id)
           OR (m.txn_a_id = b.id AND m.txn_b_id = a.id)
      )
      AND NOT EXISTS (
        SELECT 1 FROM transaction_matches m
        WHERE m.status = 'confirmed'
          AND (m.txn_a_id IN (a.id, b.id) OR m.txn_b_id IN (a.id, b.id))
      )
    ORDER BY ABS(julianday(a.date) - julianday(b.date)) ASC, a.date DESC, a.id DESC
    LIMIT ${limit}`);

  // A single transaction can pair with several candidates (e.g. two identical
  // $20 refunds); greedily keep the first (closest-dated) pairing per leg so the
  // review list never proposes conflicting matches.
  const claimed = new Set<string>();
  const out: MatchSuggestion[] = [];
  for (const r of rows) {
    if (claimed.has(r.aId) || claimed.has(r.bId)) continue;
    claimed.add(r.aId);
    claimed.add(r.bId);
    out.push({
      kind: r.kind,
      daysApart: Number(r.daysApart),
      a: {
        id: r.aId,
        date: r.aDate,
        displayName: cleanTransactionName(r.aName, r.aMerchant),
        amount: Number(r.aAmount),
        currency: r.aCurrency,
        accountName: r.aAccount,
      },
      b: {
        id: r.bId,
        date: r.bDate,
        displayName: cleanTransactionName(r.bName, r.bMerchant),
        amount: Number(r.bAmount),
        currency: r.bCurrency,
        accountName: r.bAccount,
      },
    });
  }
  return out;
}

/**
 * The ids of every transaction on a *confirmed* match (both legs). Used by the
 * reporting queries to exclude matched transfers/refunds so they don't count as
 * spend or income.
 */
export function matchedTxnIds(): Set<string> {
  const rows = db.all<{ id: string }>(sql`
    SELECT txn_a_id AS id FROM transaction_matches WHERE status = 'confirmed'
    UNION
    SELECT txn_b_id AS id FROM transaction_matches WHERE status = 'confirmed'`);
  return new Set(rows.map((r) => r.id));
}

export type MatchCounterpart = {
  matchId: string;
  kind: MatchKind;
  txnId: string;
  date: string;
  displayName: string;
  amount: number;
  currency: string | null;
  accountName: string | null;
};

/**
 * The confirmed-match counterpart of a transaction (the other leg), or null if it
 * isn't part of a confirmed match. Powers the "linked to …" row + Unmatch control
 * in the transaction detail drawer.
 */
export function getMatchCounterpart(txnId: string): MatchCounterpart | null {
  const r = db.get<{
    matchId: string;
    kind: MatchKind;
    txnId: string;
    date: string;
    name: string;
    merchant: string | null;
    amount: number;
    currency: string | null;
    accountName: string | null;
  }>(sql`
    SELECT m.id AS matchId, m.kind AS kind,
           o.id AS txnId, o.date AS date, o.name AS name, o.merchant_name AS merchant,
           o.amount AS amount, o.iso_currency_code AS currency, a.name AS accountName
    FROM transaction_matches m
    JOIN transactions o
      ON o.id = CASE WHEN m.txn_a_id = ${txnId} THEN m.txn_b_id ELSE m.txn_a_id END
    LEFT JOIN accounts a ON a.id = o.account_id
    WHERE m.status = 'confirmed'
      AND (m.txn_a_id = ${txnId} OR m.txn_b_id = ${txnId})
    LIMIT 1`);
  if (!r) return null;
  return {
    matchId: r.matchId,
    kind: r.kind,
    txnId: r.txnId,
    date: r.date,
    displayName: cleanTransactionName(r.name, r.merchant),
    amount: Number(r.amount),
    currency: r.currency,
    accountName: r.accountName,
  };
}
