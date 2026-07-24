import crypto from "node:crypto";
import { describe, it, expect } from "vitest";
import {
  encodeLicense,
  evaluateEntitlement,
  verifyLicense,
  type LicensePayload,
} from "./verify";

// A throwaway keypair for the suite. `pub` stands in for the embedded public key.
const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
const priv = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const pub = publicKey.export({ type: "spki", format: "pem" }).toString();

const DAY = 86_400_000;
const nowSec = 1_700_000_000;
const nowMs = nowSec * 1000;

function makePayload(over: Partial<LicensePayload> = {}): LicensePayload {
  return { v: 1, id: "lic_test", sub: "test@example.com", iat: nowSec, exp: null, edition: "personal", ...over };
}

describe("verifyLicense", () => {
  it("accepts a well-formed, correctly signed token", () => {
    const token = encodeLicense(makePayload(), priv);
    const res = verifyLicense(token, pub);
    expect(res.valid).toBe(true);
    if (res.valid) expect(res.payload.sub).toBe("test@example.com");
  });

  it("rejects a tampered payload", () => {
    const token = encodeLicense(makePayload({ edition: "personal" }), priv);
    const [prefix, payloadB64, sig] = token.split(".");
    // Flip a byte in the payload; signature no longer matches.
    const bad = Buffer.from(payloadB64, "base64url");
    bad[0] ^= 0xff;
    const forged = `${prefix}.${bad.toString("base64url")}.${sig}`;
    expect(verifyLicense(forged, pub).valid).toBe(false);
  });

  it("rejects a signature from a different key", () => {
    const other = crypto.generateKeyPairSync("ed25519").privateKey.export({
      type: "pkcs8",
      format: "pem",
    }) as string;
    const token = encodeLicense(makePayload(), other);
    expect(verifyLicense(token, pub).valid).toBe(false);
  });

  it("rejects garbage / wrong prefix", () => {
    expect(verifyLicense("not-a-license", pub).valid).toBe(false);
    expect(verifyLicense("JWT1.aaa.bbb", pub).valid).toBe(false);
    expect(verifyLicense("", pub).valid).toBe(false);
  });
});

describe("evaluateEntitlement", () => {
  const base = { firstRunAt: nowMs, now: nowMs, trialDays: 14, publicKeyPem: pub };

  it("is on trial with days left when no license and within the window", () => {
    const e = evaluateEntitlement({ ...base, token: null, now: nowMs + 3 * DAY });
    expect(e.status).toBe("trial");
    expect(e.allowed).toBe(true);
    expect(e.trialDaysLeft).toBe(11);
  });

  it("blocks once the trial has elapsed with no license", () => {
    const e = evaluateEntitlement({ ...base, token: null, now: nowMs + 20 * DAY });
    expect(e.status).toBe("trial-expired");
    expect(e.allowed).toBe(false);
  });

  it("allows a valid perpetual license regardless of trial", () => {
    const token = encodeLicense(makePayload({ exp: null }), priv);
    const e = evaluateEntitlement({ ...base, token, now: nowMs + 999 * DAY });
    expect(e.status).toBe("licensed");
    expect(e.allowed).toBe(true);
    expect(e.expiresAt).toBeNull();
  });

  it("allows a dated license before expiry and blocks after", () => {
    const token = encodeLicense(makePayload({ exp: nowSec + 30 * 86400 }), priv);
    const before = evaluateEntitlement({ ...base, token, now: nowMs + 10 * DAY });
    expect(before.status).toBe("licensed");
    expect(before.allowed).toBe(true);

    const after = evaluateEntitlement({ ...base, token, now: nowMs + 40 * DAY });
    expect(after.status).toBe("license-expired");
    expect(after.allowed).toBe(false);
  });

  it("does not let an invalid key shorten an active trial", () => {
    const e = evaluateEntitlement({ ...base, token: "BGTR1.bogus.sig", now: nowMs + 2 * DAY });
    expect(e.status).toBe("trial");
    expect(e.allowed).toBe(true);
  });

  it("reports an invalid key once the trial is over", () => {
    const e = evaluateEntitlement({ ...base, token: "BGTR1.bogus.sig", now: nowMs + 20 * DAY });
    expect(e.status).toBe("license-invalid");
    expect(e.allowed).toBe(false);
  });
});
