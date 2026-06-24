import { Configuration, PlaidApi, PlaidEnvironments, Products, CountryCode } from "plaid";

const env = (process.env.PLAID_ENV ?? "sandbox") as keyof typeof PlaidEnvironments;

/** The active Plaid environment (e.g. "sandbox" | "production"). */
export const PLAID_ENV: string = String(env);

const configuration = new Configuration({
  basePath: PlaidEnvironments[env],
  baseOptions: {
    headers: {
      "PLAID-CLIENT-ID": process.env.PLAID_CLIENT_ID,
      "PLAID-SECRET": process.env.PLAID_SECRET,
    },
  },
});

export const plaid = new PlaidApi(configuration);

/** True when both Plaid credentials are present in the environment. */
export function hasPlaidCredentials(): boolean {
  return Boolean(process.env.PLAID_CLIENT_ID?.trim() && process.env.PLAID_SECRET?.trim());
}

/**
 * Throws a clear, actionable error when Plaid credentials are missing.
 * Call this before any Plaid API request so users get a helpful message
 * instead of an opaque Plaid 400/401 response.
 */
export function assertPlaidCredentials(): void {
  if (!hasPlaidCredentials()) {
    throw new Error(
      "Missing Plaid credentials. Add PLAID_CLIENT_ID and PLAID_SECRET to .env.local " +
        "(get them from https://dashboard.plaid.com/developers/keys), then restart the dev server.",
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
