// Applies a decrypted, validated OutboxBatch to the real DB (spec T4).
//
// Semantics:
//  - Idempotent: op ids already recorded are skipped; every op in a batch is
//    recorded as applied afterwards (even unknown-target ones), so a
//    redelivered batch is a no-op and the phone can always clear its outbox.
//  - Unknown txn/alert/category ids are recorded-and-skipped, never an error —
//    the referenced row may have been deleted since the phone's summary.
//  - Everything runs in one SQLite transaction with the applied-ids write, so
//    a crash mid-apply can never half-apply a batch (spec kill-test).
//
// Known deviation from spec §T4 "desktop wins conflicts": transactions carry
// no updated-at column, so we can't detect that the desktop re-categorized
// after the phone's edit — the op applies (phone-wins). Single-user, both
// edits are the same human; revisit if transactions ever grow updatedAt.

import { db } from "@/db";
import {
  categories,
  dismissedAlerts,
  expenseShares,
  people,
  settlements,
  sharedExpenses,
  transactionSplits,
  transactions,
} from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import type { Op } from "@budgetr/core";
import { REIMBURSABLE_CATEGORY_ID, seedReimbursableCategory } from "@/lib/seed-categories-data";
import { appendAppliedOpIds, getAppliedOpIds } from "./store";

const newId = (prefix: string) => `${prefix}_${crypto.randomUUID().slice(0, 8)}`;

export function applyOps(ops: Op[]): { mutated: number } {
  const already = new Set(getAppliedOpIds());
  let mutated = 0;

  db.transaction((tx) => {
    // Apply in the order the user made the edits, regardless of batch order.
    for (const op of [...ops].sort((a, b) => a.ts - b.ts)) {
      if (already.has(op.id)) continue;
      already.add(op.id);

      if (op.kind === "recategorize") {
        const txn = tx.select({ id: transactions.id }).from(transactions).where(eq(transactions.id, op.txnId)).get();
        const cat = tx.select({ id: categories.id }).from(categories).where(eq(categories.id, op.toCategory)).get();
        if (!txn || !cat) continue; // deleted since the phone saw it — ack and move on
        tx.update(transactions)
          .set({ userCategoryId: op.toCategory, reviewed: true })
          .where(eq(transactions.id, op.txnId))
          .run();
        mutated += 1;
      } else if (op.kind === "dismissAlert") {
        // Same write as lib/actions-alerts.ts dismissAlert — alertId is the alertKey.
        tx.insert(dismissedAlerts)
          .values({
            id: `alert_${crypto.randomUUID().slice(0, 8)}`,
            alertKey: op.alertId,
            dismissedAt: new Date(),
            snoozeUntil: null,
          })
          .onConflictDoUpdate({
            target: dismissedAlerts.alertKey,
            set: { dismissedAt: new Date(), snoozeUntil: null },
          })
          .run();
        mutated += 1;
      } else if (op.kind === "splitBill") {
        const txn = tx
          .select({ id: transactions.id, amount: transactions.amount, cat: transactions.userCategoryId })
          .from(transactions)
          .where(eq(transactions.id, op.txnId))
          .get();
        if (!txn) continue; // deleted since the phone saw it

        // Every person must still exist. A share pointing at a deleted person
        // would silently vanish from the balances while still leaving the
        // transaction marked as split.
        const known = op.shares.filter(
          (sh) => tx.select({ id: people.id }).from(people).where(eq(people.id, sh.personId)).get() != null,
        );
        if (known.length === 0) continue;

        seedReimbursableCategory();

        const sign = txn.amount < 0 ? -1 : 1;
        // The phone computed these cents with the shared allocator; the desktop
        // stores them rather than re-deriving, so the two can never disagree.
        const shares = known.map((sh) => ({ personId: sh.personId, amount: (sh.cents / 100) * sign }));
        const owed = shares.reduce((a, sh) => a + sh.amount, 0);
        // A pending tip means the split can be computed over more than the
        // transaction currently records — see SplitBillOp.basisCents.
        const basis = op.basisCents != null ? (Math.abs(op.basisCents) / 100) * sign : txn.amount;
        const myShare = Math.round((basis - owed) * 100) / 100;

        tx.delete(sharedExpenses).where(eq(sharedExpenses.transactionId, op.txnId)).run();
        tx.delete(transactionSplits).where(eq(transactionSplits.transactionId, op.txnId)).run();

        const expenseId = newId("shexp");
        tx.insert(sharedExpenses)
          .values({
            id: expenseId,
            transactionId: op.txnId,
            myShare,
            note: op.note?.trim() || null,
            itemsJson: op.itemsJson ?? null,
            createdAt: new Date(),
          })
          .run();
        for (const sh of shares) {
          tx.insert(expenseShares)
            .values({ id: newId("share"), sharedExpenseId: expenseId, personId: sh.personId, amount: sh.amount })
            .run();
        }

        // The reporting overlay reconciles to the TRANSACTION, never the basis —
        // splits that don't sum to their parent corrupt every spend query.
        const scale = Math.abs(basis) > 0.004 ? txn.amount / basis : 1;
        const myOverlay = Math.round(myShare * scale * 100) / 100;
        const owedOverlay = Math.round((txn.amount - myOverlay) * 100) / 100;
        if (Math.abs(myOverlay) >= 0.005) {
          tx.insert(transactionSplits)
            .values({
              id: newId("split"),
              transactionId: op.txnId,
              categoryId: txn.cat ?? null,
              amount: myOverlay,
              note: "Your share",
            })
            .run();
        }
        tx.insert(transactionSplits)
          .values({
            id: newId("split"),
            transactionId: op.txnId,
            categoryId: REIMBURSABLE_CATEGORY_ID,
            amount: owedOverlay,
            note: `Owed by ${shares.length} ${shares.length === 1 ? "person" : "people"}`,
          })
          .run();
        mutated += 1;
      } else if (op.kind === "recordSettlement") {
        const person = tx.select({ id: people.id }).from(people).where(eq(people.id, op.personId)).get();
        if (!person) continue;
        // One repayment per inflow. Re-confirming a suggestion the desktop
        // already recorded must not double-credit the balance.
        if (op.txnId) {
          const taken = tx
            .select({ id: settlements.id })
            .from(settlements)
            .where(eq(settlements.transactionId, op.txnId))
            .get();
          if (taken) continue;
        }
        seedReimbursableCategory();
        tx.insert(settlements)
          .values({
            id: newId("settle"),
            personId: op.personId,
            transactionId: op.txnId ?? null,
            amount: op.cents / 100,
            date: new Date(op.ts * 1000).toISOString().slice(0, 10),
            note: null,
            createdAt: new Date(),
          })
          .run();
        if (op.txnId) {
          tx.update(transactions)
            .set({ userCategoryId: REIMBURSABLE_CATEGORY_ID, reviewed: true })
            .where(eq(transactions.id, op.txnId))
            .run();
        }
        mutated += 1;
      }
      // scanReceipt is handled outside this transaction — it needs to shell out
      // to the OCR helper, which cannot happen inside a SQLite write.
      // Unknown kinds can't reach here: assertValidOutbox rejects them upstream.
    }

    // Record every op id from the batch — applied, skipped, or unknown-target —
    // inside the same transaction as the mutations.
    appendAppliedOpIds(ops.map((o) => o.id));
  });

  return { mutated };
}
