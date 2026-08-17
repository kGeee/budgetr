// Receipt photos arriving from the phone, and the answers going back.
//
// The phone cannot read a receipt: Expo Go loads no custom native modules, so
// there is no on-device text recognition available to it. The Mac has Apple's
// Vision framework already wired for the desktop splitter, so the photo travels
// — sealed in the same end-to-end encrypted envelope as every other op, through
// a relay that holds only ciphertext — and the parsed lines come back in the
// next Summary.
//
// This is a weaker privacy claim than the desktop's, where a receipt photo never
// leaves the machine, and the phone's copy says the weaker one.
//
// Handled outside applyOps because recognition shells out to a helper binary,
// which cannot happen inside a SQLite write transaction.

import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { attachments, transactions } from "@/db/schema";
import { saveAttachmentFile } from "@/lib/attachments";
import { recognizeReceipt } from "@/lib/receipt/ocr";
import { parseReceipt, MAX_SCAN_RESULTS, type Op, type ScanReceiptOp } from "@budgetr/core";
import { readJson, writeJson } from "./store";

const SCANS_KEY = "companion.scanResults";

export type StoredScan = {
  opId: string;
  txnId: string;
  ts: number;
  receiptJson?: string | null;
  error?: string | null;
};

/** Recent answers, newest first. Bounded — these are transient, not a record. */
export function getScanResults(): StoredScan[] {
  return readJson<StoredScan[]>(SCANS_KEY) ?? [];
}

function remember(result: StoredScan): void {
  // Keyed by op id so a redelivered scan replaces its own answer rather than
  // stacking a duplicate.
  const kept = getScanResults().filter((s) => s.opId !== result.opId);
  writeJson(SCANS_KEY, [result, ...kept].slice(0, MAX_SCAN_RESULTS));
}

/**
 * Read every receipt photo in a batch.
 *
 * Never throws: a blurry photo, a missing transaction and a machine without the
 * recognizer are all ordinary outcomes, and each becomes an answer the phone can
 * show rather than an error that stalls the sync loop.
 */
export async function processScans(ops: Op[]): Promise<{ scanned: number }> {
  const scans = ops.filter((o): o is ScanReceiptOp => o.kind === "scanReceipt");
  if (scans.length === 0) return { scanned: 0 };

  const already = new Set(getScanResults().map((s) => s.opId));
  let scanned = 0;

  for (const op of scans) {
    if (already.has(op.id)) continue;

    const txn = db
      .select({ id: transactions.id })
      .from(transactions)
      .where(eq(transactions.id, op.txnId))
      .get();
    if (!txn) {
      remember({ opId: op.id, txnId: op.txnId, ts: op.ts, error: "That transaction is gone." });
      continue;
    }

    try {
      const bytes = Buffer.from(op.imageBase64, "base64");
      // The photo is kept with the transaction, exactly like one dropped on the
      // desktop — the split should be checkable against the receipt later.
      const filePath = saveAttachmentFile(bytes, "receipt.jpg");
      db.insert(attachments)
        .values({
          id: `att_${crypto.randomUUID().slice(0, 8)}`,
          transactionId: op.txnId,
          filePath,
          mimeType: "image/jpeg",
          size: bytes.length,
          originalName: "receipt-from-phone.jpg",
          createdAt: new Date(),
        })
        .run();

      const ocr = await recognizeReceipt(filePath);
      if (!ocr.ok) {
        remember({ opId: op.id, txnId: op.txnId, ts: op.ts, error: ocr.message });
        continue;
      }

      const receipt = parseReceipt(ocr.lines);
      if (receipt.items.length === 0) {
        remember({
          opId: op.id,
          txnId: op.txnId,
          ts: op.ts,
          error: "Couldn't find any line items — try a straighter, better-lit photo.",
        });
        continue;
      }

      remember({ opId: op.id, txnId: op.txnId, ts: op.ts, receiptJson: JSON.stringify(receipt) });
      scanned += 1;
    } catch (err) {
      remember({
        opId: op.id,
        txnId: op.txnId,
        ts: op.ts,
        error: err instanceof Error ? err.message : "Couldn't read that photo.",
      });
    }
  }

  return { scanned };
}
