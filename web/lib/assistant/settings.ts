/**
 * The AI assistant's preferences, stored in the local `app_settings` KV.
 *
 * Off by default, and nothing leaves the machine until the user has switched it
 * on, saved their own Anthropic API key and acknowledged the notice that their
 * questions (and the figures needed to answer them) are sent to Anthropic.
 *
 * The key is encrypted at rest with the same AES-256-GCM helper as the Plaid
 * secret and Finnhub key (lib/crypto.ts, APP_ENCRYPTION_KEY). Unlike those keys
 * there is deliberately no env fallback: an ANTHROPIC_API_KEY that happens to be
 * set in the shell must never switch the assistant on by itself.
 *
 * Server-only (imports the DB).
 */

import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { appSettings } from "@/db/schema";
import { decrypt, encrypt } from "@/lib/crypto";
import { resolveAssistantModel, type AssistantModel } from "./models";

const K_ENABLED = "assistantEnabled";
const K_KEY = "assistantAnthropicKey";
const K_MODEL = "assistantModel";
const K_NOTICE = "assistantNoticeAck";

function read(key: string): string | null {
  const row = db.select().from(appSettings).where(eq(appSettings.key, key)).get();
  return row?.value ?? null;
}

function write(key: string, value: string | null): void {
  if (value == null) {
    db.delete(appSettings).where(eq(appSettings.key, key)).run();
    return;
  }
  db.insert(appSettings)
    .values({ key, value })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: sql`excluded."value"` } })
    .run();
}

export function isAssistantEnabled(): boolean {
  return read(K_ENABLED) === "1";
}

export function setAssistantEnabled(on: boolean): void {
  write(K_ENABLED, on ? "1" : null);
}

/** The decrypted key, or null when unset or unreadable (e.g. the app key changed). */
export function getAssistantKey(): string | null {
  const stored = read(K_KEY);
  if (!stored) return null;
  try {
    return decrypt(stored);
  } catch {
    return null;
  }
}

/** Store (or clear, with null/empty) the user's Anthropic API key. */
export function setAssistantKey(key: string | null): void {
  const k = key?.trim();
  write(K_KEY, k ? encrypt(k) : null);
}

export function getAssistantModel(): AssistantModel {
  return resolveAssistantModel(read(K_MODEL));
}

export function setAssistantModel(id: string): void {
  write(K_MODEL, resolveAssistantModel(id).id);
}

export function isAssistantNoticeAcknowledged(): boolean {
  return read(K_NOTICE) === "1";
}

export function acknowledgeAssistantNotice(): void {
  write(K_NOTICE, "1");
}

/** What the UI needs to know, without the key itself. */
export type AssistantStatus = {
  enabled: boolean;
  hasKey: boolean;
  /** Last four characters of the saved key, for the "saved · ••••abcd" hint. */
  keyHint: string | null;
  model: string;
  noticeAcknowledged: boolean;
  /** Everything needed before a question may be sent. */
  ready: boolean;
};

export function getAssistantStatus(): AssistantStatus {
  const key = getAssistantKey();
  const enabled = isAssistantEnabled();
  const noticeAcknowledged = isAssistantNoticeAcknowledged();
  return {
    enabled,
    hasKey: Boolean(key),
    keyHint: key ? `••••${key.slice(-4)}` : null,
    model: getAssistantModel().id,
    noticeAcknowledged,
    ready: enabled && Boolean(key) && noticeAcknowledged,
  };
}
