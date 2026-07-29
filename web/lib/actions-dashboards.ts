"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { dashboardWidgets, dashboards } from "@/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { OVERVIEW_DASHBOARD_ID, type WidgetConfig } from "@/lib/queries";

/**
 * Server Actions for custom dashboards — create/rename/delete a dashboard and
 * add/remove/reorder its widgets. Like every mutation in budgetr these write to
 * the local SQLite DB and revalidate the root layout so the sidebar and every
 * force-dynamic page (including the dashboards index) re-read the new state.
 */

/** Create a dashboard, appended after the existing ones. Returns its id. */
export async function createDashboard(name: string): Promise<string> {
  const trimmed = name.trim() || "Untitled dashboard";
  const id = `dash_${crypto.randomUUID().slice(0, 8)}`;
  const max = db.get<{ v: number }>(
    sql`SELECT COALESCE(MAX(sort_order), -1) AS v FROM dashboards`,
  );
  db.insert(dashboards)
    .values({
      id,
      name: trimmed,
      sortOrder: (max?.v ?? -1) + 1,
      createdAt: new Date(),
    })
    .run();
  revalidatePath("/", "layout");
  return id;
}

export async function renameDashboard(id: string, name: string): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) return;
  db.update(dashboards).set({ name: trimmed }).where(eq(dashboards.id, id)).run();
  revalidatePath("/", "layout");
}

export async function deleteDashboard(id: string): Promise<void> {
  // The reserved Overview board can't be deleted — it's the landing screen.
  if (id === OVERVIEW_DASHBOARD_ID) return;
  // Widgets cascade via the FK's onDelete.
  db.delete(dashboards).where(eq(dashboards.id, id)).run();
  revalidatePath("/", "layout");
}

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
