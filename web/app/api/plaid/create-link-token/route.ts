import { NextResponse } from "next/server";
import {
  plaid,
  hasPlaidCredentials,
  PLAID_PRODUCTS,
  PLAID_OPTIONAL_PRODUCTS,
  PLAID_COUNTRY_CODES,
} from "@/lib/plaid";

export async function POST() {
  if (!hasPlaidCredentials()) {
    return NextResponse.json(
      {
        error:
          "Missing Plaid credentials. Add PLAID_CLIENT_ID and PLAID_SECRET to .env.local " +
          "(get them from https://dashboard.plaid.com/developers/keys), then restart the dev server.",
      },
      { status: 400 },
    );
  }
  try {
    const res = await plaid.linkTokenCreate({
      user: { client_user_id: "budgetr-local-user" },
      client_name: "budgetr",
      language: "en",
      products: PLAID_PRODUCTS,
      ...(PLAID_OPTIONAL_PRODUCTS.length > 0
        ? { optional_products: PLAID_OPTIONAL_PRODUCTS }
        : {}),
      country_codes: PLAID_COUNTRY_CODES,
    });
    return NextResponse.json({ link_token: res.data.link_token });
  } catch (err: unknown) {
    const data = (err as { response?: { data?: unknown } })?.response?.data ?? String(err);
    console.error("create-link-token failed:", data);
    return NextResponse.json({ error: data }, { status: 500 });
  }
}
