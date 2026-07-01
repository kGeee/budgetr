"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { savingsContributions, savingsGoals } from "@/db/schema";
import type { SavingsContribution } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { getSavingsGoalContributions } from "@/lib/queries";

/**
 * Server Actions for sinking funds / savings goals. Goals hold only their target
 * (amount + optional date); the amount saved lives entirely in the
 * `savings_contributions` ledger so progress stays auditable. Every mutation
 * writes to the local SQLite DB and revalidates the whole app — pages are
 * `force-dynamic`, and revalidating the root layout also refreshes the sidebar.
 */

/** Invalidate every route + the layout so server components re-read the DB. */
function revalidateAll() {
  revalidatePath("/", "layout");
}

const today = () => new Date().toISOString().slice(0, 10);

export type CreateSavingsGoalInput = {
  name: string;
  targetAmount: number;
  icon?: string | null;
  color?: string | null;
  targetDate?: string | null;
};

/** Create a savings goal. Appends after existing goals in sort order. Returns the id. */
export async function createSavingsGoal(input: CreateSavingsGoalInput) {
  const name = input.name.trim();
  const targetAmount = Number(input.targetAmount);
  if (!name || !Number.isFinite(targetAmount) || targetAmount <= 0) return;
  const id = `goal_${crypto.randomUUID().slice(0, 8)}`;
  const max = db.get<{ m: number }>(
    sql`SELECT COALESCE(MAX(sort_order), 0) AS m FROM savings_goals`,
  );
  db.insert(savingsGoals)
    .values({
      id,
      name,
      icon: input.icon?.trim() || null,
      color: input.color?.trim() || null,
      targetAmount,
      targetDate: input.targetDate?.trim() || null,
      sortOrder: (max?.m ?? 0) + 1,
      archived: false,
      createdAt: new Date(),
    })
    .run();
  revalidateAll();
  return id;
}

export type UpdateSavingsGoalPatch = {
  name?: string;
  targetAmount?: number;
  icon?: string | null;
  color?: string | null;
  targetDate?: string | null;
};

/** Patch a goal's editable fields. Only provided keys are written. */
export async function updateSavingsGoal(id: string, patch: UpdateSavingsGoalPatch) {
  const set: Record<string, unknown> = {};
  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (!name) return;
    set.name = name;
  }
  if (patch.targetAmount !== undefined) {
    const amount = Number(patch.targetAmount);
    if (!Number.isFinite(amount) || amount <= 0) return;
    set.targetAmount = amount;
  }
  if (patch.icon !== undefined) set.icon = patch.icon?.trim() || null;
  if (patch.color !== undefined) set.color = patch.color?.trim() || null;
  if (patch.targetDate !== undefined) set.targetDate = patch.targetDate?.trim() || null;
  if (Object.keys(set).length === 0) return;
  db.update(savingsGoals).set(set).where(eq(savingsGoals.id, id)).run();
  revalidateAll();
}

/** Hard-delete a goal; its contributions cascade away with it. */
export async function deleteSavingsGoal(id: string) {
  db.delete(savingsGoals).where(eq(savingsGoals.id, id)).run();
  revalidateAll();
}

/** Soft-hide a completed/abandoned goal without losing its ledger. */
export async function archiveSavingsGoal(id: string) {
  db.update(savingsGoals).set({ archived: true }).where(eq(savingsGoals.id, id)).run();
  revalidateAll();
}

export async function unarchiveSavingsGoal(id: string) {
  db.update(savingsGoals).set({ archived: false }).where(eq(savingsGoals.id, id)).run();
  revalidateAll();
}

/** Earmark money toward a goal — a positive entry in the contribution ledger. */
export async function contributeToGoal(goalId: string, amount: number, note?: string) {
  const value = Math.abs(Number(amount));
  if (!Number.isFinite(value) || value <= 0) return;
  db.insert(savingsContributions)
    .values({
      id: `sgc_${crypto.randomUUID().slice(0, 8)}`,
      goalId,
      amount: value,
      date: today(),
      note: note?.trim() || null,
      createdAt: new Date(),
    })
    .run();
  revalidateAll();
}

/** Pull money back out of a goal — a negative entry in the contribution ledger. */
export async function withdrawFromGoal(goalId: string, amount: number, note?: string) {
  const value = Math.abs(Number(amount));
  if (!Number.isFinite(value) || value <= 0) return;
  db.insert(savingsContributions)
    .values({
      id: `sgc_${crypto.randomUUID().slice(0, 8)}`,
      goalId,
      amount: -value,
      date: today(),
      note: note?.trim() || null,
      createdAt: new Date(),
    })
    .run();
  revalidateAll();
}

/** Remove a single ledger entry (mis-entered deposit/withdrawal). */
export async function deleteContribution(id: string) {
  db.delete(savingsContributions).where(eq(savingsContributions.id, id)).run();
  revalidateAll();
}

/** Read-only wrapper so client components can lazily load a goal's ledger. */
export async function listGoalContributions(goalId: string): Promise<SavingsContribution[]> {
  return getSavingsGoalContributions(goalId);
}
