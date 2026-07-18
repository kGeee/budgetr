"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { stockSplits } from "@/db/schema";
import {
  reconcileOfx,
  reconcileCsv,
  commitOfxImport,
  commitCsvImport,
  revertBatch,
  listStockSplits,
  importedTickers,
  type ReconcileSummary,
  type CommitResult,
} from "@/lib/import/import-service";
import type { CsvMapping } from "@/lib/import/csv-adapter";
import { createImportAccount } from "@/lib/import/account";
import { detectSplits, type SplitSuggestion } from "@/lib/import/split-detect";

const isOfx = (text: string) => /<OFX>/i.test(text.slice(0, 4000));

/**
 * Server Actions for trade import (OFX/QFX). The client reads the file as text
 * and hands it here; parsing/commit happen on the server where the DB lives.
 * Preview never writes; commit is idempotent (see lib/import/import-service.ts).
 */

function revalidateAll() {
  revalidatePath("/", "layout");
}

export type NeedsMapping = {
  needsMapping: true;
  headers: string[];
  sampleRows: Record<string, string>[];
};
export type PreviewResult = ReconcileSummary | NeedsMapping | { error: string };

/**
 * Parse + reconcile a file for the preview screen (no DB writes). OFX/QFX and CSV
 * are auto-detected; an unrecognized CSV comes back as `needsMapping` so the UI
 * can show the column-mapper.
 */
export async function previewImportAction(fileText: string): Promise<PreviewResult> {
  try {
    if (isOfx(fileText)) {
      const summary = reconcileOfx(fileText);
      return summary.rowsParsed === 0
        ? { error: "No investment transactions found. Is this an OFX/QFX investment export?" }
        : summary;
    }
    const res = reconcileCsv(fileText);
    if ("needsMapping" in res) return res;
    return res.rowsParsed === 0 ? { error: "No trades found in this CSV." } : res;
  } catch (e) {
    return { error: (e as Error)?.message || "Could not read this file." };
  }
}

/** Re-reconcile a CSV once the user has mapped its columns. */
export async function previewCsvMappedAction(fileText: string, mapping: CsvMapping): Promise<PreviewResult> {
  try {
    const res = reconcileCsv(fileText, { mapping });
    if ("needsMapping" in res) return { error: "Map at least a date, symbol, and quantity column." };
    return res.rowsParsed === 0 ? { error: "That mapping produced no trades — check the columns." } : res;
  } catch (e) {
    return { error: (e as Error)?.message || "Could not apply that mapping." };
  }
}

export type CommitActionResult = CommitResult | { error: string };

/** Commit a previewed file into an account. Idempotent on re-run. */
export async function commitImportAction(input: {
  fileText: string;
  accountId: string;
  fileName?: string | null;
  mapping?: CsvMapping; // present for a column-mapped CSV
}): Promise<CommitActionResult> {
  if (!input.accountId) return { error: "Choose a destination account first." };
  try {
    const result = isOfx(input.fileText)
      ? commitOfxImport(input)
      : commitCsvImport({ ...input, mapping: input.mapping });
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

/** Suggest splits (from Yahoo) that the imported tickers need but aren't recorded. */
export async function detectSplitsAction(): Promise<SplitSuggestion[] | { error: string }> {
  try {
    const tickers = importedTickers();
    if (tickers.length === 0) return [];
    const existing = listStockSplits().map((s) => ({
      ticker: s.ticker,
      date: s.date,
      numerator: s.numerator,
      denominator: s.denominator,
    }));
    return await detectSplits(tickers, existing);
  } catch (e) {
    return { error: (e as Error)?.message || "Could not fetch split data." };
  }
}
