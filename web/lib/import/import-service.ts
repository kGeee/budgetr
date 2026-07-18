/**
 * Import orchestration: parse → reconcile (preview) → commit → revert.
 *
 * Nothing touches the database until commit. The reconcile summary is the
 * "never import silently" gate — it reports what was parsed, the resulting
 * positions, and warnings, most importantly the sells that have no covering buy
 * in the file (which the tax-lot engine would otherwise drop with zero P&L).
 */
import { createHash } from "node:crypto";
import { db } from "@/db";
import { importBatches, investmentTransactions, stockSplits } from "@/db/schema";
import { eq } from "drizzle-orm";
import { parseOfx } from "@/lib/import/ofx";
import { canonicalizeOfx, type CanonicalTrade } from "@/lib/import/canonicalize";
import { tradeFingerprint } from "@/lib/import/fingerprint";
import { findOrCreateSecurity } from "@/lib/import/securities";

export type ReconcilePosition = { ticker: string; quantity: number; buys: number; sells: number };
export type ReconcileWarning = { level: "warn" | "info"; message: string; ticker?: string };

export type ReconcileSummary = {
  source: "ofx";
  broker: string | null;
  fileHash: string;
  rowsParsed: number;
  dateStart: string | null;
  dateEnd: string | null;
  symbolCount: number;
  positions: ReconcilePosition[];
  warnings: ReconcileWarning[];
};

export function hashFile(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** Compute the reconcile summary from canonical trades — pure, no DB. */
export function buildReconcile(
  trades: CanonicalTrade[],
  meta: { broker: string | null; fileHash: string; dateStart: string | null; dateEnd: string | null },
): ReconcileSummary {
  const byTicker = new Map<string, CanonicalTrade[]>();
  let untickered = 0;
  for (const t of trades) {
    if (!t.ticker) {
      untickered++;
      continue;
    }
    const list = byTicker.get(t.ticker) ?? byTicker.set(t.ticker, []).get(t.ticker)!;
    list.push(t);
  }

  const positions: ReconcilePosition[] = [];
  const warnings: ReconcileWarning[] = [];

  for (const [ticker, rows] of byTicker) {
    let net = 0;
    let buys = 0;
    let sells = 0;
    // Replay chronologically to detect a sell that exceeds the shares this file
    // has opened — the engine silently drops that excess, so we surface it.
    const chron = [...rows].sort((a, b) => a.date.localeCompare(b.date));
    let running = 0;
    let deficit = 0;
    for (const t of chron) {
      const q = t.quantity ?? 0;
      net += q;
      if (q > 0) buys++;
      else if (q < 0) sells++;
      running += q;
      if (running < 0) {
        deficit += -running;
        running = 0; // the engine drops the uncovered portion
      }
    }
    positions.push({ ticker, quantity: round(net), buys, sells });
    if (deficit > 0) {
      warnings.push({
        level: "warn",
        ticker,
        message: `${ticker}: ${round(deficit)} sold share(s)/contract(s) have no opening buy in this file — their gain/loss can't be computed until the earlier trades are imported.`,
      });
    }
  }

  if (untickered > 0) {
    warnings.push({
      level: "info",
      message: `${untickered} row(s) had no resolvable ticker (often cash activity) and were skipped.`,
    });
  }

  positions.sort((a, b) => a.ticker.localeCompare(b.ticker));
  return {
    source: "ofx",
    broker: meta.broker,
    fileHash: meta.fileHash,
    rowsParsed: trades.length,
    dateStart: meta.dateStart,
    dateEnd: meta.dateEnd,
    symbolCount: byTicker.size,
    positions,
    warnings,
  };
}

/** Parse + reconcile an OFX/QFX file. No DB writes. */
export function reconcileOfx(fileText: string): ReconcileSummary {
  const doc = parseOfx(fileText);
  const trades = canonicalizeOfx(doc);
  return buildReconcile(trades, {
    broker: doc.brokerId,
    fileHash: hashFile(fileText),
    dateStart: doc.dtStart,
    dateEnd: doc.dtEnd,
  });
}

export type CommitResult = { batchId: string; imported: number; skipped: number; duplicates: number };

/**
 * Commit an OFX/QFX file into an account. Idempotent: re-committing the same file
 * re-derives the same trade ids and the onConflictDoNothing upsert no-ops, so a
 * double import never doubles a position.
 */
export function commitOfxImport(input: {
  fileText: string;
  accountId: string;
  fileName?: string | null;
}): CommitResult {
  const doc = parseOfx(input.fileText);
  const trades = canonicalizeOfx(doc);
  const fileHash = hashFile(input.fileText);
  const now = new Date();

  const batchId = `imp_batch_${crypto.randomUUID().slice(0, 8)}`;
  db.insert(importBatches)
    .values({
      id: batchId,
      source: "ofx",
      broker: doc.brokerId ?? null,
      accountId: input.accountId,
      fileName: input.fileName ?? null,
      fileHash,
      rowsParsed: trades.length,
      rowsImported: 0,
      dateStart: doc.dtStart,
      dateEnd: doc.dtEnd,
      symbolCount: new Set(trades.map((t) => t.ticker).filter(Boolean)).size,
      status: "committed",
      createdAt: now,
    })
    .run();

  let imported = 0;
  let skipped = 0;
  let duplicates = 0;

  db.transaction((tx) => {
    for (const t of trades) {
      if (!t.ticker) {
        skipped++;
        continue;
      }
      const securityId = findOrCreateSecurity({
        symbol: t.ticker,
        name: t.securityName,
        type: t.securityType,
      });
      const id = tradeFingerprint({
        accountId: input.accountId,
        date: t.date,
        ticker: t.ticker,
        quantity: t.quantity,
        amount: t.amount,
        side: t.side,
        fitid: t.fitid,
      });
      const res = tx
        .insert(investmentTransactions)
        .values({
          id,
          accountId: input.accountId,
          securityId,
          date: t.date,
          name: t.name,
          type: t.type,
          subtype: t.subtype,
          quantity: t.quantity,
          amount: t.amount,
          price: t.price,
          fees: t.fees,
          isoCurrencyCode: t.isoCurrencyCode,
          source: "import",
          importBatchId: batchId,
        })
        .onConflictDoNothing({ target: investmentTransactions.id })
        .run();
      if (res.changes > 0) imported++;
      else duplicates++;
    }
    tx.update(importBatches).set({ rowsImported: imported }).where(eq(importBatches.id, batchId)).run();
  });

  return { batchId, imported, skipped, duplicates };
}

/** Undo an import: delete its trades and mark the batch reverted (audit kept). */
export function revertBatch(batchId: string): { deleted: number } {
  return db.transaction((tx) => {
    const res = tx
      .delete(investmentTransactions)
      .where(eq(investmentTransactions.importBatchId, batchId))
      .run();
    tx.update(importBatches).set({ status: "reverted" }).where(eq(importBatches.id, batchId)).run();
    return { deleted: res.changes };
  });
}

/** All import batches, newest first. */
export function listImportBatches() {
  return db.select().from(importBatches).orderBy(importBatches.createdAt).all();
}

/** All stock splits (with ids), for the corporate-actions editor. */
export function listStockSplits() {
  return db.select().from(stockSplits).orderBy(stockSplits.ticker, stockSplits.date).all();
}

function round(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}
