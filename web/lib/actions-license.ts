"use server";

import { revalidatePath } from "next/cache";
import { setStoredLicenseKey } from "@/lib/app-config";
import { checkLicenseKey } from "@/lib/license";

/**
 * License activation server actions. Validating a key is a local Ed25519
 * signature check (no network) — a good key is stored in `app_settings` and the
 * whole app revalidates so the gate lifts immediately on the next render.
 */

export type ActivateResult = { ok: true; sub: string } | { ok: false; error: string };

/** Verify + store a license key. Returns a typed result for inline form errors. */
export async function activateLicense(rawKey: string): Promise<ActivateResult> {
  const key = rawKey.trim();
  if (!key) return { ok: false, error: "Paste your license key." };

  const result = checkLicenseKey(key);
  if (!result.valid) return { ok: false, error: result.reason };

  setStoredLicenseKey(key);
  revalidatePath("/", "layout");
  return { ok: true, sub: result.payload.sub };
}

/** Remove the stored license key (revert to trial / expired state). */
export async function deactivateLicense(): Promise<void> {
  setStoredLicenseKey(null);
  revalidatePath("/", "layout");
}
