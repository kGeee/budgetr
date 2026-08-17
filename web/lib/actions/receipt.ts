"use server";

import crypto from "node:crypto";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { attachments, transactions } from "@/db/schema";
import { saveAttachmentFile } from "@/lib/attachments";
import { parseReceipt } from "@/lib/receipt/parse";
import { ocrAvailable, recognizeReceipt } from "@/lib/receipt/ocr";
import type { ParsedReceipt } from "@/lib/receipt/types";

/**
 * Server Actions for receipt scanning.
 *
 * The photo is written to the same attachment store as any other receipt
 * (data/attachments, outside public/) and stays there — scanning it is a local
 * read, not an upload. `scanReceipt` is deliberately the only entry point that
 * touches an image, so there is exactly one place to audit if the privacy
 * question is ever revisited.
 */

export type ScanResult =
  | { ok: true; receipt: ParsedReceipt; attachmentId: string }
  | { ok: false; error: string; canRetry: boolean };

/** Whether this machine can scan at all — drives the UI's manual-entry fallback. */
export async function receiptScanAvailable(): Promise<boolean> {
  return ocrAvailable();
}

/**
 * Read a photographed receipt into line items, and keep the photo attached to
 * the transaction so the split can be checked against it later.
 *
 * Returns a friendly error rather than throwing: a blurry photo is an ordinary
 * outcome, and the modal's answer to it is "type the items in", not a stack
 * trace.
 */
export async function scanReceipt(form: FormData): Promise<ScanResult> {
  const txnId = String(form.get("transactionId") ?? "");
  const file = form.get("file");

  if (!txnId) return { ok: false, error: "Missing transaction.", canRetry: false };
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Choose a photo of the receipt.", canRetry: true };
  }
  if (!file.type.startsWith("image/")) {
    return { ok: false, error: "That's not an image — take a photo or screenshot the receipt.", canRetry: true };
  }
  if (file.size > 25 * 1024 * 1024) {
    return { ok: false, error: "That photo is too large (max 25 MB).", canRetry: true };
  }

  const txn = db
    .select({ id: transactions.id })
    .from(transactions)
    .where(eq(transactions.id, txnId))
    .get();
  if (!txn) return { ok: false, error: "Transaction not found.", canRetry: false };

  const buffer = Buffer.from(await file.arrayBuffer());
  const filePath = saveAttachmentFile(buffer, file.name || "receipt.jpg");

  const attachmentId = `att_${crypto.randomUUID().slice(0, 8)}`;
  db.insert(attachments)
    .values({
      id: attachmentId,
      transactionId: txnId,
      filePath,
      mimeType: file.type || null,
      size: file.size,
      originalName: file.name || "receipt",
      createdAt: new Date(),
    })
    .run();

  const ocr = await recognizeReceipt(filePath);
  if (!ocr.ok) {
    // The photo is saved and attached either way — the user can still split by
    // hand with the receipt right there next to the form.
    return { ok: false, error: ocr.message, canRetry: ocr.reason === "failed" };
  }

  const receipt = parseReceipt(ocr.lines);
  if (receipt.items.length === 0) {
    return {
      ok: false,
      error:
        "Couldn't find any line items — try a straighter, better-lit photo, or add the items by hand.",
      canRetry: true,
    };
  }

  revalidatePath("/", "layout");
  return { ok: true, receipt, attachmentId };
}
