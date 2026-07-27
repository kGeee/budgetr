import { NextResponse } from "next/server";
import { verifyPolarWebhook } from "@/lib/license/webhook";
import { isMintingConfigured, mintLicenseKey } from "@/lib/license/sign";
import { isEmailConfigured, sendLicenseEmail } from "@/lib/license/email";

/**
 * Polar checkout webhook → mint + email an Ed25519 license key.
 *
 * Wired to the vendor's checkout deployment only (needs POLAR_WEBHOOK_SECRET +
 * LICENSE_SIGNING_KEY + RESEND_API_KEY). On a self-hosted install these are unset
 * and the route no-ops with 503, so it's inert there and never exposes the key.
 *
 * Flow: verify the Standard Webhooks signature → on a paid order, derive the
 * buyer email + order id, mint a perpetual license (id derived from the order so
 * retries re-mint the same key), and email it via Resend.
 */
export const runtime = "nodejs"; // node:crypto for signature verification
export const dynamic = "force-dynamic";

// Polar order shapes vary slightly by event; pull the email/id defensively.
function extractOrder(data: Record<string, unknown>): { email?: string; orderId?: string; paid: boolean } {
  const customer = (data.customer ?? {}) as Record<string, unknown>;
  const email =
    (customer.email as string) ??
    (data.customer_email as string) ??
    ((data.user as Record<string, unknown>)?.email as string) ??
    undefined;
  const orderId = (data.id as string) ?? (data.order_id as string) ?? undefined;
  // order.paid implies paid; for order.created/updated, gate on status.
  const status = data.status as string | undefined;
  const paid = status == null || status === "paid" || status === "succeeded";
  return { email, orderId, paid };
}

export async function POST(req: Request) {
  const raw = await req.text();

  const secret = process.env.POLAR_WEBHOOK_SECRET?.trim();
  if (!secret) {
    // Not the checkout deployment — nothing to do.
    return NextResponse.json({ error: "webhook not configured" }, { status: 503 });
  }

  const ok = verifyPolarWebhook(raw, {
    id: req.headers.get("webhook-id"),
    timestamp: req.headers.get("webhook-timestamp"),
    signature: req.headers.get("webhook-signature"),
  }, secret);
  if (!ok) return NextResponse.json({ error: "invalid signature" }, { status: 401 });

  let event: { type?: string; data?: Record<string, unknown> };
  try {
    event = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "invalid payload" }, { status: 400 });
  }

  // Deliver on a completed one-time purchase.
  const DELIVER_ON = new Set(["order.paid", "order.created", "order.updated"]);
  if (!event.type || !DELIVER_ON.has(event.type)) {
    return NextResponse.json({ ok: true, ignored: event.type ?? null });
  }

  const { email, orderId, paid } = extractOrder(event.data ?? {});
  if (!paid) return NextResponse.json({ ok: true, ignored: "unpaid" });
  if (!email) return NextResponse.json({ error: "no buyer email in event" }, { status: 422 });
  if (!isMintingConfigured() || !isEmailConfigured()) {
    return NextResponse.json({ error: "minting/email not configured" }, { status: 503 });
  }

  try {
    const key = mintLicenseKey({ email, orderId, edition: "personal", days: null });
    const sent = await sendLicenseEmail({ to: email, key });
    if (!sent.ok) {
      // 500 → Polar retries later (the derived key is stable, so it's safe).
      return NextResponse.json({ error: `email failed: ${sent.error}` }, { status: 500 });
    }
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "delivery failed" },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, delivered: email });
}
