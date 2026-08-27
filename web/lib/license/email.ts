/**
 * License delivery email via Resend's REST API (no SDK — a single fetch keeps the
 * dependency surface and the marketing/webhook deploy lean). Configure with:
 *   RESEND_API_KEY     — Resend API key (server env only)
 *   LICENSE_FROM_EMAIL — verified sender, e.g. "budgetr <license@budgetr.dev>"
 * Returns a result rather than throwing so the webhook can decide whether to retry.
 */

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const DEFAULT_FROM = "budgetr <license@budgetr.dev>";

export function isEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY?.trim());
}

function bodyHtml(key: string): string {
  return `
    <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;margin:0 auto;color:#1a1a1a">
      <h1 style="font-size:20px">Your budgetr license</h1>
      <p>Thanks for buying budgetr! Here's your license key:</p>
      <pre style="background:#f4f4f2;border:1px solid #e2e2dc;border-radius:8px;padding:14px;font-size:13px;white-space:pre-wrap;word-break:break-all">${key}</pre>
      <p><b>To activate:</b> open budgetr, go to <b>Settings → License</b>, paste the key, and click Activate. It works offline — nothing is sent anywhere.</p>
      <p style="color:#666;font-size:13px">Keep this email; the key is tied to your purchase. Reply here if you need a hand.</p>
    </div>`;
}

function bodyText(key: string): string {
  return [
    "Your budgetr license",
    "",
    "Thanks for buying budgetr! Here's your license key:",
    "",
    key,
    "",
    "To activate: open budgetr → Settings → License, paste the key, and click Activate.",
    "It works offline — nothing is sent anywhere.",
  ].join("\n");
}

export async function sendLicenseEmail(opts: {
  to: string;
  key: string;
}): Promise<{ ok: boolean; error?: string }> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) return { ok: false, error: "RESEND_API_KEY not set" };
  const from = process.env.LICENSE_FROM_EMAIL?.trim() || DEFAULT_FROM;

  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to: [opts.to],
        subject: "Your budgetr license key",
        html: bodyHtml(opts.key),
        text: bodyText(opts.key),
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return { ok: false, error: `Resend ${res.status}: ${detail.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "email send failed" };
  }
}
