/** budgetr lifetime license on Whop — used to ignore unrelated payments when ids are present. */
export const WHOP_BUDGETR_PRODUCT_ID = "prod_KsEESYFxS0cQW";
export const WHOP_BUDGETR_PLAN_ID = "plan_DZoy04FGD4McW";

export type WhopPaymentExtract = {
  email?: string;
  orderId?: string;
  paid: boolean;
  /** False when plan/product ids are present and do not match budgetr. */
  forBudgetr: boolean;
};

function nestedId(obj: unknown): string | undefined {
  if (!obj || typeof obj !== "object") return undefined;
  const id = (obj as Record<string, unknown>).id;
  return typeof id === "string" ? id : undefined;
}

/** Pull buyer email from common Whop payment payload shapes. */
export function extractWhopBuyerEmail(data: Record<string, unknown>): string | undefined {
  const user = (data.user ?? {}) as Record<string, unknown>;
  const member = (data.member ?? {}) as Record<string, unknown>;
  const customer = (data.customer ?? {}) as Record<string, unknown>;
  return (
    (user.email as string | undefined) ??
    (member.email as string | undefined) ??
    (customer.email as string | undefined) ??
    (data.billing_email as string | undefined) ??
    (data.email as string | undefined)
  );
}

/** True when plan/product ids are absent or match budgetr's Whop listing. */
export function isBudgetrWhopPurchase(data: Record<string, unknown>): boolean {
  const planId = nestedId(data.plan);
  const productId = nestedId(data.product);
  if (planId && planId !== WHOP_BUDGETR_PLAN_ID) return false;
  if (productId && productId !== WHOP_BUDGETR_PRODUCT_ID) return false;
  return true;
}

/** Only deliver on a succeeded payment — not draft/failed/canceled. */
export function isPaidWhopPayment(data: Record<string, unknown>): boolean {
  const status = data.status as string | undefined;
  const substatus = data.substatus as string | undefined;
  if (status === "failed" || status === "canceled" || status === "cancelled" || status === "draft") {
    return false;
  }
  if (status === "succeeded" || substatus === "succeeded") return true;
  // payment.succeeded without a contradictory status — trust the event name.
  return status == null && substatus == null;
}

export function parseWhopPayment(data: Record<string, unknown>): WhopPaymentExtract {
  return {
    email: extractWhopBuyerEmail(data),
    orderId: (data.id as string | undefined) ?? undefined,
    paid: isPaidWhopPayment(data),
    forBudgetr: isBudgetrWhopPurchase(data),
  };
}
