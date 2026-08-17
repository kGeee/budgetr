import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { OcrLine } from "./types";

/**
 * On-device receipt OCR.
 *
 * Server-only. The image is handed to Apple's Vision framework through a tiny
 * Swift helper (desktop/bin/receipt-ocr.swift) that runs on this machine and
 * talks to nothing. No upload, no API key, no vision model — which is the point.
 * budgetr's whole pitch is "data stays on this machine", and receipt scanning
 * would otherwise be the first feature to break it.
 *
 * The tradeoff is honest and worth stating: a hosted vision model would read a
 * crumpled receipt better than a rule-based parser over Vision's text. If that
 * trade is ever worth making it belongs behind an explicit, off-by-default
 * setting — not smuggled in as an implementation detail.
 *
 * Everywhere Vision isn't available (Linux, the read-only web demo, a Mac
 * without the Swift toolchain) this returns `unsupported` and the UI falls back
 * to typing the items in. Scanning is a shortcut, never the only door.
 */

const run = promisify(execFile);

export type OcrResult =
  | { ok: true; lines: OcrLine[] }
  | { ok: false; reason: "unsupported" | "failed"; message: string };

/**
 * Where the helper lives, in preference order.
 *
 * A packaged build ships the binary already compiled (see
 * desktop/scripts/build-receipt-ocr.sh) because compiling Swift needs the Xcode
 * command line tools, which a customer's Mac usually does not have. Shipping the
 * .swift source alone is why scanning reported itself unavailable on the DMG
 * while working perfectly in development.
 *
 * `process.resourcesPath` is Electron's app-bundle Resources dir; the
 * `desktop/bin` entries cover `next start` and dev, where cwd is the web root.
 */
function candidateBinaries(): string[] {
  const resources = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  return [
    resources ? path.join(resources, "receipt-ocr") : null,
    resources ? path.join(resources, "bin", "receipt-ocr") : null,
    path.join(process.cwd(), "desktop", "bin", "receipt-ocr"),
    path.join(process.cwd(), "web", "desktop", "bin", "receipt-ocr"),
  ].filter((p): p is string => p != null);
}

/** A prebuilt helper, if one shipped with this install. */
function prebuiltBinary(): string | null {
  for (const candidate of candidateBinaries()) {
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch {
      /* unreadable path — try the next */
    }
  }
  return null;
}

/** Where a locally-compiled helper is cached between runs (development only). */
function binaryPath(): string {
  return path.join(os.tmpdir(), "budgetr-receipt-ocr");
}

function sourcePath(): string {
  return path.join(process.cwd(), "desktop", "bin", "receipt-ocr.swift");
}

/** True when this box could plausibly run the helper at all. */
export function ocrAvailable(): boolean {
  // The read-only web demo runs on serverless Linux with a throwaway filesystem;
  // never try to shell out there.
  if (process.env.DEMO_DB) return false;
  if (process.platform !== "darwin") return false;
  // Either a shipped binary, or the source plus a toolchain to build it.
  return prebuiltBinary() != null || fs.existsSync(sourcePath());
}

/**
 * Resolve the helper, compiling it only if this install shipped source without a
 * binary — which is the development case.
 *
 * The dev build is cached by a hash of the source so editing the Swift rebuilds
 * it, while a normal run pays nothing.
 */
async function ensureBinary(): Promise<string> {
  const shipped = prebuiltBinary();
  if (shipped) return shipped;

  const src = sourcePath();
  const source = await fs.promises.readFile(src);
  const stamp = createHash("sha256").update(source).digest("hex").slice(0, 12);
  const bin = `${binaryPath()}-${stamp}`;

  if (fs.existsSync(bin)) return bin;

  await run("swiftc", ["-O", "-o", bin, src], { timeout: 120_000 });
  return bin;
}

/**
 * Recognize text in a receipt image.
 *
 * `imagePath` must already be on disk — callers write the upload through
 * lib/attachments.ts so the photo lives beside the transaction it belongs to
 * rather than in a temp file nobody owns.
 */
export async function recognizeReceipt(imagePath: string): Promise<OcrResult> {
  if (!ocrAvailable()) {
    return {
      ok: false,
      reason: "unsupported",
      message:
        process.platform === "darwin"
          ? "On-device text recognition isn't available in this build."
          : "Receipt scanning uses macOS on-device text recognition, so it only runs on a Mac.",
    };
  }

  let bin: string;
  try {
    bin = await ensureBinary();
  } catch (err) {
    return {
      ok: false,
      reason: "unsupported",
      message:
        "Couldn't prepare the on-device text recognizer. Enter the items by hand, or " +
        `install the Xcode command line tools (xcode-select --install). (${errText(err)})`,
    };
  }

  try {
    // maxBuffer: a dense receipt is a few hundred KB of JSON at most; 8 MB is
    // headroom, not an expectation.
    const { stdout } = await run(bin, [imagePath], { timeout: 60_000, maxBuffer: 8 << 20 });
    const parsed = JSON.parse(stdout) as OcrLine[];
    if (!Array.isArray(parsed)) throw new Error("recognizer returned an unexpected shape");
    return { ok: true, lines: parsed.filter((l) => typeof l?.text === "string") };
  } catch (err) {
    return { ok: false, reason: "failed", message: errText(err) };
  }
}

function errText(err: unknown): string {
  if (err && typeof err === "object" && "stderr" in err) {
    const stderr = String((err as { stderr?: unknown }).stderr ?? "").trim();
    if (stderr) return stderr.split("\n")[0];
  }
  return err instanceof Error ? err.message : String(err);
}
