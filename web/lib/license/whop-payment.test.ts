import { describe, it, expect } from "vitest";
import {
  WHOP_BUDGETR_PLAN_ID,
  WHOP_BUDGETR_PRODUCT_ID,
  extractWhopBuyerEmail,
  isBudgetrWhopPurchase,
  isPaidWhopPayment,
  parseWhopPayment,
} from "./whop-payment";
import crypto from "node:crypto";
import { mintLicenseKey } from "./sign";
import { verifyLicense } from "./verify";

describe("extractWhopBuyerEmail", () => {
  it("reads user.email first", () => {
    expect(extractWhopBuyerEmail({ user: { email: "a@x.com" }, member: { email: "b@x.com" } })).toBe(
      "a@x.com",
    );
  });

  it("falls back through member, customer, and top-level fields", () => {
    expect(extractWhopBuyerEmail({ member: { email: "m@x.com" } })).toBe("m@x.com");
    expect(extractWhopBuyerEmail({ customer: { email: "c@x.com" } })).toBe("c@x.com");
    expect(extractWhopBuyerEmail({ billing_email: "b@x.com" })).toBe("b@x.com");
  });
});

describe("isBudgetrWhopPurchase", () => {
  it("accepts budgetr product + plan ids", () => {
    expect(
      isBudgetrWhopPurchase({
        product: { id: WHOP_BUDGETR_PRODUCT_ID },
        plan: { id: WHOP_BUDGETR_PLAN_ID },
      }),
    ).toBe(true);
  });

  it("accepts when ids are omitted (defensive)", () => {
    expect(isBudgetrWhopPurchase({ id: "pay_1" })).toBe(true);
  });

  it("rejects a different plan or product when ids are present", () => {
    expect(isBudgetrWhopPurchase({ plan: { id: "plan_other" } })).toBe(false);
    expect(isBudgetrWhopPurchase({ product: { id: "prod_other" } })).toBe(false);
  });
});

describe("isPaidWhopPayment", () => {
  it("accepts succeeded status", () => {
    expect(isPaidWhopPayment({ status: "succeeded" })).toBe(true);
    expect(isPaidWhopPayment({ substatus: "succeeded" })).toBe(true);
  });

  it("rejects failed, canceled, and draft", () => {
    expect(isPaidWhopPayment({ status: "failed" })).toBe(false);
    expect(isPaidWhopPayment({ status: "canceled" })).toBe(false);
    expect(isPaidWhopPayment({ status: "draft" })).toBe(false);
  });

  it("trusts payment.succeeded when status is absent", () => {
    expect(isPaidWhopPayment({ id: "pay_1" })).toBe(true);
  });
});

describe("parseWhopPayment", () => {
  it("parses a full budgetr payment payload", () => {
    const r = parseWhopPayment({
      id: "pay_abc123",
      status: "succeeded",
      user: { email: "buyer@example.com" },
      product: { id: WHOP_BUDGETR_PRODUCT_ID },
      plan: { id: WHOP_BUDGETR_PLAN_ID },
    });
    expect(r).toEqual({
      email: "buyer@example.com",
      orderId: "pay_abc123",
      paid: true,
      forBudgetr: true,
    });
  });
});

describe("Whop payment id → idempotent license", () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const pub = publicKey.export({ type: "spki", format: "pem" }).toString();
  const priv = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

  it("re-mints the identical key for the same pay_ id", () => {
    process.env.LICENSE_SIGNING_KEY = priv;
    const orderId = "pay_abc123";
    const a = verifyLicense(mintLicenseKey({ email: "b@x.com", orderId, edition: "personal", days: null }), pub);
    const b = verifyLicense(mintLicenseKey({ email: "b@x.com", orderId, edition: "personal", days: null }), pub);
    expect(a.valid && b.valid && a.payload.id === b.payload.id).toBe(true);
    if (a.valid) expect(a.payload.id).toBe("lic_pay_abc123");
  });
});
