/**
 * Standard Webhooks signature verification (Polar + Whop). Both sign with
 * https://www.standardwebhooks.com/: headers `webhook-id`, `webhook-timestamp`,
 * `webhook-signature`, where the signature is
 * base64( HMAC-SHA256( secret, `${id}.${timestamp}.${rawBody}` ) ).
 *
 * Secret formats:
 *  - Whop: `ws_…` — pass through as UTF-8 (do not base64-decode)
 *  - Polar: `whsec_…` — base64-decoded per spec, or raw string fallback
 *
 * Redelivery: we do NOT reject on timestamp age. Delivery is idempotent (an
 * order's key is derived from its id, so a replay re-mints the same key).
 */

import crypto from "node:crypto";

export type WebhookHeaders = {
  id?: string | null;
  timestamp?: string | null;
  signature?: string | null;
};

export type VerifyResult = { ok: true } | { ok: false; reason: string };

/** Candidate HMAC keys for Polar (`whsec_…`) and Whop (`ws_…`) secrets. */
function keyCandidates(secret: string): Buffer[] {
  if (secret.startsWith("ws_")) {
    return [Buffer.from(secret, "utf8")];
  }
  const stripped = secret.startsWith("whsec_") ? secret.slice("whsec_".length) : secret;
  const out: Buffer[] = [];
  const b64 = Buffer.from(stripped, "base64");
  if (b64.length > 0) out.push(b64);
  out.push(Buffer.from(secret, "utf8"));
  if (stripped !== secret) out.push(Buffer.from(stripped, "utf8"));
  return out;
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
 * Verify a Standard Webhooks signature. Returns a reason on failure so callers
 * can surface why (missing headers vs. a signature/secret mismatch).
 */
export function verifyStandardWebhook(
  rawBody: string,
  headers: WebhookHeaders,
  secret: string,
): VerifyResult {
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature) {
    return { ok: false, reason: "missing webhook-id / webhook-timestamp / webhook-signature headers" };
  }

  const signedContent = `${id}.${timestamp}.${rawBody}`;
  const provided = signature.split(" ").map((part) => (part.includes(",") ? part.split(",")[1] : part));

  for (const key of keyCandidates(secret)) {
    const expected = crypto.createHmac("sha256", key).update(signedContent).digest("base64");
    if (provided.some((sig) => safeEqualB64(sig, expected))) return { ok: true };
  }

  return {
    ok: false,
    reason: "signature mismatch — webhook signing secret must match this endpoint exactly",
  };
}

/** @deprecated Use verifyStandardWebhook — kept for existing imports/tests. */
export const verifyPolarWebhook = verifyStandardWebhook;
