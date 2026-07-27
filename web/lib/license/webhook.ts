/**
 * Polar webhook signature verification. Polar signs webhooks with the
 * Standard Webhooks spec (https://www.standardwebhooks.com/): headers
 * `webhook-id`, `webhook-timestamp`, `webhook-signature`, where the signature is
 * base64( HMAC-SHA256( secret, `${id}.${timestamp}.${rawBody}` ) ). The secret
 * Polar shows is base64, often prefixed `whsec_`.
 *
 * Verified with node:crypto so the webhook route needs no SDK. Pure + testable.
 */

import crypto from "node:crypto";

export type WebhookHeaders = {
  id?: string | null;
  timestamp?: string | null;
  signature?: string | null;
};

/** Max clock skew (seconds) tolerated between the signed timestamp and now. */
const TOLERANCE_SECONDS = 5 * 60;

function decodeSecret(secret: string): Buffer {
  const raw = secret.startsWith("whsec_") ? secret.slice("whsec_".length) : secret;
  return Buffer.from(raw, "base64");
}

function safeEqualB64(a: string, b: string): boolean {
  try {
    const ba = Buffer.from(a, "base64");
    const bb = Buffer.from(b, "base64");
    return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}

/**
 * Verify a Standard Webhooks signature. `now` is injectable for testing. Returns
 * false on any missing header, stale timestamp, or signature mismatch.
 */
export function verifyPolarWebhook(
  rawBody: string,
  headers: WebhookHeaders,
  secret: string,
  now: number = Date.now(),
): boolean {
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature) return false;

  // Reject stale/future timestamps (replay protection).
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(now / 1000 - ts) > TOLERANCE_SECONDS) return false;

  const expected = crypto
    .createHmac("sha256", decodeSecret(secret))
    .update(`${id}.${timestamp}.${rawBody}`)
    .digest("base64");

  // The header is a space-delimited list of `v1,<sig>` (versioned) entries.
  const provided = signature.split(" ").map((part) => (part.includes(",") ? part.split(",")[1] : part));
  return provided.some((sig) => safeEqualB64(sig, expected));
}
