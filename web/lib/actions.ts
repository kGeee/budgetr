"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import {
  budgets,
  categories,
  holdingCostBasisOverrides,
  investmentSectors,
  manualHoldings,
  tagBudgets,
  tagRules,
  tags,
  transactionTags,
  transactions,
  vendorGroupMembers,
  vendorGroups,
} from "@/db/schema";
import { and, eq, inArray, sql } from "drizzle-orm";
import { applyTagRules } from "@/lib/tag-rules";
import { cleanTransactionName } from "@/lib/utils";
import {
  getCategoryDailySpend,
  getCategoryMonthlyBreakdown,
  getCategoryTransactions,
  getTransactionsByDate,
  type CategoryDay,
  type CategoryMonth,
  type TransactionRow,
} from "@/lib/queries";

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

/**
 * Lazily load a category's monthly breakdown + transactions for the inline
 * expandable panels on the Categories and Budgets pages. Read-only — it just
 * wraps the queries so client components can fetch on demand when a row opens.
 */
export async function getTransactionsForDate(date: string): Promise<TransactionRow[]> {
  return getTransactionsByDate(date);
}

export async function getCategoryDetail(
  categoryId: string,
): Promise<{ days: CategoryDay[]; months: CategoryMonth[]; txns: TransactionRow[] }> {
  return {
    days: getCategoryDailySpend(categoryId),
    months: getCategoryMonthlyBreakdown(categoryId),
    txns: getCategoryTransactions(categoryId),
  };
}

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

export type VendorReclass = { vendorName: string; count: number };

/**
 * After categorizing one transaction, count OTHER transactions from the same
 * vendor (group-aware) that currently resolve to a *different* category — i.e.
 * candidates to bulk-apply the same category to. Returns null when there are
 * none. The vendor is derived from the transaction itself, so this works on any
 * page, not just Vendors.
 */
export async function getVendorReclassCount(
  txnId: string,
  categoryId: string,
): Promise<VendorReclass | null> {
  const tx = db.get<{ vendorKey: string; merchant: string | null; name: string }>(
    sql`SELECT COALESCE(NULLIF(merchant_name, ''), name) AS vendorKey,
               merchant_name AS merchant, name AS name
        FROM transactions WHERE id = ${txnId}`,
  );
  if (!tx) return null;

  const grp = db.get<{ groupId: string }>(
    sql`SELECT group_id AS groupId FROM vendor_group_members WHERE vendor_key = ${tx.vendorKey}`,
  );
  const match = grp
    ? sql`COALESCE(NULLIF(t.merchant_name, ''), t.name) IN
          (SELECT vendor_key FROM vendor_group_members WHERE group_id = ${grp.groupId})`
    : sql`COALESCE(NULLIF(t.merchant_name, ''), t.name) = ${tx.vendorKey}`;

  const row = db.get<{ n: number }>(sql`
    SELECT COUNT(*) AS n FROM transactions t
    WHERE t.id != ${txnId} AND t.pending = 0 AND ${match}
      AND COALESCE(t.user_category_id,
            (SELECT c.id FROM categories c WHERE c.plaid_primary = t.category)) IS NOT ${categoryId}`);

  const count = Number(row?.n ?? 0);
  if (count === 0) return null;
  return { vendorName: cleanTransactionName(tx.name, tx.merchant), count };
}

/**
 * Apply a category override to every (non-pending) transaction from the same
 * vendor (group-aware) as `txnId`. Returns the number of rows updated.
 */
