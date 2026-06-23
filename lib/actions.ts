"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import {
  budgets,
  categories,
  tagBudgets,
  tagRules,
  tags,
  transactionTags,
  transactions,
} from "@/db/schema";
import { and, eq, inArray, sql } from "drizzle-orm";
import { applyTagRules } from "@/lib/tag-rules";
import { cleanTransactionName } from "@/lib/utils";

/**
 * Server Actions for budgetr's user overlay (categories, review status, tags,
 * notes, budgets). Each mutation writes to the local SQLite DB and then
 * revalidates the whole app — pages are `force-dynamic`, and revalidating the
 * root layout also refreshes the sidebar's account/nav data.
 *
 * Populated per phase: Phase 1 (categories), Phase 2 (review/tags/notes),
 * Phase 3 (budgets).
 */

/** Invalidate every route + the layout so server components re-read the DB. */
function revalidateAll() {
  revalidatePath("/", "layout");
}

// ── Categories ──────────────────────────────────────────────────────────────

type CategoryGroup = "income" | "spending" | "transfer";

/** Create a user category (no Plaid mapping). Returns the new id. */
export async function createCategory(name: string, group: CategoryGroup = "spending") {
  const trimmed = name.trim();
  if (!trimmed) return;
  const id = `cat_user_${crypto.randomUUID().slice(0, 8)}`;
  const max = db.get<{ m: number }>(sql`SELECT COALESCE(MAX(sort_order), 0) AS m FROM categories`);
  db.insert(categories)
    .values({ id, name: trimmed, group, sortOrder: (max?.m ?? 0) + 1, archived: false })
    .run();
  revalidateAll();
  return id;
}

export async function renameCategory(id: string, name: string) {
  const trimmed = name.trim();
  if (!trimmed) return;
  db.update(categories).set({ name: trimmed }).where(eq(categories.id, id)).run();
  revalidateAll();
}

export async function setCategoryIcon(id: string, icon: string) {
  db.update(categories).set({ icon }).where(eq(categories.id, id)).run();
  revalidateAll();
}

/** Soft-delete: hide from pickers/reports. Transaction overrides FK set null on hard delete only. */
export async function archiveCategory(id: string) {
  db.update(categories).set({ archived: true }).where(eq(categories.id, id)).run();
  revalidateAll();
}

export async function unarchiveCategory(id: string) {
  db.update(categories).set({ archived: false }).where(eq(categories.id, id)).run();
  revalidateAll();
}

// ── Transaction review / overlay ──────────────────────────────────────────────

/** Mark one or more transactions reviewed (or un-reviewed). */
export async function setReviewed(ids: string[], reviewed: boolean) {
  if (ids.length === 0) return;
  db.update(transactions)
    .set({ reviewed })
    .where(inArray(transactions.id, ids))
    .run();
  revalidateAll();
}

/** Override a transaction's category (null clears the override → falls back to Plaid mapping). */
export async function setTransactionCategory(txnId: string, categoryId: string | null) {
  db.update(transactions)
    .set({ userCategoryId: categoryId })
    .where(eq(transactions.id, txnId))
    .run();
  revalidateAll();
}

export async function setTransactionNotes(txnId: string, notes: string) {
  const trimmed = notes.trim();
  db.update(transactions)
    .set({ notes: trimmed || null })
    .where(eq(transactions.id, txnId))
    .run();
  revalidateAll();
}

// ── Tags ──────────────────────────────────────────────────────────────────────

/** Find-or-create a tag by name (case-insensitive), returning its id. */
function ensureTag(name: string): string {
  const trimmed = name.trim();
  const existing = db.get<{ id: string }>(
    sql`SELECT id FROM tags WHERE lower(name) = lower(${trimmed}) LIMIT 1`,
  );
  if (existing) return existing.id;
  const id = `tag_${crypto.randomUUID().slice(0, 8)}`;
  db.insert(tags).values({ id, name: trimmed }).run();
  return id;
}

/** Attach a tag (by name) to a transaction, creating the tag if new. */
export async function addTagToTransaction(txnId: string, name: string) {
  if (!name.trim()) return;
  const tagId = ensureTag(name);
  db.insert(transactionTags)
    .values({ transactionId: txnId, tagId })
    .onConflictDoNothing()
    .run();
  revalidateAll();
}

export async function removeTagFromTransaction(txnId: string, tagId: string) {
  db.delete(transactionTags)
    .where(and(eq(transactionTags.transactionId, txnId), eq(transactionTags.tagId, tagId)))
    .run();
  revalidateAll();
}

// ── Auto-tag rules ────────────────────────────────────────────────────────────

/**
 * Create a rule from a transaction's vendor ("always tag this vendor"), then
 * backfill the tag onto every existing matching transaction.
 */
export async function createTagRuleFromTransaction(txnId: string, tagName: string) {
  const trimmed = tagName.trim();
  if (!trimmed) return;
  const tx = db
    .select({ merchantName: transactions.merchantName, name: transactions.name })
    .from(transactions)
    .where(eq(transactions.id, txnId))
    .get();
  if (!tx) return;

  // Match on the cleanest vendor signal available.
  const pattern = (tx.merchantName?.trim() || cleanTransactionName(tx.name, null)).toLowerCase();
  if (!pattern) return;
  const label = cleanTransactionName(tx.name, tx.merchantName);
  const tagId = ensureTag(trimmed);

  db.insert(tagRules)
    .values({ id: `rule_${crypto.randomUUID().slice(0, 8)}`, pattern, label, tagId, createdAt: new Date() })
    .run();
  applyTagRules(); // backfill all existing transactions
  revalidateAll();
}

/** Manually create a rule: when merchant/name contains `pattern`, apply `tagName`. */
export async function createTagRule(pattern: string, tagName: string) {
  const p = pattern.trim().toLowerCase();
  const t = tagName.trim();
  if (!p || !t) return;
  const tagId = ensureTag(t);
  db.insert(tagRules)
    .values({ id: `rule_${crypto.randomUUID().slice(0, 8)}`, pattern: p, label: pattern.trim(), tagId, createdAt: new Date() })
    .run();
  applyTagRules();
  revalidateAll();
}

export async function deleteTagRule(id: string) {
  db.delete(tagRules).where(eq(tagRules.id, id)).run();
  revalidateAll();
}

// ── Budgets ─────────────────────────────────────────────────────────────────

/** Set (or update) the monthly budget for a category. amount <= 0 clears it. */
export async function setBudget(categoryId: string, amount: number) {
  if (!Number.isFinite(amount) || amount <= 0) {
    return clearBudget(categoryId);
  }
  db.insert(budgets)
    .values({ id: `bud_${categoryId}`, categoryId, amount })
    .onConflictDoUpdate({ target: budgets.categoryId, set: { amount } })
    .run();
  revalidateAll();
}

export async function clearBudget(categoryId: string) {
  db.delete(budgets).where(eq(budgets.categoryId, categoryId)).run();
  revalidateAll();
}

/** Set (or update) the monthly budget for a tag. amount <= 0 clears it. */
export async function setTagBudget(tagId: string, amount: number) {
  if (!Number.isFinite(amount) || amount <= 0) {
    return clearTagBudget(tagId);
  }
  db.insert(tagBudgets)
    .values({ id: `tagbud_${tagId}`, tagId, amount })
    .onConflictDoUpdate({ target: tagBudgets.tagId, set: { amount } })
    .run();
  revalidateAll();
}

export async function clearTagBudget(tagId: string) {
  db.delete(tagBudgets).where(eq(tagBudgets.tagId, tagId)).run();
  revalidateAll();
}
