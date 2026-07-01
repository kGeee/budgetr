"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { dismissedAlerts } from "@/db/schema";
import { eq } from "drizzle-orm";

/**
 * Server Actions backing the anomaly-detection alerts (lib/anomalies.ts). Alerts
 * are derived, not stored, so all we persist is the user's action against a
 * deterministic `alertKey`. Each mutation revalidates the whole app so the
 * Overview panel and /insights page re-read immediately.
 */

/** Permanently dismiss an alert — it won't reappear unless the key changes. */
export async function dismissAlert(alertKey: string): Promise<void> {
  db.insert(dismissedAlerts)
    .values({
      id: `alert_${crypto.randomUUID().slice(0, 8)}`,
      alertKey,
      dismissedAt: new Date(),
      snoozeUntil: null,
    })
    .onConflictDoUpdate({
      target: dismissedAlerts.alertKey,
      set: { dismissedAt: new Date(), snoozeUntil: null },
    })
    .run();
  revalidatePath("/", "layout");
}

/** Hide an alert until `untilDate` (YYYY-MM-DD); it re-surfaces on/after then. */
export async function snoozeAlert(alertKey: string, untilDate: string): Promise<void> {
  db.insert(dismissedAlerts)
    .values({
      id: `alert_${crypto.randomUUID().slice(0, 8)}`,
      alertKey,
      dismissedAt: new Date(),
      snoozeUntil: untilDate,
    })
    .onConflictDoUpdate({
      target: dismissedAlerts.alertKey,
      set: { dismissedAt: new Date(), snoozeUntil: untilDate },
    })
    .run();
  revalidatePath("/", "layout");
}

/** Restore a dismissed/snoozed alert so it shows again immediately. */
export async function undismissAlert(alertKey: string): Promise<void> {
  db.delete(dismissedAlerts).where(eq(dismissedAlerts.alertKey, alertKey)).run();
  revalidatePath("/", "layout");
}
