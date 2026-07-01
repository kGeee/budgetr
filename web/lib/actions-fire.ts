"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { fireSettings, netWorthMilestones } from "@/db/schema";
import { eq, sql } from "drizzle-orm";

/**
 * Server Actions for FIRE tracking (lib/fire.ts). The settings live in a single
 * upserted row (`id = 'default'`); milestones are their own small table. Every
 * mutation writes to the local SQLite DB and revalidates the whole app so the
 * dashboard — and any derived metric — re-reads immediately.
 */

/** Invalidate every route + the layout so server components re-read the DB. */
function revalidateAll() {
  revalidatePath("/", "layout");
}

/** Coerce a form value to a positive number, or null when blank/invalid. */
function posOrNull(v: number | null | undefined): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export type FireSettingsPatch = {
  annualExpenses?: number | null;
  safeWithdrawalRate?: number;
  expectedReturn?: number;
  monthlyContribution?: number | null;
  targetRetirementAge?: number | null;
};

/**
 * Upsert the single 'default' settings row. Only provided keys are written;
 * nullable figures (annualExpenses, monthlyContribution, targetRetirementAge)
 * accept null to clear back to the derived/unset state.
 */
export async function updateFireSettings(patch: FireSettingsPatch) {
  const set: Record<string, unknown> = {};
  if (patch.annualExpenses !== undefined) set.annualExpenses = posOrNull(patch.annualExpenses);
  if (patch.safeWithdrawalRate !== undefined) {
    const r = Number(patch.safeWithdrawalRate);
    if (Number.isFinite(r) && r > 0 && r <= 100) set.safeWithdrawalRate = r;
  }
  if (patch.expectedReturn !== undefined) {
    const r = Number(patch.expectedReturn);
    if (Number.isFinite(r) && r >= 0 && r <= 100) set.expectedReturn = r;
  }
  if (patch.monthlyContribution !== undefined) {
    set.monthlyContribution = posOrNull(patch.monthlyContribution);
  }
  if (patch.targetRetirementAge !== undefined) {
    const a = patch.targetRetirementAge == null ? null : Math.round(Number(patch.targetRetirementAge));
    set.targetRetirementAge = a != null && Number.isFinite(a) && a > 0 && a < 150 ? a : null;
  }
  if (Object.keys(set).length === 0) return;

  db.insert(fireSettings)
    .values({
      id: "default",
      annualExpenses: (set.annualExpenses as number | null) ?? null,
      safeWithdrawalRate: (set.safeWithdrawalRate as number) ?? 4,
      expectedReturn: (set.expectedReturn as number) ?? 7,
      monthlyContribution: (set.monthlyContribution as number | null) ?? null,
      targetRetirementAge: (set.targetRetirementAge as number | null) ?? null,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: fireSettings.id,
      set: { ...set, updatedAt: new Date() },
    })
    .run();
  revalidateAll();
}

export type AddMilestoneInput = {
  label: string;
  amount: number;
};

/** Create a net-worth milestone. Appends after existing ones in sort order. */
export async function addMilestone(input: AddMilestoneInput) {
  const label = input.label.trim();
  const amount = Number(input.amount);
  if (!label || !Number.isFinite(amount) || amount <= 0) return;
  const id = `nwm_${crypto.randomUUID().slice(0, 8)}`;
  const max = db.get<{ m: number }>(
    sql`SELECT COALESCE(MAX(sort_order), 0) AS m FROM net_worth_milestones`,
  );
  db.insert(netWorthMilestones)
    .values({
      id,
      label,
      amount,
      achievedDate: null,
      sortOrder: (max?.m ?? 0) + 1,
    })
    .run();
  revalidateAll();
  return id;
}

export type UpdateMilestonePatch = {
  label?: string;
  amount?: number;
  /** Pass a 'YYYY-MM-DD' to mark achieved, null to clear, or omit to leave as-is. */
  achievedDate?: string | null;
};

/** Patch a milestone's editable fields. Only provided keys are written. */
export async function updateMilestone(id: string, patch: UpdateMilestonePatch) {
  const set: Record<string, unknown> = {};
  if (patch.label !== undefined) {
    const label = patch.label.trim();
    if (!label) return;
    set.label = label;
  }
  if (patch.amount !== undefined) {
    const amount = Number(patch.amount);
    if (!Number.isFinite(amount) || amount <= 0) return;
    set.amount = amount;
  }
  if (patch.achievedDate !== undefined) {
    set.achievedDate = patch.achievedDate?.trim() || null;
  }
  if (Object.keys(set).length === 0) return;
  db.update(netWorthMilestones).set(set).where(eq(netWorthMilestones.id, id)).run();
  revalidateAll();
}

/** Hard-delete a milestone. */
export async function deleteMilestone(id: string) {
  db.delete(netWorthMilestones).where(eq(netWorthMilestones.id, id)).run();
  revalidateAll();
}
