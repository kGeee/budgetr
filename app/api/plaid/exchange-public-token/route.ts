import { NextResponse } from "next/server";
import { plaid, PLAID_ENV } from "@/lib/plaid";
import { db } from "@/db";
import { items } from "@/db/schema";
import { encrypt } from "@/lib/crypto";
import { syncItem } from "@/lib/sync";

export async function POST(req: Request) {
  try {
    const { public_token, institution } = await req.json();
    if (!public_token) {
      return NextResponse.json({ error: "Missing public_token" }, { status: 400 });
    }

    const exchange = await plaid.itemPublicTokenExchange({ public_token });
    const accessToken = exchange.data.access_token;
    const itemId = exchange.data.item_id;
    const now = new Date();

    db.insert(items)
      .values({
        id: itemId,
        accessToken: encrypt(accessToken),
        plaidEnv: PLAID_ENV,
        institutionId: institution?.institution_id ?? null,
        institutionName: institution?.name ?? null,
        status: "active",
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: items.id,
        set: {
          accessToken: encrypt(accessToken),
          plaidEnv: PLAID_ENV,
          status: "active",
          error: null,
          updatedAt: now,
        },
      })
      .run();

    // Initial pull so the dashboard has data immediately.
    const stored = db.select().from(items).all().find((i) => i.id === itemId)!;
    let synced: unknown = null;
    try {
      synced = await syncItem(stored);
    } catch (e) {
      // Sandbox sometimes returns PRODUCT_NOT_READY on first call; the user can
      // hit "Sync" shortly after. Don't fail the link for it.
      console.warn("initial sync deferred:", (e as Error).message);
    }

    return NextResponse.json({ ok: true, item_id: itemId, synced });
  } catch (err: unknown) {
    const data = (err as { response?: { data?: unknown } })?.response?.data ?? String(err);
    console.error("exchange-public-token failed:", data);
    return NextResponse.json({ error: data }, { status: 500 });
  }
}
