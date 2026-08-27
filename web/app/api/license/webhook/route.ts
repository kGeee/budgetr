import { NextResponse } from "next/server";
import { deliverLicense } from "@/lib/license/deliver";
import { verifyStandardWebhook } from "@/lib/license/webhook";
import { parseWhopPayment } from "@/lib/license/whop-payment";

/**
 * Checkout webhooks → mint + email an Ed25519 license key.
 *
 * Handles both:
 *  - Whop `payment.succeeded` (current checkout at whop.com)
 *  - Polar `order.paid` / `order.created` / `order.updated` (legacy orders)
 *
 * Wired to the vendor's checkout deployment only (needs WHOP_WEBHOOK_SECRET or
 * POLAR_WEBHOOK_SECRET + LICENSE_SIGNING_KEY + RESEND_API_KEY). On a self-hosted
 * install these are unset and the route no-ops with 503.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WHOP_DELIVER_ON = new Set(["payment.succeeded"]);
const POLAR_DELIVER_ON = new Set(["order.paid", "order.created", "order.updated"]);

function webhookHeaders(req: Request) {
  const h = (name: string) => req.headers.get(`webhook-${name}`) ?? req.headers.get(`svix-${name}`);
  return { id: h("id"), timestamp: h("timestamp"), signature: h("signature") };
}

// Polar order shapes vary slightly by event; pull the email/id defensively.
function extractPolarOrder(data: Record<string, unknown>): { email?: string; orderId?: string; paid: boolean } {
  const customer = (data.customer ?? {}) as Record<string, unknown>;
  const email =
    (customer.email as string) ??
    (data.customer_email as string) ??
    ((data.user as Record<string, unknown>)?.email as string) ??
    undefined;
  const orderId = (data.id as string) ?? (data.order_id as string) ?? undefined;
  const status = data.status as string | undefined;
  const paid = status == null || status === "paid" || status === "succeeded";
  return { email, orderId, paid };
}

export async function POST(req: Request) {
  const raw = await req.text();
  const headers = webhookHeaders(req);

  let event: { type?: string; data?: Record<string, unknown> };
  try {
    event = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "invalid payload" }, { status: 400 });
  }

  const type = event.type ?? "";
  const isWhop = WHOP_DELIVER_ON.has(type);
  const isPolar = POLAR_DELIVER_ON.has(type);

  if (!isWhop && !isPolar) {
    return NextResponse.json({ ok: true, ignored: type || null });
  }

  const secret = (
    isWhop ? process.env.WHOP_WEBHOOK_SECRET : process.env.POLAR_WEBHOOK_SECRET
  )?.trim();

  if (!secret) {
    return NextResponse.json({ error: "webhook not configured" }, { status: 503 });
  }

  const verdict = verifyStandardWebhook(raw, headers, secret);
  if (!verdict.ok) {
    console.error(`[license webhook] rejected (${isWhop ? "whop" : "polar"}): ${verdict.reason}`);
    return NextResponse.json({ error: verdict.reason }, { status: 401 });
  }

  const { email, orderId, paid } = isWhop
    ? (() => {
        const whop = parseWhopPayment(event.data ?? {});
        return { email: whop.email, orderId: whop.orderId, paid: whop.paid && whop.forBudgetr };
      })()
    : extractPolarOrder(event.data ?? {});

  if (!paid) {
    return NextResponse.json({
      ok: true,
      ignored: isWhop ? "unpaid-or-not-budgetr" : "unpaid",
    });
  }
  if (!email) return NextResponse.json({ error: "no buyer email in event" }, { status: 422 });

  const result = await deliverLicense({ email, orderId });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({ ok: true, delivered: email });
}
