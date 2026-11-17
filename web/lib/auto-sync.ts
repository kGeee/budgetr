// Scheduled account sync.
//
// The companion engine already pushes a fresh summary to the phone within a
// minute of anything changing — but nothing *changed* unless someone opened the
// Mac and pressed Sync. So a phone on a desk read yesterday's ledger all day.
// This is the missing half: pull from the bank on a schedule, then hand the
// result straight to the companion engine, so the phone follows without anyone
// touching the Mac.
//
// Off by default. A sync calls Plaid's balance endpoint, which is billed per
// call on pay-as-you-go plans; a recurring charge is the user's decision, made
// once in Settings, never one an update makes for them.

import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { appSettings, items } from "@/db/schema";

export const AUTO_SYNC_KEY = "autoSync.hours";
const LAST_RUN_KEY = "autoSync.lastRunAt"; // unix ms of the last attempt

/** Hours between syncs. 0 is off. */
export const AUTO_SYNC_OPTIONS = [0, 1, 3, 6, 12, 24] as const;
export type AutoSyncHours = (typeof AUTO_SYNC_OPTIONS)[number];

export function autoSyncLabel(hours: number): string {
  if (hours <= 0) return "Off";
  if (hours === 1) return "Every hour";
  if (hours === 24) return "Once a day";
  return `Every ${hours} hours`;
}

function read(key: string): string | null {
  return db.select().from(appSettings).where(eq(appSettings.key, key)).get()?.value ?? null;
}

function write(key: string, value: string | null): void {
  if (value === null) {
    db.delete(appSettings).where(eq(appSettings.key, key)).run();
    return;
  }
  db.insert(appSettings)
    .values({ key, value })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: sql`excluded."value"` } })
    .run();
}

export function getAutoSyncHours(): AutoSyncHours {
  const n = Number(read(AUTO_SYNC_KEY));
  return (AUTO_SYNC_OPTIONS as readonly number[]).includes(n) ? (n as AutoSyncHours) : 0;
}

/** Off is stored as the absence of the row (the default). */
export function setAutoSyncHours(hours: number): void {
  const valid = (AUTO_SYNC_OPTIONS as readonly number[]).includes(hours) ? hours : 0;
  write(AUTO_SYNC_KEY, valid > 0 ? String(valid) : null);
}

export function getAutoSyncLastRunAt(): number | null {
  const n = Number(read(LAST_RUN_KEY));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Is a scheduled sync due? Pure, so the boundaries are testable without a
 * clock or a database. The last *attempt* counts, not the last success: a bank
 * that is down gets retried next interval, not every five minutes.
 */
export function autoSyncDue({
  hours,
  lastRunAt,
  now,
}: {
  hours: number;
  lastRunAt: number | null;
  now: number;
}): boolean {
  if (!(hours > 0)) return false;
  if (lastRunAt === null) return true;
  // A clock that jumped backwards shouldn't strand the schedule in the future.
  if (lastRunAt > now) return true;
  return now - lastRunAt >= hours * 3_600_000;
}

export interface AutoSyncResult {
  ran: boolean;
  /** Why nothing ran, when nothing did. */
  skipped?: "off" | "not-due" | "demo" | "no-keys" | "no-accounts" | "busy";
}

let running = false;

/** Run a bank sync if one is due, then push the result to the phone. */
export async function runAutoSyncIfDue(now = Date.now()): Promise<AutoSyncResult> {
  const hours = getAutoSyncHours();
  if (hours === 0) return { ran: false, skipped: "off" };
  if (running) return { ran: false, skipped: "busy" };
  if (!autoSyncDue({ hours, lastRunAt: getAutoSyncLastRunAt(), now })) {
    return { ran: false, skipped: "not-due" };
  }

  // Never against the bundled sample data, and never without credentials or
  // anything to sync — each would be a failed call recorded as an error.
  const { isDemoMode } = await import("@/lib/app-config");
  if (isDemoMode()) return { ran: false, skipped: "demo" };
  const { hasPlaidCredentials } = await import("@/lib/plaid");
  if (!hasPlaidCredentials()) return { ran: false, skipped: "no-keys" };
  const linked = db.select({ id: items.id }).from(items).where(eq(items.source, "plaid")).all();
  if (linked.length === 0) return { ran: false, skipped: "no-accounts" };

  running = true;
  // Stamp the attempt first: if the sync throws or the process dies mid-way,
  // the next tick still waits a full interval.
  write(LAST_RUN_KEY, String(now));
  try {
    const { syncAllItems } = await import("@/lib/sync");
    await syncAllItems(); // per-institution failures are recorded on the item
    // Don't wait for the engine's next minute: the phone should see this now.
    const { syncNow } = await import("@/lib/companion/engine");
    await syncNow().catch(() => {});
    return { ran: true };
  } finally {
    running = false;
  }
}

const TICK_MS = 5 * 60_000;

/** Start the scheduler. Safe to call repeatedly (dev HMR, multiple imports). */
export function startAutoSync(): void {
  const g = globalThis as typeof globalThis & { __autoSync?: NodeJS.Timeout };
  if (g.__autoSync) return;
  const tick = () =>
    void runAutoSyncIfDue().catch((err) => console.warn("[auto-sync]", (err as Error).message));
  g.__autoSync = setInterval(tick, TICK_MS);
  g.__autoSync.unref?.();
  // A Mac that slept through its slot catches up shortly after waking the app.
  setTimeout(tick, 30_000).unref?.();
}
