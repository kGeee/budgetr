import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/**
 * On-disk storage for receipt/invoice attachments. The bytes live under
 * ATTACHMENTS_DIR (default ./data/attachments, alongside the SQLite file) —
 * outside public/, so they're only reachable through the auth-scoped streaming
 * route at app/api/attachments/[id]. One file on disk ⇄ one `attachments` row.
 *
 * The directory is created lazily (recursive) the same way db/index.ts ensures
 * the DB's parent dir exists before opening it.
 */
const ATTACHMENTS_DIR = process.env.ATTACHMENTS_DIR ?? "./data/attachments";

/** Absolute path to the attachments dir, creating it (recursively) if missing. */
function attachmentsDir(): string {
  const dir = path.resolve(/* turbopackIgnore: true */ ATTACHMENTS_DIR);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Persist an uploaded file's bytes to disk under a collision-proof name (random
 * prefix + the original extension) and return the absolute path written, to be
 * stored in `attachments.file_path`. `originalName` is only used for its
 * extension here; the human-readable name is kept in its own metadata column.
 */
export function saveAttachmentFile(buffer: Buffer, originalName: string): string {
  const dir = attachmentsDir();
  const ext = path.extname(originalName).slice(0, 12); // guard against absurd extensions
  const fileName = `${crypto.randomUUID()}${ext}`;
  const filePath = path.join(dir, fileName);
  fs.writeFileSync(filePath, buffer);
  return filePath;
}

/** Remove an attachment's file from disk; a missing file is not an error. */
export function deleteAttachmentFile(filePath: string): void {
  try {
    fs.rmSync(filePath, { force: true });
  } catch {
    // Best-effort: the metadata row is the source of truth and is deleted regardless.
  }
}
