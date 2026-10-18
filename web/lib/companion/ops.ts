// Applies a decrypted, validated OutboxBatch to the real DB (spec T4).
//
// Semantics:
//  - An op id is recorded as applied — and so echoed in Summary.appliedOpIds,
//    which is the only thing that clears it from the phone's outbox — only
//    once its effect is in the desktop's state: it wrote, or what it asked for
//    is already true (a re-delivered addPerson, a repayment already recorded
//    against that inflow).
//  - An op that can't apply yet is left unrecorded, never an error. The phone
//    keeps it queued and resends it on every sync, so it lands once whatever
//    it names exists (a person added in a batch still in flight), and the user
//    can discard it on the phone if its target is gone for good. Recording it
//    instead would let the phone drop an edit the desktop never made.
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
import { appendAppliedOpIds, getAppliedOpIds, getPersonAliases, setPersonAlias } from "./store";

const newId = (prefix: string) => `${prefix}_${crypto.randomUUID().slice(0, 8)}`;

export interface ApplyResult {
  mutated: number;
  /** Op ids now recorded as applied (this call only). */
  applied: string[];
  /** Op ids that couldn't apply yet and stay queued on the phone. */
  deferred: string[];
}

export function applyOps(ops: Op[]): ApplyResult {
  const already = new Set(getAppliedOpIds());
  let mutated = 0;
  const applied: string[] = [];
  const deferred: string[] = [];
  // Phone-minted person ids the desktop resolved to someone it already had
  // (same name), from this batch or any earlier one.
  const alias = new Map(Object.entries(getPersonAliases()));
  const who = (id: string) => alias.get(id) ?? id;

  db.transaction((tx) => {
    const personExists = (id: string) =>
      tx.select({ id: people.id }).from(people).where(eq(people.id, id)).get() != null;
    const sameName = (name: string) =>
      tx.get<{ id: string }>(sql`SELECT id FROM people WHERE name = ${name.trim()} COLLATE NOCASE`);
    const remember = (phoneId: string, personId: string) => {
      alias.set(phoneId, personId);
      setPersonAlias(phoneId, personId);
    };

    const seen = new Set<string>();
    // Apply in the order the user made the edits, regardless of batch order.
    for (const op of [...ops].sort((a, b) => a.ts - b.ts)) {
      if (seen.has(op.id)) continue;
      seen.add(op.id);

      if (already.has(op.id)) {
        // An addPerson applied before aliases were persisted left no mapping
        // behind. Re-resolve it by name (read-only) so the ops that follow it
        // still find their person.
        if (op.kind === "addPerson" && !alias.has(op.personId) && !personExists(op.personId)) {
          const dupe = sameName(op.name);
          if (dupe) remember(op.personId, dupe.id);
        }
        continue;
      }

      // scanReceipt is handled outside this transaction — it needs to shell out
      // to the OCR helper, which cannot happen inside a SQLite write — and
      // processScans records it once answered.
      // Unknown kinds can't reach here: assertValidOutbox rejects them upstream.
      if (op.kind === "scanReceipt") continue;

      const done = (() => {
        if (op.kind === "recategorize") {
          const txn = tx.select({ id: transactions.id }).from(transactions).where(eq(transactions.id, op.txnId)).get();
          const cat = tx.select({ id: categories.id }).from(categories).where(eq(categories.id, op.toCategory)).get();
          if (!txn || !cat) return false;
          tx.update(transactions)
            .set({ userCategoryId: op.toCategory, reviewed: true })
            .where(eq(transactions.id, op.txnId))
            .run();
          mutated += 1;
          return true;
        }

        if (op.kind === "dismissAlert") {
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
          return true;
        }

        if (op.kind === "addPerson") {
          if (personExists(op.personId)) return true; // re-delivered under a new op id
          const name = op.name.trim();
          // Same rule as the desktop's createPerson: names are unique, ignoring
          // case. Adding "maya" from the phone means the Maya you already have.
          const dupe = sameName(name);
          if (dupe) {
            remember(op.personId, dupe.id);
            if (op.handle?.trim()) {
              const cur = tx.select({ handle: people.handle }).from(people).where(eq(people.id, dupe.id)).get();
              if (!cur?.handle) tx.update(people).set({ handle: op.handle.trim() }).where(eq(people.id, dupe.id)).run();
            }
            return true;
          }
          tx.insert(people)
            .values({
              id: op.personId,
              name,
              handle: op.handle?.trim() || null,
              color: op.color ?? null,
              archived: false,
              createdAt: new Date(op.ts * 1000),
            })
            .run();
          mutated += 1;
          return true;
        }

        if (op.kind === "splitBill") {
          const txn = tx
            .select({ id: transactions.id, amount: transactions.amount, cat: transactions.userCategoryId })
            .from(transactions)
            .where(eq(transactions.id, op.txnId))
            .get();
          if (!txn) return false;

          // Every person must exist, or the split waits. Dropping the unknown
          // shares would store a split that doesn't add up to what the phone
          // asked for and then clear the original from the phone.
          const resolved = op.shares.map((sh) => ({ ...sh, personId: who(sh.personId) }));
          if (!resolved.every((sh) => personExists(sh.personId))) return false;

          seedReimbursableCategory();

          const sign = txn.amount < 0 ? -1 : 1;
          // The phone computed these cents with the shared allocator; the desktop
          // stores them rather than re-deriving, so the two can never disagree.
          const shares = resolved.map((sh) => ({ personId: sh.personId, amount: (sh.cents / 100) * sign }));
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
          return true;
        }

        if (op.kind === "recordSettlement") {
          const personId = who(op.personId);
          if (!personExists(personId)) return false;
          // One repayment per inflow. Re-confirming a suggestion the desktop
          // already recorded must not double-credit the balance.
          if (op.txnId) {
            const taken = tx
              .select({ id: settlements.id })
              .from(settlements)
              .where(eq(settlements.transactionId, op.txnId))
              .get();
            if (taken) return true;
          }
          seedReimbursableCategory();
          tx.insert(settlements)
            .values({
              id: newId("settle"),
              personId,
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
          return true;
        }

        return false;
      })();

      if (done) {
        applied.push(op.id);
        already.add(op.id);
      } else {
        deferred.push(op.id);
      }
    }

    // Same transaction as the mutations: an op is never recorded without its
    // effect, nor its effect written without the record.
    appendAppliedOpIds(applied);
  });

  return { mutated, applied, deferred };
}