export async function applyCategoryToVendor(txnId: string, categoryId: string): Promise<number> {
  const tx = db.get<{ vendorKey: string }>(
    sql`SELECT COALESCE(NULLIF(merchant_name, ''), name) AS vendorKey
        FROM transactions WHERE id = ${txnId}`,
  );
  if (!tx) return 0;

  const grp = db.get<{ groupId: string }>(
    sql`SELECT group_id AS groupId FROM vendor_group_members WHERE vendor_key = ${tx.vendorKey}`,
  );
  const match = grp
    ? sql`COALESCE(NULLIF(merchant_name, ''), name) IN
          (SELECT vendor_key FROM vendor_group_members WHERE group_id = ${grp.groupId})`
    : sql`COALESCE(NULLIF(merchant_name, ''), name) = ${tx.vendorKey}`;

  const res = db.run(
    sql`UPDATE transactions SET user_category_id = ${categoryId} WHERE pending = 0 AND ${match}`,
  );
  revalidateAll();
  return (res as { changes: number }).changes;
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

// ── Vendor groups ─────────────────────────────────────────────────────────────

/** Create a new vendor group with an optional initial member. Returns the group id. */
export async function createVendorGroup(name: string, initialVendorKey?: string) {
  const trimmed = name.trim();
  if (!trimmed) return;
  const id = `vg_${crypto.randomUUID().slice(0, 8)}`;
  db.insert(vendorGroups).values({ id, name: trimmed, createdAt: new Date() }).run();
  if (initialVendorKey) {
    db.insert(vendorGroupMembers)
      .values({ vendorKey: initialVendorKey, groupId: id })
      .onConflictDoUpdate({ target: vendorGroupMembers.vendorKey, set: { groupId: id } })
      .run();
  }
  revalidateAll();
  return id;
}

export async function renameVendorGroup(groupId: string, name: string) {
  const trimmed = name.trim();
  if (!trimmed) return;
  db.update(vendorGroups).set({ name: trimmed }).where(eq(vendorGroups.id, groupId)).run();
  revalidateAll();
}

export async function deleteVendorGroup(groupId: string) {
  // Members cascade-delete via FK.
  db.delete(vendorGroups).where(eq(vendorGroups.id, groupId)).run();
  revalidateAll();
}

/** Add a raw vendor key to an existing group (or move it from another group). */
export async function addVendorToGroup(vendorKey: string, groupId: string) {
  db.insert(vendorGroupMembers)
    .values({ vendorKey, groupId })
    .onConflictDoUpdate({ target: vendorGroupMembers.vendorKey, set: { groupId } })
    .run();
  revalidateAll();
}

/** Remove a raw vendor key from its group (returns it to standalone). */
export async function removeVendorFromGroup(vendorKey: string) {
  db.delete(vendorGroupMembers).where(eq(vendorGroupMembers.vendorKey, vendorKey)).run();
  revalidateAll();
}

// ── Manual (off-Plaid) holdings ──────────────────────────────────────────────

export type ManualHoldingInput = {
  name: string;
  symbol?: string | null;
  type?: string | null;
  quantity?: number | null;
  costBasis?: number | null;
  manualValue?: number | null;
};

/**
 * Add an off-account holding. A `symbol` makes it tickered (valued by quantity ×
 * market price); without one it's a fixed-value asset valued by `manualValue`.
 */
export async function addManualHolding(input: ManualHoldingInput) {
  const name = input.name?.trim();
  if (!name) return;
  const symbol = input.symbol?.trim().toUpperCase() || null;
  const now = new Date();
  const id = `mh_${crypto.randomUUID().slice(0, 8)}`;
  db.insert(manualHoldings)
    .values({
      id,
      symbol,
      name,
      type: input.type?.trim() || (symbol ? "crypto" : "other"),
      quantity: symbol ? input.quantity ?? null : null,
      costBasis: input.costBasis ?? null,
      manualValue: symbol ? null : input.manualValue ?? null,
      isoCurrencyCode: "USD",
      createdAt: now,
      updatedAt: now,
    })
    .run();
  revalidateAll();
  return id;
}

/** Edit an off-account holding's quantity / cost basis / fixed value / name. */
export async function updateManualHolding(
  id: string,
  patch: { name?: string; quantity?: number | null; costBasis?: number | null; manualValue?: number | null },
) {
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.name !== undefined) set.name = patch.name.trim();
  if (patch.quantity !== undefined) set.quantity = patch.quantity;
  if (patch.costBasis !== undefined) set.costBasis = patch.costBasis;
  if (patch.manualValue !== undefined) set.manualValue = patch.manualValue;
  db.update(manualHoldings).set(set).where(eq(manualHoldings.id, id)).run();
  revalidateAll();
}

/** Remove an off-account holding. */
export async function deleteManualHolding(id: string) {
  db.delete(manualHoldings).where(eq(manualHoldings.id, id)).run();
  revalidateAll();
}

// ── Investment sectors ──────────────────────────────────────────────────────

/**
 * Assign (or clear) the sector for a holding. `sectorKey` is the symbol-scoped
 * key from `sectorKeyFor` — so setting "Technology" on one AAPL row tags every
 * AAPL position at once. An empty/whitespace sector clears the assignment.
 */
export async function setHoldingSector(sectorKey: string, sector: string) {
  const key = sectorKey.trim();
  if (!key) return;
  const name = sector.trim();
  if (!name) {
    db.delete(investmentSectors).where(eq(investmentSectors.sectorKey, key)).run();
  } else {
    db.insert(investmentSectors)
      .values({ sectorKey: key, sector: name })
      .onConflictDoUpdate({ target: investmentSectors.sectorKey, set: { sector: name } })
      .run();
  }
  revalidateAll();
}

// ── Plaid holding cost-basis overrides ───────────────────────────────────────

export type HoldingCostBasisInput = {
  /** Total dollars paid for the whole position. */
  totalCost?: number | null;
  /** Average cost per share (preferred — survives quantity changes). */
  unitCost?: number | null;
  /** Optional informational date, e.g. a brokerage transfer date (YYYY-MM-DD). */
  asOfDate?: string | null;
  note?: string | null;
};

/**
 * Set (or replace) a user cost-basis correction for a Plaid holding. Stored in
 * its own table so the next sync can't overwrite it. Passing neither figure
 * clears any existing override (falls back to the brokerage-reported basis).
 */
export async function setHoldingCostBasisOverride(
  holdingId: string,
  input: HoldingCostBasisInput,
) {
  const id = holdingId?.trim();
  if (!id) return;
  const totalCost = input.totalCost ?? null;
  const unitCost = input.unitCost ?? null;
  if (totalCost == null && unitCost == null) {
    return clearHoldingCostBasisOverride(id);
  }
  const asOfDate = input.asOfDate?.trim() || null;
  const note = input.note?.trim() || null;
  const now = new Date();
  db.insert(holdingCostBasisOverrides)
    .values({ holdingId: id, totalCost, unitCost, asOfDate, note, updatedAt: now })
    .onConflictDoUpdate({
      target: holdingCostBasisOverrides.holdingId,
      set: { totalCost, unitCost, asOfDate, note, updatedAt: now },
    })
    .run();
  revalidateAll();
}

/** Drop a cost-basis correction; the holding reverts to the brokerage figure. */
export async function clearHoldingCostBasisOverride(holdingId: string) {
  const id = holdingId?.trim();
  if (!id) return;
  db.delete(holdingCostBasisOverrides)
    .where(eq(holdingCostBasisOverrides.holdingId, id))
    .run();
  revalidateAll();
}
