"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { stockSplits } from "@/db/schema";
import {
  reconcileOfx,
  commitOfxImport,
  revertBatch,
  type ReconcileSummary,
  type CommitResult,
} from "@/lib/import/import-service";
import { createImportAccount } from "@/lib/import/account";

/**
 * Server Actions for trade import (OFX/QFX). The client reads the file as text
 * and hands it here; parsing/commit happen on the server where the DB lives.
 * Preview never writes; commit is idempotent (see lib/import/import-service.ts).
 */

function revalidateAll() {
  revalidatePath("/", "layout");
}

export type PreviewResult = ReconcileSummary | { error: string };

/** Parse + reconcile a file for the preview screen. No DB writes. */
export async function previewImportAction(fileText: string): Promise<PreviewResult> {
  try {
    const summary = reconcileOfx(fileText);
    if (summary.rowsParsed === 0) {
      return { error: "No investment transactions found in this file. Is it an OFX/QFX investment export?" };
    }
    return summary;
  } catch (e) {
    return { error: (e as Error)?.message || "Could not read this file as OFX/QFX." };
  }
}

export type CommitActionResult = CommitResult | { error: string };

/** Commit a previewed file into an account. Idempotent on re-run. */
export async function commitImportAction(input: {
  fileText: string;
  accountId: string;
  fileName?: string | null;
}): Promise<CommitActionResult> {
  if (!input.accountId) return { error: "Choose a destination account first." };
  try {
    const result = commitOfxImport(input);
    revalidateAll();
    return result;
  } catch (e) {
    return { error: (e as Error)?.message || "Import failed." };
  }
}

/** Create a manual investment account to import into. Returns its id. */
export async function createImportAccountAction(name: string, subtype?: string): Promise<{ id: string }> {
  const id = createImportAccount({ name: name.trim() || "Imported brokerage", subtype: subtype ?? null });
  revalidateAll();
  return { id };
}

/** Undo an import batch (deletes its trades). */
export async function revertImportAction(batchId: string): Promise<{ deleted: number }> {
  const r = revertBatch(batchId);
  revalidateAll();
  return r;
}

// ── manual corporate actions (stock splits) ──────────────────────────────────

export async function addStockSplitAction(input: {
  ticker: string;
  date: string;
  numerator: number;
  denominator: number;
}): Promise<{ ok: true } | { error: string }> {
  const ticker = input.ticker.trim().toUpperCase();
  const num = Number(input.numerator);
  const den = Number(input.denominator);
  if (!ticker) return { error: "Ticker is required." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) return { error: "Date must be YYYY-MM-DD." };
  if (!(num > 0) || !(den > 0)) return { error: "Ratio must be positive (e.g. 4 and 1 for a 4-for-1)." };

  db.insert(stockSplits)
    .values({
      id: `split_${crypto.randomUUID().slice(0, 8)}`,
      ticker,
      date: input.date,
      numerator: num,
      denominator: den,
      source: "manual",
      createdAt: new Date(),
    })
    .onConflictDoNothing({ target: [stockSplits.ticker, stockSplits.date] })
    .run();
  revalidateAll();
  return { ok: true };
}

export async function deleteStockSplitAction(id: string): Promise<{ ok: true }> {
  db.delete(stockSplits).where(eq(stockSplits.id, id)).run();
  revalidateAll();
  return { ok: true };
}
