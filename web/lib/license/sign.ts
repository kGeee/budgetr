/**
 * Vendor-side license minting — signs an Ed25519 license token with the PRIVATE
 * key held only by the vendor's checkout deployment (never a user install).
 *
 * The key comes from the LICENSE_SIGNING_KEY env var (the PEM contents of
 * scripts/license/signing-key.private.pem). Set it ONLY on the marketing/checkout
 * deployment that runs the Polar webhook — never on a self-hosted app, or anyone
 * with that env could mint their own licenses. Server-only.
 */

import crypto from "node:crypto";
import { encodeLicense, type LicensePayload } from "@/lib/license/verify";

/** Whether this deployment is configured to mint licenses (has the private key). */
export function isMintingConfigured(): boolean {
  return Boolean(process.env.LICENSE_SIGNING_KEY?.trim());
}

/** Normalize a PEM stored in an env var (newlines may arrive escaped as \n). */
function readPrivateKey(): string {
  const raw = process.env.LICENSE_SIGNING_KEY?.trim();
  if (!raw) throw new Error("LICENSE_SIGNING_KEY is not set.");
  return raw.includes("\\n") ? raw.replace(/\\n/g, "\n") : raw;
}

/**
 * Mint a signed license key for a buyer. When `orderId` is given, the license id
 * is derived from it so a webhook retry re-mints the IDENTICAL key (idempotent
 * delivery). `days` null ⇒ perpetual (a one-time purchase).
 */
export function mintLicenseKey(opts: {
  email: string;
  orderId?: string | null;
  edition?: string;
  days?: number | null;
}): string {
  const nowSec = Math.floor(Date.now() / 1000);
  const id = opts.orderId
    ? `lic_${String(opts.orderId).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40)}`
    : `lic_${crypto.randomBytes(6).toString("hex")}`;
  const payload: LicensePayload = {
    v: 1,
    id,
    sub: opts.email,
    iat: nowSec,
    exp: opts.days ? nowSec + opts.days * 86400 : null,
    edition: opts.edition ?? "personal",
  };
  return encodeLicense(payload, readPrivateKey());
}
