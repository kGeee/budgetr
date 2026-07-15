import { describe, it, expect } from "vitest";
import { DEFAULT_PLAID_ENV, resolveKey, resolvePlaidConfig } from "@/lib/app-config";

// These cover the DB → env → default precedence in isolation (no database). The
// DB read/write + encryption-at-rest paths are exercised by the onboarding e2e.

describe("resolvePlaidConfig", () => {
  const noDb = { clientId: null, secret: null, env: null };
  const noEnv = { clientId: null, secret: null, env: null };

  it("uses env when the DB is empty, and marks it not-from-db", () => {
    const c = resolvePlaidConfig(noDb, { clientId: "env-id", secret: "env-secret", env: "production" });
    expect(c).toEqual({ clientId: "env-id", secret: "env-secret", env: "production", fromDb: false });
  });

  it("prefers DB values over env, and marks fromDb", () => {
    const c = resolvePlaidConfig(
      { clientId: "db-id", secret: "db-secret", env: "sandbox" },
      { clientId: "env-id", secret: "env-secret", env: "production" },
    );
    expect(c).toEqual({ clientId: "db-id", secret: "db-secret", env: "sandbox", fromDb: true });
  });

  it("falls back to the default env when neither source sets one", () => {
    expect(resolvePlaidConfig(noDb, noEnv).env).toBe(DEFAULT_PLAID_ENV);
  });

  it("trims env values and treats blanks as absent", () => {
    const c = resolvePlaidConfig(noDb, { clientId: "  id  ", secret: "   ", env: "" });
    expect(c.clientId).toBe("id");
    expect(c.secret).toBeNull();
    expect(c.env).toBe(DEFAULT_PLAID_ENV);
  });

  it("fromDb is true when only the client id is stored (secret via env)", () => {
    const c = resolvePlaidConfig(
      { clientId: "db-id", secret: null, env: null },
      { clientId: null, secret: "env-secret", env: null },
    );
    expect(c.fromDb).toBe(true);
    expect(c.secret).toBe("env-secret");
  });
});

describe("resolveKey", () => {
  it("prefers the DB value", () => {
    expect(resolveKey("db-key", "env-key")).toBe("db-key");
  });
  it("falls back to a trimmed env value", () => {
    expect(resolveKey(null, "  env-key  ")).toBe("env-key");
  });
  it("returns null when neither is set (blank env)", () => {
    expect(resolveKey(null, "   ")).toBeNull();
    expect(resolveKey(null, undefined)).toBeNull();
  });
});
