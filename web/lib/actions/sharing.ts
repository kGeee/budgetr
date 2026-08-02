"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import {
  dismissedAlerts,
  expenseShares,
  people,
  settlements,
  sharedExpenses,
  transactionSplits,
  transactions,
} from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { REIMBURSABLE_CATEGORY_ID, seedReimbursableCategory } from "@/lib/seed-categories-data";
import {
  computeSplit,
  getPeopleBalances,
  getSettlements,
  getSharedExpenseForTransaction,
  getSharedExpenses,
  settlementDismissKey,
  suggestSettlements,
  type PersonBalance,
  type SettlementRow,
  type SettlementSuggestion,
  type SharedExpenseRow,
  type SplitMode,
  type SplitParticipant,
} from "@/lib/sharing";

/**
 * Server Actions for shared expenses — people, bill splits, and repayments.
 *
 * Splitting a bill writes two overlays at once: the shared-expense record (who
 * owes what) and the transaction_splits that make reporting correct (your share
 * at its real category, the rest parked in the reimbursable transfer category).
 * They're written in one DB transaction so the ledger can't disagree with the
 * report.
 */

function revalidateAll() {
  revalidatePath("/", "layout");
}

const id = (prefix: string) => `${prefix}_${crypto.randomUUID().slice(0, 8)}`;

// ── People ───────────────────────────────────────────────────────────────────

export async function createPerson(input: {
  name: string;
  handle?: string | null;
  color?: string | null;
}): Promise<{ ok: boolean; id?: string; error?: string }> {
  const name = input.name.trim();
  if (!name) return { ok: false, error: "Name is required." };

  const dupe = db.get<{ id: string }>(
    sql`SELECT id FROM people WHERE name = ${name} COLLATE NOCASE`,
  );
  if (dupe) return { ok: false, error: `You already have someone called ${name}.` };

  const personId = id("person");
  db.insert(people)
    .values({
      id: personId,
      name,
      handle: input.handle?.trim() || null,
      color: input.color ?? null,
      archived: false,
      createdAt: new Date(),
    })
    .run();
  revalidateAll();
  return { ok: true, id: personId };
}

export async function updatePerson(
  personId: string,
  patch: { name?: string; handle?: string | null; color?: string | null; archived?: boolean },
): Promise<{ ok: boolean; error?: string }> {
  const set: Record<string, unknown> = {};
  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (!name) return { ok: false, error: "Name is required." };
    set.name = name;
  }
  if (patch.handle !== undefined) set.handle = patch.handle?.trim() || null;
  if (patch.color !== undefined) set.color = patch.color;
  if (patch.archived !== undefined) set.archived = patch.archived;
  if (Object.keys(set).length === 0) return { ok: true };

  db.update(people).set(set).where(eq(people.id, personId)).run();
  revalidateAll();
  return { ok: true };
}

/**
 * Delete a person outright. Refused while they still have history — archiving is
 * the right move there, since deleting would cascade away shares and settlements
 * and silently change past reporting.
 */
export async function deletePerson(personId: string): Promise<{ ok: boolean; error?: string }> {
  const usage = db.get<{ n: number }>(sql`
    SELECT (SELECT COUNT(*) FROM expense_shares WHERE person_id = ${personId})
         + (SELECT COUNT(*) FROM settlements WHERE person_id = ${personId}) AS n`);
  if ((usage?.n ?? 0) > 0) {
    return {
      ok: false,
      error: "They're on past splits — archive them instead to keep the history intact.",
    };
  }
  db.delete(people).where(eq(people.id, personId)).run();
  revalidateAll();
  return { ok: true };
}

export async function loadPeopleBalances(): Promise<PersonBalance[]> {
  return getPeopleBalances();
}

// ── Splitting a bill ─────────────────────────────────────────────────────────

export type SaveSplitInput = {
  txnId: string;
  mode: SplitMode;
  participants: SplitParticipant[];
  /** Category your own share reports under. Defaults to the txn's current one. */
  myCategoryId?: string | null;
  note?: string | null;
};

/**
 * Record (or re-record) a bill split on a transaction.
 *
 * Replaces any existing split on that transaction wholesale — including plain
 * category splits, which is why the UI warns first. The transaction_splits it
 * writes always reconcile to the parent amount, matching the invariant
 * setTransactionSplits enforces in lib/actions.ts.
 */
