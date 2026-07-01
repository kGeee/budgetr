import { createReadStream } from "node:fs";
import fs from "node:fs";
import { Readable } from "node:stream";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { NextRequest } from "next/server";
import { db } from "@/db";
import { attachments } from "@/db/schema";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

/**
 * GET /api/attachments/[id]
 *
 * Streams a receipt/invoice file back with its stored mime type. The bytes live
 * on disk under ATTACHMENTS_DIR (outside public/), so this auth-scoped route is
 * the only way to reach them. `?download=1` forces a save dialog; otherwise the
 * browser renders images/PDFs inline (used by the detail drawer's thumbnails).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const row = db
    .select({
      filePath: attachments.filePath,
      mimeType: attachments.mimeType,
      originalName: attachments.originalName,
      size: attachments.size,
    })
    .from(attachments)
    .where(eq(attachments.id, id))
    .get();

  if (!row || !fs.existsSync(row.filePath)) {
    return new Response("Not found", { status: 404 });
  }

  const download = req.nextUrl.searchParams.get("download") === "1";
  const fileName = (row.originalName ?? "attachment").replace(/["\r\n]/g, "");

  const nodeStream = createReadStream(row.filePath);
  const body = Readable.toWeb(nodeStream) as unknown as WebReadableStream<Uint8Array>;

  const headers = new Headers({
    "Content-Type": row.mimeType || "application/octet-stream",
    "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${fileName}"`,
    "Cache-Control": "private, no-store",
  });
  if (row.size != null) headers.set("Content-Length", String(row.size));

  return new Response(body as unknown as ReadableStream, { headers });
}
