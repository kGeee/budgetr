import { NextResponse } from "next/server";
import { plaid, PLAID_PRODUCTS, PLAID_COUNTRY_CODES } from "@/lib/plaid";

export async function POST() {
  try {
    const res = await plaid.linkTokenCreate({
      user: { client_user_id: "budgetr-local-user" },
      client_name: "budgetr",
      language: "en",
      products: PLAID_PRODUCTS,
      country_codes: PLAID_COUNTRY_CODES,
    });
    return NextResponse.json({ link_token: res.data.link_token });
  } catch (err: unknown) {
    const data = (err as { response?: { data?: unknown } })?.response?.data ?? String(err);
    console.error("create-link-token failed:", data);
    return NextResponse.json({ error: data }, { status: 500 });
  }
}
