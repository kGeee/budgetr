import { isMintingConfigured, mintLicenseKey } from "@/lib/license/sign";
import { isEmailConfigured, sendLicenseEmail } from "@/lib/license/email";

/** Mint a license key and email it to the buyer. Idempotent when `orderId` is set. */
export async function deliverLicense(opts: {
  email: string;
  orderId?: string;
}): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  if (!isMintingConfigured() || !isEmailConfigured()) {
    return { ok: false, status: 503, error: "minting/email not configured" };
  }

  try {
    const key = mintLicenseKey({ email: opts.email, orderId: opts.orderId, edition: "personal", days: null });
    const sent = await sendLicenseEmail({ to: opts.email, key });
    if (!sent.ok) {
      return { ok: false, status: 500, error: `email failed: ${sent.error}` };
    }
  } catch (err) {
    return {
      ok: false,
      status: 500,
      error: err instanceof Error ? err.message : "delivery failed",
    };
  }

  return { ok: true };
}
