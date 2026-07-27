/**
 * Polar webhook signature verification. Polar signs webhooks with the
 * Standard Webhooks spec (https://www.standardwebhooks.com/): headers
 * `webhook-id`, `webhook-timestamp`, `webhook-signature`, where the signature is
 * base64( HMAC-SHA256( secret, `${id}.${timestamp}.${rawBody}` ) ).
 *
 * Two real-world wrinkles this handles:
 *  - Secret encoding: the spec base64-decodes the secret (optionally `whsec_`
 *    prefixed), but a *custom* secret set in a dashboard is often a raw string.
 *    We try both key derivations so either works.
 *  - Redelivery: we do NOT reject on timestamp age. Standard Webhooks suggests a
 *    tolerance for replay protection, but our delivery is idempotent (an order's
 *    key is derived from its id, so a replay re-mints the same key and re-emails
 *    the same buyer — harmless), and rejecting stale timestamps breaks manually
 *    re-sending an older event from the Polar dashboard.
 *
 * Verified with node:crypto so the webhook route needs no SDK. Pure + testable.
 */

import crypto from "node:crypto";

export type WebhookHeaders = {
  id?: string | null;
  timestamp?: string | null;
  signature?: string | null;
};

export type VerifyResult = { ok: true } | { ok: false; reason: string };

/** Candidate HMAC keys, covering base64-encoded (spec) and raw-string secrets. */
function keyCandidates(secret: string): Buffer[] {
  const stripped = secret.startsWith("whsec_") ? secret.slice("whsec_".length) : secret;
  const out: Buffer[] = [];
  const b64 = Buffer.from(stripped, "base64");
  if (b64.length > 0) out.push(b64); // Standard Webhooks: base64-decoded secret
  out.push(Buffer.from(secret, "utf8")); // raw secret as shown
  if (stripped !== secret) out.push(Buffer.from(stripped, "utf8")); // raw, prefix stripped
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
export function verifyPolarWebhook(
  rawBody: string,
  headers: WebhookHeaders,
  secret: string,
): VerifyResult {
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature) {
    return { ok: false, reason: "missing webhook-id / webhook-timestamp / webhook-signature headers" };
  }

  const signedContent = `${id}.${timestamp}.${rawBody}`;
  // The header is a space-delimited list of `v1,<sig>` (versioned) entries.
  const provided = signature.split(" ").map((part) => (part.includes(",") ? part.split(",")[1] : part));

  for (const key of keyCandidates(secret)) {
    const expected = crypto.createHmac("sha256", key).update(signedContent).digest("base64");
    if (provided.some((sig) => safeEqualB64(sig, expected))) return { ok: true };
  }

  return {
    ok: false,
    reason: "signature mismatch — POLAR_WEBHOOK_SECRET must match this endpoint's signing secret exactly",
  };
}
