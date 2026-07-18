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
import { importBatches, importProfiles, investmentTransactions, securities, stockSplits } from "@/db/schema";
import { eq } from "drizzle-orm";
import { parseOfx } from "@/lib/import/ofx";
import { canonicalizeOfx, type CanonicalTrade } from "@/lib/import/canonicalize";
import { tradeFingerprint } from "@/lib/import/fingerprint";
import { findOrCreateSecurity } from "@/lib/import/securities";
import { parseCsv } from "@/lib/import/csv";
import { csvToCanonical, type CsvMapping } from "@/lib/import/csv-adapter";
import { BROKERS, detectBroker, resolveMapping, type BrokerProfile } from "@/lib/import/brokers";

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

    // Wash-sale completeness: a sale near the file's start means the IRS ±30-day
    // window reaches before the imported data, so a replacement purchase could be
    // missing and a wash sale under-reported. Flag it (unless we already warned
    // about a hard deficit for this ticker).
    if (deficit === 0 && sells > 0 && meta.dateStart) {
      const earliestSell = chron.find((t) => (t.quantity ?? 0) < 0)?.date;
      if (earliestSell && daysBetweenDates(meta.dateStart, earliestSell) <= WASH_WINDOW_DAYS) {
        warnings.push({
          level: "info",
          ticker,
          message: `${ticker}: a sale falls within ${WASH_WINDOW_DAYS} days of this file's start (${meta.dateStart}) — wash-sale detection may miss a replacement purchase made earlier. Import the prior period to be sure.`,
        });
      }
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

type CommitInput = {
  trades: CanonicalTrade[];
  accountId: string;
  source: "ofx" | "csv";
  broker: string | null;
  fileName: string | null;
  fileHash: string;
  dtStart: string | null;
  dtEnd: string | null;
  /** Rows the parser/adapter dropped before commit (e.g. non-trade CSV rows). */
  preSkipped?: number;
};

/**
 * The shared, idempotent commit used by both OFX and CSV. Re-committing the same
 * file re-derives the same trade ids (FITID for OFX, content hash for CSV), so the
 * onConflictDoNothing upsert no-ops and a double import never doubles a position.
 * CSV trades have no FITID, so genuinely-identical same-day rows are disambiguated
 * by a stable occurrence index.
 */
export function commitTrades(input: CommitInput): CommitResult {
  const now = new Date();
  const batchId = `imp_batch_${crypto.randomUUID().slice(0, 8)}`;

  db.insert(importBatches)
    .values({
      id: batchId,
      source: input.source,
      broker: input.broker,
      accountId: input.accountId,
      fileName: input.fileName,
      fileHash: input.fileHash,
      rowsParsed: input.trades.length,
      rowsImported: 0,
      dateStart: input.dtStart,
      dateEnd: input.dtEnd,
      symbolCount: new Set(input.trades.map((t) => t.ticker).filter(Boolean)).size,
      status: "committed",
      createdAt: now,
    })
    .run();

  let imported = 0;
  let skipped = input.preSkipped ?? 0;
  let duplicates = 0;
  const seqByKey = new Map<string, number>();

  db.transaction((tx) => {
    for (const t of input.trades) {
      if (!t.ticker) {
        skipped++;
        continue;
      }
      // Occurrence index for FITID-less (CSV) trades so identical same-day rows
      // get distinct-but-stable ids.
      const key = `${t.date}|${t.ticker}|${t.quantity}|${t.amount}|${t.side}`;
      const seq = seqByKey.get(key) ?? 0;
      seqByKey.set(key, seq + 1);

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
        seq,
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

/** Commit an OFX/QFX file into an account. */
export function commitOfxImport(input: {
  fileText: string;
  accountId: string;
  fileName?: string | null;
}): CommitResult {
  const doc = parseOfx(input.fileText);
  return commitTrades({
    trades: canonicalizeOfx(doc),
    accountId: input.accountId,
    source: "ofx",
    broker: doc.brokerId ?? null,
    fileName: input.fileName ?? null,
    fileHash: hashFile(input.fileText),
    dtStart: doc.dtStart,
    dtEnd: doc.dtEnd,
  });
}

// ── CSV ───────────────────────────────────────────────────────────────────────

export type CsvDetection = {
  broker: { key: string; label: string } | null;
  headers: string[];
  sampleRows: Record<string, string>[];
};

/** Parse a CSV's header and auto-detect a known broker (for the UI's next step). */
export function detectCsv(fileText: string): CsvDetection {
  const { headers, rows } = parseCsv(fileText);
  const broker = detectBroker(headers);
  return {
    broker: broker ? { key: broker.key, label: broker.label } : null,
    headers,
    sampleRows: rows.slice(0, 5),
  };
}

/**
 * Resolve a CSV's mapping, in order: an explicit user mapping, a named broker, an
 * auto-detected broker, then a previously-saved profile matched by header
 * fingerprint (so the same unrecognized export "just works" the second time).
 */
function mappingFor(headers: string[], opts: { brokerKey?: string; mapping?: CsvMapping }): CsvMapping | null {
  if (opts.mapping) return opts.mapping;
  if (opts.brokerKey) {
    const b = detectBrokerByKey(opts.brokerKey);
    if (b) return resolveMapping(headers, b);
  }
  const auto = detectBroker(headers);
  if (auto) return resolveMapping(headers, auto);
  return findProfileMapping(headers);
}

function detectBrokerByKey(key: string): BrokerProfile | undefined {
  return BROKERS.find((b) => b.key === key);
}

/** Stable fingerprint of a header set (order-independent). */
function headerFingerprint(headers: string[]): string {
  const norm = headers.map((h) => h.trim().toLowerCase()).sort().join("|");
  return createHash("sha256").update(norm).digest("hex").slice(0, 24);
}

function findProfileMapping(headers: string[]): CsvMapping | null {
  const row = db
    .select()
    .from(importProfiles)
    .where(eq(importProfiles.headerFingerprint, headerFingerprint(headers)))
    .get();
  if (!row) return null;
  try {
    return { columns: JSON.parse(row.mapping), sign: (row.signConvention as CsvMapping["sign"]) ?? "action" };
  } catch {
    return null;
  }
}

/** Remember a hand-built mapping so the next upload of the same format auto-maps. */
function saveProfile(headers: string[], mapping: CsvMapping): void {
  const fp = headerFingerprint(headers);
  if (findProfileMapping(headers)) return; // already saved
  db.insert(importProfiles)
    .values({
      id: `prof_${crypto.randomUUID().slice(0, 8)}`,
      broker: null,
      name: `Custom (${headers.length} columns)`,
      headerFingerprint: fp,
      mapping: JSON.stringify(mapping.columns),
      signConvention: mapping.sign,
      createdAt: new Date(),
    })
    .run();
}

/** Parse + reconcile a CSV. No DB writes. Returns null mapping-error if unmappable. */
export function reconcileCsv(
  fileText: string,
  opts: { brokerKey?: string; mapping?: CsvMapping } = {},
): ReconcileSummary | { needsMapping: true; headers: string[]; sampleRows: Record<string, string>[] } {
  const { headers, rows } = parseCsv(fileText);
  const mapping = mappingFor(headers, opts);
  if (!mapping) return { needsMapping: true, headers, sampleRows: rows.slice(0, 5) };

  const { trades, skipped } = csvToCanonical(rows, mapping);
  const dates = trades.map((t) => t.date).sort();
  const summary = buildReconcile(trades, {
    broker: detectBroker(headers)?.label ?? null,
    fileHash: hashFile(fileText),
    dateStart: dates[0] ?? null,
    dateEnd: dates[dates.length - 1] ?? null,
  });
  if (skipped > 0) {
    summary.warnings.push({
      level: "info",
      message: `${skipped} non-trade row(s) (dividends, transfers, or unrecognized actions) were skipped.`,
    });
  }
  return summary;
}

/** Commit a CSV file into an account with a broker key or explicit mapping. */
export function commitCsvImport(input: {
  fileText: string;
  accountId: string;
  fileName?: string | null;
  brokerKey?: string;
  mapping?: CsvMapping;
}): CommitResult {
  const { headers, rows } = parseCsv(input.fileText);
  const mapping = mappingFor(headers, input);
  if (!mapping) throw new Error("Could not map this CSV's columns — set the mapping first.");

  // A hand-built mapping is worth remembering for next time (only when this
  // wasn't already a known broker / saved profile).
  if (input.mapping && !detectBroker(headers)) saveProfile(headers, input.mapping);

  const { trades, skipped } = csvToCanonical(rows, mapping);
  const dates = trades.map((t) => t.date).sort();
  return commitTrades({
    trades,
    accountId: input.accountId,
    source: "csv",
    broker: detectBroker(headers)?.label ?? null,
    fileName: input.fileName ?? null,
    fileHash: hashFile(input.fileText),
    dtStart: dates[0] ?? null,
    dtEnd: dates[dates.length - 1] ?? null,
    preSkipped: skipped,
  });
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

/** Distinct tickers referenced by imported trades — the set to split-check. */
export function importedTickers(): string[] {
  const rows = db
    .select({ ticker: securities.tickerSymbol })
    .from(investmentTransactions)
    .innerJoin(securities, eq(investmentTransactions.securityId, securities.id))
    .where(eq(investmentTransactions.source, "import"))
    .all();
  return [...new Set(rows.map((r) => r.ticker).filter((t): t is string => !!t))];
}

function round(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

/** IRS wash-sale window (matches lib/tax-lots.ts). */
const WASH_WINDOW_DAYS = 30;

/** Whole days between two YYYY-MM-DD dates (absolute). */
function daysBetweenDates(a: string, b: string): number {
  return Math.abs(Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000));
}
