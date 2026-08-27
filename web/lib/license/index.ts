/**
 * License/trial policy for this install — the single guard the app enforces.
 *
 * Because the desktop (Electron) app runs this very Next server locally, gating
 * here covers both the self-hosted web app and the desktop app with one guard.
 * The read-only web demo is exempt (it's the free showcase), and self-hosters can
 * opt out entirely with BUDGETR_LICENSE_DISABLED=1.
 *
 * Server-only (reads the DB). Pure verification + the trial state machine live in
 * ./verify; this module supplies the embedded public key, the trial length, and
 * the DB-backed inputs.
 */

import { ensureFirstRunAt, getStoredLicenseKey } from "@/lib/app-config";
import { LICENSE_PUBLIC_KEY } from "@/lib/license/public-key";
import { evaluateEntitlement, verifyLicense, type Entitlement } from "@/lib/license/verify";
import { checkoutHref } from "@/lib/site";

export type { Entitlement, LicensePayload, LicenseStatus } from "@/lib/license/verify";

/** Length of the free trial, in days. */
export const TRIAL_DAYS = 14;

/**
 * Where to send someone who wants to buy — the checkout itself, not the
 * marketing page.
 *
 * This pointed at /pricing, which was harmless while that page's CTA was "Buy".
 * Now that every marketing surface hands over the download instead, bouncing
 * the gate through /pricing would offer a fresh download to someone who already
 * has the app open. Resolves to Whop when checkout is configured, and falls
 * back to /pricing when it isn't, so the button is never dead.
 */
export const LICENSE_BUY_URL = checkoutHref();

/** Env escape hatch for self-hosters running their own instance. */
function licenseDisabled(): boolean {
  return process.env.BUDGETR_LICENSE_DISABLED === "1";
}

/** The active token: the DB-stored key, else a BUDGETR_LICENSE_KEY env fallback
 *  (mirrors how Plaid/Finnhub creds resolve DB-first, then env). */
function activeToken(): string | null {
  return getStoredLicenseKey() ?? process.env.BUDGETR_LICENSE_KEY?.trim() ?? null;
}

/**
 * Resolve the current entitlement for this install. Initializes the trial clock
 * on first call (via ensureFirstRunAt). Never throws — a licensing check must not
 * be able to take the whole app down, so any unexpected error fails OPEN (allows
 * use) rather than locking a paying user out.
 */
export function getEntitlement(now: number = Date.now()): Entitlement {
  try {
    if (licenseDisabled()) {
      return { status: "licensed", allowed: true, trialDaysLeft: 0, expiresAt: null };
    }
    const firstRunAt = ensureFirstRunAt();
    return evaluateEntitlement({
      token: activeToken(),
      firstRunAt,
      now,
      trialDays: TRIAL_DAYS,
      publicKeyPem: LICENSE_PUBLIC_KEY,
    });
  } catch {
    // Fail open: better to under-enforce than to brick a legitimate install.
    return { status: "licensed", allowed: true, trialDaysLeft: 0, expiresAt: null };
  }
}

/** Verify a candidate key without storing it — used by the activation action. */
export function checkLicenseKey(token: string) {
  return verifyLicense(token, LICENSE_PUBLIC_KEY);
}
