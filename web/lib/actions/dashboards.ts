"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { dashboardWidgets } from "@/db/schema";
import { and, eq, sql } from "drizzle-orm";
import type { WidgetConfig } from "@/lib/queries";

/**
 * Server Actions for Home's widget grid — add/remove/reorder/configure widgets
 * on the reserved Overview board. (Multiple named dashboards were retired in
 * 0.15; the tables stay so existing rows survive.) Like every mutation in
 * budgetr these write to the local SQLite DB and revalidate the root layout so
 * every force-dynamic page re-reads the new state.
 */

/** Append a widget of `type` (with optional JSON config) to a dashboard. */
export async function addWidget(
  dashboardId: string,
  type: string,
  config: WidgetConfig = {},
): Promise<void> {
  const id = `dw_${crypto.randomUUID().slice(0, 8)}`;
  const max = db.get<{ v: number }>(
    sql`SELECT COALESCE(MAX(sort_order), -1) AS v FROM dashboard_widgets
        WHERE dashboard_id = ${dashboardId}`,
  );
  db.insert(dashboardWidgets)
    .values({
      id,
      dashboardId,
      type,
      config: JSON.stringify(config),
      sortOrder: (max?.v ?? -1) + 1,
    })
    .run();
  revalidatePath("/", "layout");
}

export async function removeWidget(id: string): Promise<void> {
  db.delete(dashboardWidgets).where(eq(dashboardWidgets.id, id)).run();
  revalidatePath("/", "layout");
}

/**
 * Change one widget's range/sort. Merged over the stored config rather than
 * replacing it, so a range control can't drop the sort a different control set
 * (and vice versa) — each control only owns its own key.
 */
export async function updateWidgetConfig(id: string, patch: WidgetConfig): Promise<void> {
  const row = db
    .select({ config: dashboardWidgets.config })
    .from(dashboardWidgets)
    .where(eq(dashboardWidgets.id, id))
    .get();
  if (!row) return;

  let current: WidgetConfig = {};
  try {
    current = row.config ? (JSON.parse(row.config) as WidgetConfig) : {};
  } catch {
    current = {}; // a corrupt blob shouldn't wedge the control
  }

  db.update(dashboardWidgets)
    .set({ config: JSON.stringify({ ...current, ...patch }) })
    .where(eq(dashboardWidgets.id, id))
    .run();
  revalidatePath("/", "layout");
}

/**
 * Persist a new widget order for one dashboard. `ids` is the full ordered list
 * of that dashboard's widget ids; each row's sort_order is set to its index.
 */
export async function reorderWidgets(
  dashboardId: string,
  ids: string[],
): Promise<void> {
  db.transaction((tx) => {
    ids.forEach((id, i) => {
      tx.update(dashboardWidgets)
        .set({ sortOrder: i })
        .where(and(eq(dashboardWidgets.id, id), eq(dashboardWidgets.dashboardId, dashboardId)))
        .run();
    });
  });
  revalidatePath("/", "layout");
}
