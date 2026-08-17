import { ArrowUpRight, Lock } from "lucide-react";
import { LicenseForm } from "@/components/license-form";
import { LICENSE_BUY_URL, type LicenseStatus } from "@/lib/license";
import { SITE } from "@/lib/site";

/**
 * Full-screen block shown when the trial has ended (or a license expired/failed)
 * and no valid license is present. Rendered instead of the app shell.
 *
 * Buying is the primary action, not a footnote. Someone whose trial just ended
 * almost never has a key in a drawer — they need the pricing page, and the
 * previous layout put a key-entry form front and centre with "Buy a license" as
 * small tertiary text underneath it. The order is reversed for the two states
 * where you'd have arrived without a key; pasting one stays one tap away, and
 * leads for `license-invalid`, where by definition you do have a key and it's
 * the key that's the problem.
 */
export function LicenseGate({ status, reason }: { status: LicenseStatus; reason?: string }) {
  const invalid = status === "license-invalid";

  const headline = invalid
    ? "That key didn't check out"
    : status === "license-expired"
      ? "Your license has expired"
      : "Your free trial has ended";

  const body = invalid
    ? "Check for a stray space or a missing character, or buy a new key below."
    : status === "license-expired"
      ? "Renew to keep using budgetr."
      : "Buy a license to keep using budgetr.";

  const buy = (
    <a
      href={LICENSE_BUY_URL}
      target="_blank"
      rel="noreferrer"
      className="inline-flex w-full items-center justify-center gap-1.5 rounded-full bg-[var(--jade)] px-5 py-2.5 text-sm font-medium text-[var(--on-jade)] transition hover:brightness-105"
    >
      {status === "license-expired" ? "Renew" : "Buy a license"} · {SITE.price}
      <ArrowUpRight size={15} />
    </a>
  );

  const enter = (
    <div className="w-full">
      <p className="mb-2 text-xs uppercase tracking-wide text-[var(--faint)]">
        {invalid ? "Try another key" : "Already have a key?"}
      </p>
      <LicenseForm autoFocus={invalid} />
    </div>
  );

  return (
    <div className="mx-auto flex min-h-dvh max-w-lg flex-col items-center justify-center px-6 text-center">
      <span className="grid h-14 w-14 place-items-center rounded-2xl border border-[var(--brass-dim)] bg-[var(--panel)] text-[var(--brass)]">
        <Lock size={24} />
      </span>
      <h1 className="mt-6 font-display text-4xl tracking-tight">{headline}</h1>
      <p className="mt-3 text-[var(--muted)]">
        {reason ? `${reason} ` : ""}
        {body} Your accounts, transactions and settings are untouched — everything stays on this
        device.
      </p>

      {/* One-time purchase, so the price is the reassurance: say it on the button
          rather than making someone click through to find out. */}
      <div className="mt-8 flex w-full flex-col items-center gap-6">
        {invalid ? enter : buy}
        {invalid ? buy : enter}
      </div>

      <p className="mt-10 text-xs text-[var(--faint)]">
        Activation is instant and works offline — budgetr never phones home to check.
      </p>
    </div>
  );
}