export async function saveSharedExpense(
  input: SaveSplitInput,
): Promise<{ ok: boolean; error?: string }> {
  const txn = db
    .select({ amount: transactions.amount, userCategoryId: transactions.userCategoryId })
    .from(transactions)
    .where(eq(transactions.id, input.txnId))
    .get();
  if (!txn) return { ok: false, error: "Transaction not found." };

  const computed = computeSplit(txn.amount, input.mode, input.participants);
  if (!computed.ok) return { ok: false, error: computed.error };
  const { myShare, shares } = computed.split;

  // The category the reimbursable slice parks in must exist before we point at
  // it — an install that predates the splitter won't have been re-seeded.
  seedReimbursableCategory();

  const owedTotal = Math.round(shares.reduce((a, s) => a + s.amount, 0) * 100) / 100;
  const myCategoryId =
    input.myCategoryId !== undefined ? input.myCategoryId : (txn.userCategoryId ?? null);

  db.transaction((t) => {
    t.delete(sharedExpenses).where(eq(sharedExpenses.transactionId, input.txnId)).run();
    t.delete(transactionSplits).where(eq(transactionSplits.transactionId, input.txnId)).run();

    const expenseId = id("shexp");
    t.insert(sharedExpenses)
      .values({
        id: expenseId,
        transactionId: input.txnId,
        myShare,
        note: input.note?.trim() || null,
        itemsJson: null,
        createdAt: new Date(),
      })
      .run();

    for (const s of shares) {
      t.insert(expenseShares)
        .values({
          id: id("share"),
          sharedExpenseId: expenseId,
          personId: s.personId,
          amount: s.amount,
        })
        .run();
    }

    // Reporting overlay. Your share keeps its real category; the reimbursable
    // remainder goes to the transfer-group category so it leaves spend totals.
    // A zero share (you paid but didn't partake) contributes no row — splits
    // must be non-zero, and the reimbursable row alone still reconciles.
    if (Math.abs(myShare) >= 0.005) {
      t.insert(transactionSplits)
        .values({
          id: id("split"),
          transactionId: input.txnId,
          categoryId: myCategoryId,
          amount: myShare,
          note: "Your share",
        })
        .run();
    }
    t.insert(transactionSplits)
      .values({
        id: id("split"),
        transactionId: input.txnId,
        categoryId: REIMBURSABLE_CATEGORY_ID,
        amount: owedTotal,
        note: `Owed by ${shares.length} ${shares.length === 1 ? "person" : "people"}`,
      })
      .run();
  });

  revalidateAll();
  return { ok: true };
}

/** Un-share a transaction: drops the split record and its reporting overlay. */
export async function removeSharedExpense(txnId: string): Promise<void> {
  db.transaction((t) => {
    t.delete(sharedExpenses).where(eq(sharedExpenses.transactionId, txnId)).run();
    t.delete(transactionSplits).where(eq(transactionSplits.transactionId, txnId)).run();
  });
  revalidateAll();
}

export async function loadSharedExpense(txnId: string): Promise<SharedExpenseRow | null> {
  return getSharedExpenseForTransaction(txnId);
}

export async function loadSharedExpenses(personId?: string): Promise<SharedExpenseRow[]> {
  return getSharedExpenses({ personId });
}

// ── Repayments ───────────────────────────────────────────────────────────────

/**
 * Record a repayment. When it's tied to a real inflow we also categorize that
 * transaction as reimbursable, which is what cancels it against the money you
 * fronted — without it the repayment would read as income.
 */
export async function recordSettlement(input: {
  personId: string;
  txnId?: string | null;
  amount: number;
  date: string;
  note?: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  const amount = Math.abs(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, error: "Enter an amount above zero." };
  }
  if (!input.personId) return { ok: false, error: "Pick who paid you back." };

  if (input.txnId) {
    const taken = db.get<{ id: string }>(
      sql`SELECT id FROM settlements WHERE transaction_id = ${input.txnId}`,
    );
    if (taken) return { ok: false, error: "That payment is already recorded as a repayment." };
  }

  seedReimbursableCategory();

  db.transaction((t) => {
    t.insert(settlements)
      .values({
        id: id("settle"),
        personId: input.personId,
        transactionId: input.txnId ?? null,
        amount,
        date: input.date,
        note: input.note?.trim() || null,
        createdAt: new Date(),
      })
      .run();

    if (input.txnId) {
      t.update(transactions)
        .set({ userCategoryId: REIMBURSABLE_CATEGORY_ID, reviewed: true })
        .where(eq(transactions.id, input.txnId))
        .run();
    }
  });

  revalidateAll();
  return { ok: true };
}

/**
 * Undo a repayment. The inflow's category is deliberately left as reimbursable —
 * re-guessing what it used to be would be wrong more often than not, and the
 * category picker is right there.
 */
export async function removeSettlement(settlementId: string): Promise<void> {
  db.delete(settlements).where(eq(settlements.id, settlementId)).run();
  revalidateAll();
}

export async function loadSettlements(personId?: string): Promise<SettlementRow[]> {
  return getSettlements({ personId });
}

export async function loadSettlementSuggestions(): Promise<SettlementSuggestion[]> {
  return suggestSettlements();
}

/** Confirm a suggestion exactly as proposed. */
export async function confirmSettlementSuggestion(
  s: Pick<SettlementSuggestion, "txnId" | "personId" | "amount" | "date">,
): Promise<{ ok: boolean; error?: string }> {
  return recordSettlement({
    personId: s.personId,
    txnId: s.txnId,
    amount: s.amount,
    date: s.date,
  });
}

/** Tombstone a suggestion so it stops resurfacing. Reporting is untouched. */
export async function dismissSettlementSuggestion(txnId: string): Promise<void> {
  db.insert(dismissedAlerts)
    .values({
      id: id("alert"),
      alertKey: settlementDismissKey(txnId),
      dismissedAt: new Date(),
      snoozeUntil: null,
    })
    .onConflictDoUpdate({
      target: dismissedAlerts.alertKey,
      set: { dismissedAt: new Date(), snoozeUntil: null },
    })
    .run();
  revalidateAll();
}
