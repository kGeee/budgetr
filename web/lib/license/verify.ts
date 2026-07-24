/**
 * Offline license verification — pure, dependency-free, and unit-testable.
 *
 * A license key is an Ed25519-signed token the vendor issues; the app embeds only
 * the PUBLIC key and verifies signatures locally, so activation never phones home
 * (fitting budgetr's "data stays on this machine" promise). This module holds the
 * key format + signature checking + the trial/license state machine as pure
 * functions; the DB-backed wiring and the embedded public key live in
 * `lib/license.ts`.
 *
 * Token format:  BGTR1.<base64url(payloadJSON)>.<base64url(ed25519-sig)>
 * The signature covers the ASCII string "BGTR1.<base64url(payloadJSON)>", so the
 * prefix + payload are tamper-evident together.
 */

import crypto from "node:crypto";

const PREFIX = "BGTR1";
const DAY_MS = 86_400_000;

/** The claims carried in a license token. Times are unix SECONDS. */
export type LicensePayload = {
  /** Format version. */
  v: 1;
  /** Opaque license id (for support / revocation lists). */
  id: string;
  /** Who it's issued to — email or name. Shown in Settings. */
  sub: string;
  /** Issued-at (unix seconds). */
  iat: number;
  /** Expiry (unix seconds), or null for a perpetual license. */
  exp: number | null;
  /** Edition/plan label, e.g. "personal". */
  edition: string;
};

export type VerifyResult =
  | { valid: true; payload: LicensePayload }
  | { valid: false; reason: string };

function b64urlEncode(buf: Buffer | string): string {
  return Buffer.from(buf).toString("base64url");
}

function b64urlDecode(s: string): Buffer {
  return Buffer.from(s, "base64url");
}

/**
 * Canonical JSON with a fixed key order, so the exact bytes we sign are
 * reproducible regardless of object construction order.
 */
function canonicalPayload(p: LicensePayload): string {
  return JSON.stringify({
    v: p.v,
    id: p.id,
    sub: p.sub,
    iat: p.iat,
    exp: p.exp,
    edition: p.edition,
  });
}

/** Sign a payload into a license token. Vendor-side only (needs the private key). */
export function encodeLicense(payload: LicensePayload, privateKeyPem: string): string {
  const body = `${PREFIX}.${b64urlEncode(canonicalPayload(payload))}`;
  const key = crypto.createPrivateKey(privateKeyPem);
  // Ed25519 uses a null digest algorithm.
  const sig = crypto.sign(null, Buffer.from(body, "ascii"), key);
  return `${body}.${b64urlEncode(sig)}`;
}

/**
 * Parse + signature-verify a token against the public key. Does NOT check
 * expiry (that's time-dependent and handled in evaluateEntitlement) — a valid
 * result here means "authentic, untampered", not "currently active".
 */
export function verifyLicense(token: string, publicKeyPem: string): VerifyResult {
  const raw = token.trim();
  const parts = raw.split(".");
  if (parts.length !== 3 || parts[0] !== PREFIX) {
    return { valid: false, reason: "Not a valid budgetr license key." };
  }
  const [, payloadB64, sigB64] = parts;
  const body = `${PREFIX}.${payloadB64}`;

  let ok = false;
  try {
    const key = crypto.createPublicKey(publicKeyPem);
    ok = crypto.verify(null, Buffer.from(body, "ascii"), key, b64urlDecode(sigB64));
  } catch {
    return { valid: false, reason: "License key is malformed." };
  }
  if (!ok) return { valid: false, reason: "License signature doesn't match." };

  let payload: LicensePayload;
  try {
    payload = JSON.parse(b64urlDecode(payloadB64).toString("utf8")) as LicensePayload;
  } catch {
    return { valid: false, reason: "License payload is unreadable." };
  }
  if (payload.v !== 1 || !payload.id || !payload.sub || typeof payload.iat !== "number") {
    return { valid: false, reason: "Unsupported license version." };
  }
  return { valid: true, payload };
}

// ── Entitlement state machine ────────────────────────────────────────────────

export type LicenseStatus =
  /** A valid, unexpired license is installed. */
  | "licensed"
  /** No license, but still inside the free trial window. */
  | "trial"
  /** No license and the trial has elapsed. */
  | "trial-expired"
  /** A valid license that has passed its expiry date. */
  | "license-expired"
  /** A key is installed but fails verification (and trial is over). */
  | "license-invalid";

export type Entitlement = {
  status: LicenseStatus;
  /** Whether the app may be used right now. */
  allowed: boolean;
  /** Whole days remaining in the trial (0 when not on trial). */
  trialDaysLeft: number;
  /** License expiry (unix seconds) when licensed, else null. */
  expiresAt: number | null;
  /** Present when a valid license backs the entitlement. */
  payload?: LicensePayload;
  /** Human-readable detail for invalid/expired states. */
  reason?: string;
};

/**
 * Resolve the current entitlement from a (possibly absent) token, the install's
 * first-run timestamp, and the clock. A valid license wins; otherwise the trial
 * clock decides. A present-but-invalid key never *shortens* an active trial — it
 * only surfaces once the trial is over.
 */
export function evaluateEntitlement(args: {
  token: string | null;
  /** First-run timestamp in ms since epoch (start of the trial). */
  firstRunAt: number;
  /** Current time in ms since epoch. */
  now: number;
  /** Trial length in days. */
  trialDays: number;
  publicKeyPem: string;
}): Entitlement {
  const { token, firstRunAt, now, trialDays, publicKeyPem } = args;

  const verified = token ? verifyLicense(token, publicKeyPem) : null;

  if (verified?.valid) {
    const exp = verified.payload.exp;
    if (exp != null && exp * 1000 < now) {
      return {
        status: "license-expired",
        allowed: false,
        trialDaysLeft: 0,
        expiresAt: exp,
        payload: verified.payload,
        reason: "This license has expired.",
      };
    }
    return {
      status: "licensed",
      allowed: true,
      trialDaysLeft: 0,
      expiresAt: exp,
      payload: verified.payload,
    };
  }

  // No valid license → the trial window governs.
  const msLeft = firstRunAt + trialDays * DAY_MS - now;
  if (msLeft > 0) {
    return {
      status: "trial",
      allowed: true,
      trialDaysLeft: Math.ceil(msLeft / DAY_MS),
      expiresAt: null,
    };
  }

  // Trial is over. If a key was supplied but didn't verify, say so.
  if (token) {
    return {
      status: "license-invalid",
      allowed: false,
      trialDaysLeft: 0,
      expiresAt: null,
      reason: verified && !verified.valid ? verified.reason : "License key is invalid.",
    };
  }
  return {
    status: "trial-expired",
    allowed: false,
    trialDaysLeft: 0,
    expiresAt: null,
    reason: "Your free trial has ended.",
  };
}
