import { NextResponse } from "next/server";
import { syncAllItems } from "@/lib/sync";

export async function POST() {
  try {
    const results = await syncAllItems();
    return NextResponse.json({ ok: true, results });
  } catch (err: unknown) {
    const data = (err as { response?: { data?: unknown } })?.response?.data ?? String(err);
    console.error("sync failed:", data);
    return NextResponse.json({ error: data }, { status: 500 });
  }
}
