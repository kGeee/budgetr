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
import { categories, dismissedAlerts, transactions } from "@/db/schema";
import { eq } from "drizzle-orm";
import type { Op } from "@budgetr/core";
import { appendAppliedOpIds, getAppliedOpIds } from "./store";

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
      }
      // Unknown kinds can't reach here: assertValidOutbox rejects them upstream.
    }

    // Record every op id from the batch — applied, skipped, or unknown-target —
    // inside the same transaction as the mutations.
    appendAppliedOpIds(ops.map((o) => o.id));
  });

  return { mutated };
}
