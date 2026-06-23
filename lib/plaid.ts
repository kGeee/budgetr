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

export const PLAID_PRODUCTS: Products[] = (process.env.PLAID_PRODUCTS ?? "transactions,investments")
  .split(",")
  .map((p) => p.trim() as Products);

export const PLAID_COUNTRY_CODES: CountryCode[] = (process.env.PLAID_COUNTRY_CODES ?? "US")
  .split(",")
  .map((c) => c.trim() as CountryCode);
