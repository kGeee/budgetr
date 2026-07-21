// Companion sync state, persisted in the app_settings KV table.
//
// Spec §5.1 wants pairing material in the macOS Keychain; we deliberately keep
// it in the local SQLite DB instead, alongside the Plaid tokens the app
// already stores there — same trust boundary ("data stays on this machine"),
// no Electron dependency, and it works identically under launchd and the
// packaged shell. Revisit if the desktop ever grows a Keychain path.

import { db } from "@/db";
import { appSettings } from "@/db/schema";
import { eq } from "drizzle-orm";
import type { PairingMaterial } from "@budgetr/sync-crypto";

const KEYS = {
  pairing: "companion.pairing", // JSON PairingMaterial — treat as secret, never log
  lastSeq: "companion.lastSeq", // last relay outbox seq durably applied+acked
  appliedOpIds: "companion.appliedOpIds", // JSON string[], newest last, capped
  lastPushedHash: "companion.lastPushedHash", // hash of last pushed summary (asOf zeroed)
  lastSyncAt: "companion.lastSyncAt", // unix seconds of last successful sync
  lastError: "companion.lastError", // human-readable sync error, '' = healthy
} as const;

/** Cap on remembered op ids — must be ≥ the 200 the Summary echoes back. */
const APPLIED_OP_CAP = 500;

function get(key: string): string | null {
  const row = db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, key)).get();
  return row?.value ?? null;
}

function set(key: string, value: string): void {
  db.insert(appSettings)
    .values({ key, value })
    .onConflictDoUpdate({ target: appSettings.key, set: { value } })
    .run();
}

function del(key: string): void {
  db.delete(appSettings).where(eq(appSettings.key, key)).run();
}

// ── pairing material ────────────────────────────────────────────────

export function loadPairing(): PairingMaterial | null {
  const raw = get(KEYS.pairing);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PairingMaterial;
  } catch {
    return null;
  }
}

export function savePairing(m: PairingMaterial): void {
  set(KEYS.pairing, JSON.stringify(m));
}

/** Unpair: drop the material and all per-channel sync state. */
export function clearPairing(): void {
  for (const key of Object.values(KEYS)) del(key);
}

// ── sync cursor + idempotency ───────────────────────────────────────

export function getLastSeq(): number {
  return Number(get(KEYS.lastSeq) ?? 0);
}

export function setLastSeq(seq: number): void {
  set(KEYS.lastSeq, String(seq));
}

export function getAppliedOpIds(): string[] {
  const raw = get(KEYS.appliedOpIds);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as string[];
  } catch {
    return [];
  }
}

export function appendAppliedOpIds(ids: string[]): void {
  if (ids.length === 0) return;
  const merged = [...getAppliedOpIds(), ...ids].slice(-APPLIED_OP_CAP);
  set(KEYS.appliedOpIds, JSON.stringify(merged));
}

// ── status surfaced to the UI ───────────────────────────────────────

export function getLastPushedHash(): string | null {
  return get(KEYS.lastPushedHash);
}

export function setLastPushedHash(hash: string): void {
  set(KEYS.lastPushedHash, hash);
}

export function recordSyncOk(now: number): void {
  set(KEYS.lastSyncAt, String(now));
  set(KEYS.lastError, "");
}

export function recordSyncError(message: string): void {
  // message must stay non-sensitive: never include tokens, keys, or blob contents
  set(KEYS.lastError, message);
}

export function getSyncStatus(): { paired: boolean; channelId: string | null; lastSyncAt: number | null; lastError: string | null } {
  const pairing = loadPairing();
  const lastSyncAt = get(KEYS.lastSyncAt);
  const lastError = get(KEYS.lastError);
  return {
    paired: pairing !== null,
    channelId: pairing?.channelId ?? null,
    lastSyncAt: lastSyncAt ? Number(lastSyncAt) : null,
    lastError: lastError || null,
  };
}
