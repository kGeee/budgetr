import { NextResponse } from "next/server";
import {
  isPackagedDesktop,
  isPrivacyGatePending,
  markPrivacyGateComplete,
} from "@/lib/desktop-privacy-gate";

/**
 * Fallback completion endpoint when the Electron preload bridge is unavailable
 * (should not be needed on the packaged path — main-process IPC writes the
 * marker). Still guarded so marketing/dev cannot flip the flag.
 */
export async function POST() {
  if (!isPackagedDesktop() || process.platform !== "win32") {
    return NextResponse.json({ error: "not available" }, { status: 404 });
  }
  if (!isPrivacyGatePending()) {
    return NextResponse.json({ ok: true, already: true });
  }
  try {
    markPrivacyGateComplete();
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "failed" },
      { status: 500 },
    );
  }
}
