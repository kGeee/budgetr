import { Configuration, PlaidApi, PlaidEnvironments, Products, CountryCode } from "plaid";
import { getPlaidConfig } from "@/lib/app-config";

/**
 * The active Plaid environment (e.g. "sandbox" | "production"), resolved at call
 * time from the DB-backed config (falling back to env). Was a module constant;
 * it's now a function so a key entered in the UI takes effect without a restart.
 */
export function getPlaidEnv(): string {
  return getPlaidConfig().env;
}

// Memoize the PlaidApi by the resolved credentials so we don't rebuild the SDK
// client on every request, but DO rebuild it the moment the user changes keys.
let cached: { key: string; client: PlaidApi } | null = null;

/**
 * The Plaid SDK client for the current credentials (DB → env). Rebuilds only
 * when the resolved client-id/secret/env changes. Call this per request rather
 * than holding a module-level singleton — credentials are now runtime state.
 */
export function getPlaidClient(): PlaidApi {
  const { clientId, secret, env } = getPlaidConfig();
  const envKey: keyof typeof PlaidEnvironments =
    env in PlaidEnvironments ? (env as keyof typeof PlaidEnvironments) : "sandbox";
  const cacheKey = `${clientId ?? ""}:${secret ?? ""}:${envKey}`;
  if (cached?.key === cacheKey) return cached.client;

  const configuration = new Configuration({
    basePath: PlaidEnvironments[envKey],
    baseOptions: {
      headers: {
        "PLAID-CLIENT-ID": clientId ?? "",
        "PLAID-SECRET": secret ?? "",
      },
    },
  });
  const client = new PlaidApi(configuration);
  cached = { key: cacheKey, client };
  return client;
}

/** True when both Plaid credentials are present (DB or env). */
export function hasPlaidCredentials(): boolean {
  const { clientId, secret } = getPlaidConfig();
  return Boolean(clientId && secret);
}

/**
 * Verify a candidate set of Plaid credentials with an ephemeral client (a
 * link-token dry run) WITHOUT touching the stored config — so onboarding can
 * check keys before persisting them, and never save a bad pair. Returns ok, or
 * a display-ready error message (Plaid's error_message when available).
 */
export async function verifyPlaidCredentials(
  clientId: string,
  secret: string,
  envName: string,
): Promise<{ ok: boolean; error?: string }> {
  const envKey: keyof typeof PlaidEnvironments =
    envName in PlaidEnvironments ? (envName as keyof typeof PlaidEnvironments) : "sandbox";
  const client = new PlaidApi(
    new Configuration({
      basePath: PlaidEnvironments[envKey],
      baseOptions: { headers: { "PLAID-CLIENT-ID": clientId, "PLAID-SECRET": secret } },
    }),
  );
  try {
    await client.linkTokenCreate({
      user: { client_user_id: "budgetr-local-user" },
      client_name: "budgetr",
      language: "en",
      products: PLAID_PRODUCTS,
      ...(PLAID_OPTIONAL_PRODUCTS.length > 0 ? { optional_products: PLAID_OPTIONAL_PRODUCTS } : {}),
      country_codes: PLAID_COUNTRY_CODES,
    });
    return { ok: true };
  } catch (err: unknown) {
    const data = (err as { response?: { data?: { error_message?: string; error_code?: string } } })
      ?.response?.data;
    return {
      ok: false,
      error: data?.error_message || data?.error_code || (err as Error).message || "Could not reach Plaid.",
    };
  }
}

/**
 * Throws a clear, actionable error when Plaid credentials are missing.
 * Call this before any Plaid API request so users get a helpful message
 * instead of an opaque Plaid 400/401 response.
 */
export function assertPlaidCredentials(): void {
  if (!hasPlaidCredentials()) {
    throw new Error(
      "Missing Plaid credentials. Add your Plaid client ID and secret in Settings → " +
        "Connections (get them from https://dashboard.plaid.com/developers/keys).",
    );
  }
}

/**
 * Required products. Plaid's Link flow filters to institutions/accounts that
 * support ALL of these, so keep this to products every account has (e.g.
 * `transactions`, which covers depository AND credit-card accounts). Putting
 * `investments` here would block linking any account without a brokerage.
 */
export const PLAID_PRODUCTS: Products[] = (process.env.PLAID_PRODUCTS ?? "transactions")
  .split(",")
  .map((p) => p.trim())
  .filter(Boolean)
  .map((p) => p as Products);

/**
 * Optional products. Plaid pulls these when the linked institution/accounts
 * support them but does NOT filter institutions or fail Link when they don't —
 * so a credit-card-only Chase login still connects, and investment holdings are
 * fetched automatically when a brokerage account is present.
 */
export const PLAID_OPTIONAL_PRODUCTS: Products[] = (
  process.env.PLAID_OPTIONAL_PRODUCTS ?? "investments"
)
  .split(",")
  .map((p) => p.trim())
  .filter(Boolean)
  .map((p) => p as Products);

export const PLAID_COUNTRY_CODES: CountryCode[] = (process.env.PLAID_COUNTRY_CODES ?? "US")
  .split(",")
  .map((c) => c.trim() as CountryCode);
