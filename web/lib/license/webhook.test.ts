import crypto from "node:crypto";
import { describe, it, expect } from "vitest";
import { verifyPolarWebhook } from "./webhook";
import { mintLicenseKey } from "./sign";
import { verifyLicense } from "./verify";

// Build a valid Standard Webhooks signature. `rawKey` true → HMAC over the raw
// secret bytes (custom dashboard secret); otherwise the base64-decoded secret.
function sign(secret: string, id: string, ts: string, body: string, rawKey = false): string {
  const s = secret.startsWith("whsec_") ? secret.slice(6) : secret;
  const key = rawKey ? Buffer.from(secret, "utf8") : Buffer.from(s, "base64");
  const sig = crypto.createHmac("sha256", key).update(`${id}.${ts}.${body}`).digest("base64");
  return `v1,${sig}`;
}

const SECRET = `whsec_${Buffer.from("super-secret-key").toString("base64")}`;
const TS = String(Math.floor(1_700_000_000_000 / 1000));

describe("verifyPolarWebhook", () => {
  const body = JSON.stringify({ type: "order.paid", data: { id: "ord_1" } });

  it("accepts a correctly signed webhook", () => {
    const headers = { id: "msg_1", timestamp: TS, signature: sign(SECRET, "msg_1", TS, body) };
    expect(verifyPolarWebhook(body, headers, SECRET).ok).toBe(true);
  });

  it("accepts a raw (non-base64) string secret", () => {
    const raw = "my-custom-passphrase";
    const headers = { id: "msg_1", timestamp: TS, signature: sign(raw, "msg_1", TS, body, true) };
    expect(verifyPolarWebhook(body, headers, raw).ok).toBe(true);
  });

  it("accepts a re-sent event with an old timestamp (idempotent delivery)", () => {
    const oldTs = String(Math.floor(1_700_000_000_000 / 1000) - 3600);
    const headers = { id: "msg_1", timestamp: oldTs, signature: sign(SECRET, "msg_1", oldTs, body) };
    expect(verifyPolarWebhook(body, headers, SECRET).ok).toBe(true);
  });

  it("rejects a tampered body", () => {
    const headers = { id: "msg_1", timestamp: TS, signature: sign(SECRET, "msg_1", TS, body) };
    expect(verifyPolarWebhook(body + "x", headers, SECRET).ok).toBe(false);
  });

  it("rejects a wrong secret", () => {
    const headers = { id: "msg_1", timestamp: TS, signature: sign(SECRET, "msg_1", TS, body) };
    expect(verifyPolarWebhook(body, headers, "whsec_" + Buffer.from("nope").toString("base64")).ok).toBe(false);
  });

  it("accepts a Whop ws_ secret as UTF-8 (not base64-decoded)", () => {
    const whopSecret = "ws_" + "a".repeat(64);
    const headers = { id: "msg_1", timestamp: TS, signature: sign(whopSecret, "msg_1", TS, body, true) };
    expect(verifyPolarWebhook(body, headers, whopSecret).ok).toBe(true);
  });

  it("rejects missing headers with a reason", () => {
    const r = verifyPolarWebhook(body, { id: null, timestamp: TS, signature: "v1,x" }, SECRET);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/header/i);
  });
});

describe("mintLicenseKey", () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const pub = publicKey.export({ type: "spki", format: "pem" }).toString();
  const priv = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

  it("mints a key that verifies against the matching public key", () => {
    process.env.LICENSE_SIGNING_KEY = priv;
    const key = mintLicenseKey({ email: "buyer@example.com", orderId: "ord_42" });
    const res = verifyLicense(key, pub);
    expect(res.valid).toBe(true);
    if (res.valid) {
      expect(res.payload.sub).toBe("buyer@example.com");
      expect(res.payload.id).toBe("lic_ord_42"); // derived from order → idempotent
      expect(res.payload.exp).toBeNull(); // perpetual
    }
  });

  it("recovers a mangled single-line PEM (env UIs collapse newlines)", () => {
    // Simulate a key pasted into an env UI that stripped the line breaks.
    process.env.LICENSE_SIGNING_KEY = priv.replace(/\n/g, " ");
    const res = verifyLicense(mintLicenseKey({ email: "b@x.com", orderId: "o1" }), pub);
    expect(res.valid).toBe(true);
  });

  it("re-mints the identical key for the same order id (idempotent delivery)", () => {
    process.env.LICENSE_SIGNING_KEY = priv;
    // iat differs by clock, but a fixed order → fixed id; keys with the same
    // second are byte-identical. Assert the id is stable regardless.
    const a = verifyLicense(mintLicenseKey({ email: "b@x.com", orderId: "ord_9" }), pub);
    const b = verifyLicense(mintLicenseKey({ email: "b@x.com", orderId: "ord_9" }), pub);
    expect(a.valid && b.valid && a.payload.id === b.payload.id).toBe(true);
  });
});
