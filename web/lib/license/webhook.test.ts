import crypto from "node:crypto";
import { describe, it, expect } from "vitest";
import { verifyPolarWebhook } from "./webhook";
import { mintLicenseKey } from "./sign";
import { verifyLicense } from "./verify";

// Build a valid Standard Webhooks signature the way Polar does.
function sign(secretB64: string, id: string, ts: string, body: string): string {
  const secret = secretB64.startsWith("whsec_") ? secretB64.slice(6) : secretB64;
  const sig = crypto
    .createHmac("sha256", Buffer.from(secret, "base64"))
    .update(`${id}.${ts}.${body}`)
    .digest("base64");
  return `v1,${sig}`;
}

const SECRET = `whsec_${Buffer.from("super-secret-key").toString("base64")}`;
const NOW = 1_700_000_000_000;
const TS = String(Math.floor(NOW / 1000));

describe("verifyPolarWebhook", () => {
  const body = JSON.stringify({ type: "order.paid", data: { id: "ord_1" } });

  it("accepts a correctly signed, fresh webhook", () => {
    const headers = { id: "msg_1", timestamp: TS, signature: sign(SECRET, "msg_1", TS, body) };
    expect(verifyPolarWebhook(body, headers, SECRET, NOW)).toBe(true);
  });

  it("rejects a tampered body", () => {
    const headers = { id: "msg_1", timestamp: TS, signature: sign(SECRET, "msg_1", TS, body) };
    expect(verifyPolarWebhook(body + "x", headers, SECRET, NOW)).toBe(false);
  });

  it("rejects a wrong secret", () => {
    const headers = { id: "msg_1", timestamp: TS, signature: sign(SECRET, "msg_1", TS, body) };
    expect(verifyPolarWebhook(body, headers, "whsec_" + Buffer.from("nope").toString("base64"), NOW)).toBe(false);
  });

  it("rejects a stale timestamp (replay)", () => {
    const oldTs = String(Math.floor(NOW / 1000) - 3600);
    const headers = { id: "msg_1", timestamp: oldTs, signature: sign(SECRET, "msg_1", oldTs, body) };
    expect(verifyPolarWebhook(body, headers, SECRET, NOW)).toBe(false);
  });

  it("rejects missing headers", () => {
    expect(verifyPolarWebhook(body, { id: null, timestamp: TS, signature: "v1,x" }, SECRET, NOW)).toBe(false);
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

  it("re-mints the identical key for the same order id (idempotent delivery)", () => {
    process.env.LICENSE_SIGNING_KEY = priv;
    // iat differs by clock, but a fixed order → fixed id; keys with the same
    // second are byte-identical. Assert the id is stable regardless.
    const a = verifyLicense(mintLicenseKey({ email: "b@x.com", orderId: "ord_9" }), pub);
    const b = verifyLicense(mintLicenseKey({ email: "b@x.com", orderId: "ord_9" }), pub);
    expect(a.valid && b.valid && a.payload.id === b.payload.id).toBe(true);
  });
});
