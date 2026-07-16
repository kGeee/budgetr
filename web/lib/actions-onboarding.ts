"use server";

/**
 * Onboarding / connections server actions — persist the user-entered Plaid +
 * Finnhub credentials (into the encrypted app_settings config, see
 * lib/app-config.ts) and verify Plaid keys before saving. Used by the onboarding
 * wizard and the Settings → Connections card.
 */

import { revalidatePath } from "next/cache";
import { setFinnhubKey, setPlaidConfig } from "@/lib/app-config";
import { verifyPlaidCredentials } from "@/lib/plaid";

export type ApiKeysInput = {
  clientId?: string;
  secret?: string;
  /** "sandbox" | "production" */
  env?: string;
  finnhubKey?: string;
};

function normalizeEnv(env?: string): "sandbox" | "production" {
  return env === "production" ? "production" : "sandbox";
}

/**
 * Verify a candidate Plaid client id + secret (no persistence). Returns ok or a
 * display-ready error. Both fields are required to verify.
 */
export async function verifyKeys(input: ApiKeysInput): Promise<{ ok: boolean; error?: string }> {
  const clientId = input.clientId?.trim();
  const secret = input.secret?.trim();
  if (!clientId || !secret) {
    return { ok: false, error: "Enter your Plaid client ID and secret first." };
  }
  return verifyPlaidCredentials(clientId, secret, normalizeEnv(input.env));
}

/**
 * Persist API keys. Plaid client id/secret are only written when both are
 * present (so a blank Plaid pair leaves the existing keys untouched — e.g. when
 * only rotating the Finnhub key); the Plaid environment is always saved. A
 * non-empty Finnhub key is saved; blank leaves it unchanged. Revalidates the app
 * so credential-gated server components re-read immediately (no restart).
 */
export async function saveApiKeys(input: ApiKeysInput): Promise<{ ok: boolean }> {
  const clientId = input.clientId?.trim();
  const secret = input.secret?.trim();

  const cfg: Parameters<typeof setPlaidConfig>[0] = { env: normalizeEnv(input.env) };
  if (clientId && secret) {
    cfg.clientId = clientId;
    cfg.secret = secret;
  }
  setPlaidConfig(cfg);

  if (input.finnhubKey?.trim()) setFinnhubKey(input.finnhubKey.trim());

  revalidatePath("/", "layout");
  return { ok: true };
}
