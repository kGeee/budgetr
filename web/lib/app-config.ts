/**
 * Runtime app configuration — Plaid + Finnhub credentials the user enters in the
 * onboarding wizard (or Settings), stored in the local `app_settings` KV table.
 *
 * Why this exists: `lib/plaid.ts` and `lib/finnhub.ts` used to read credentials
 * from `process.env` once at module load and build a singleton client, so keys
 * could only be supplied by hand-editing a `.env` file + restarting. This module
 * resolves credentials at REQUEST time from the DB, falling back to env, so keys
 * entered in the UI take effect immediately and existing self-host/dev setups
 * (which set env vars) keep working unchanged.
 *
 * Secrets (Plaid secret, Finnhub key) are encrypted at rest with the same
 * AES-256-GCM helper used for Plaid access tokens (`lib/crypto.ts`,
 * APP_ENCRYPTION_KEY). Reads are synchronous — better-sqlite3 is synchronous —
 * so callers stay simple. Server-only (imports the DB); never import from a
 * client component.
 */

import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { appSettings } from "@/db/schema";
import { encrypt, decrypt } from "@/lib/crypto";

// app_settings keys. Secrets (…_SECRET / FINNHUB) are stored encrypted.
const K_PLAID_CLIENT_ID = "plaidClientId";
const K_PLAID_SECRET = "plaidSecret";
const K_PLAID_ENV = "plaidEnv";
const K_FINNHUB = "finnhubApiKey";

function readSetting(key: string): string | null {
  const row = db.select().from(appSettings).where(eq(appSettings.key, key)).get();
  return row?.value ?? null;
}

function writeSetting(key: string, value: string | null): void {
  if (value == null) {
    db.delete(appSettings).where(eq(appSettings.key, key)).run();
    return;
  }
  db.insert(appSettings)
    .values({ key, value })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: sql`excluded."value"` } })
    .run();
}

/** Decrypt a stored secret, returning null if it can't be read (e.g. the key
 * changed). We never want a bad stored blob to throw during a normal request. */
function safeDecrypt(payload: string | null): string | null {
  if (!payload) return null;
  try {
    return decrypt(payload);
  } catch {
    return null;
  }
}

function env(name: string): string | null {
  return process.env[name]?.trim() || null;
}

// ── Plaid ───────────────────────────────────────────────────────────────────

export type PlaidConfig = {
  clientId: string | null;
  secret: string | null;
  /** "sandbox" | "production" (Plaid environment name). */
  env: string;
  /** True when this config came from the DB (vs. an env fallback). */
  fromDb: boolean;
};

/** Default Plaid environment when neither DB nor env specify one. */
export const DEFAULT_PLAID_ENV = "sandbox";

/**
 * Pure precedence resolver (no DB/env access) — DB value wins, else the env
 * fallback, else the default. Extracted so the precedence is unit-testable
 * without touching the database. `fromDb` reflects whether the user has entered
 * credentials in the app (client id or secret present in the DB).
 */
export function resolvePlaidConfig(
  dbValues: { clientId: string | null; secret: string | null; env: string | null },
  envValues: { clientId?: string | null; secret?: string | null; env?: string | null },
): PlaidConfig {
  const pick = (a: string | null, b?: string | null): string | null => a || b?.trim() || null;
  return {
    clientId: pick(dbValues.clientId, envValues.clientId),
    secret: pick(dbValues.secret, envValues.secret),
    env: pick(dbValues.env, envValues.env) || DEFAULT_PLAID_ENV,
    fromDb: Boolean(dbValues.clientId || dbValues.secret),
  };
}

/** Resolve Plaid credentials: DB first, then env fallback. */
export function getPlaidConfig(): PlaidConfig {
  return resolvePlaidConfig(
    {
      clientId: readSetting(K_PLAID_CLIENT_ID),
      secret: safeDecrypt(readSetting(K_PLAID_SECRET)),
      env: readSetting(K_PLAID_ENV),
    },
    {
      clientId: env("PLAID_CLIENT_ID"),
      secret: env("PLAID_SECRET"),
      env: env("PLAID_ENV"),
    },
  );
}

/** Persist Plaid credentials. Undefined fields are left unchanged; passing null
 * (or an empty string) clears a field back to the env fallback. */
export function setPlaidConfig(cfg: {
  clientId?: string | null;
  secret?: string | null;
  env?: string | null;
}): void {
  if (cfg.clientId !== undefined) writeSetting(K_PLAID_CLIENT_ID, cfg.clientId?.trim() || null);
  if (cfg.secret !== undefined) {
    const s = cfg.secret?.trim();
    writeSetting(K_PLAID_SECRET, s ? encrypt(s) : null);
  }
  if (cfg.env !== undefined) writeSetting(K_PLAID_ENV, cfg.env?.trim() || null);
}

// ── Finnhub ─────────────────────────────────────────────────────────────────

/** Pure precedence resolver for a single optional secret: DB value, else env. */
export function resolveKey(dbValue: string | null, envValue: string | null | undefined): string | null {
  return dbValue || envValue?.trim() || null;
}

/** Resolve the Finnhub API key: DB first, then env fallback. */
export function getFinnhubKey(): string | null {
  return resolveKey(safeDecrypt(readSetting(K_FINNHUB)), env("FINNHUB_API_KEY"));
}

/** Persist (or clear, with null/empty) the Finnhub API key. */
export function setFinnhubKey(key: string | null): void {
  const k = key?.trim();
  writeSetting(K_FINNHUB, k ? encrypt(k) : null);
}
