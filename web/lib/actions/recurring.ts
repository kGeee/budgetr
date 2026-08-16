"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { recurringStreams } from "@/db/schema";

/**
 * Naming a recurring stream.
 *
 * Plaid returns no merchant for some streams — in this ledger, the two largest
 * outflows, one of them $2,382/month — so they render as "Unknown" on both the
 * Recurring page and the Cashflow bill list. The label is stored on the stream
 * and is never touched by sync, so a rename survives every subsequent refresh.
 */
export async function renameRecurringStream(id: string, label: string): Promise<void> {
  const trimmed = label.trim();
  db.update(recurringStreams)
    // Empty clears back to whatever Plaid provides, rather than storing "" and
    // making the row look named when it isn't.
    .set({ userLabel: trimmed || null })
    .where(eq(recurringStreams.id, id))
    .run();

  // Streams surface on Recurring, in the Cashflow bill list and in the Overview
  // upcoming-bills widget, so a rename has to land on all three at once.
  revalidatePath("/", "layout");
}
