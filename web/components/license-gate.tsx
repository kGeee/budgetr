import { ArrowUpRight, Lock } from "lucide-react";
import { LicenseForm } from "@/components/license-form";
import { LICENSE_BUY_URL, type LicenseStatus } from "@/lib/license";

/**
 * Full-screen block shown when the trial has ended (or a license expired/failed)
 * and no valid license is present. Reassures that data is intact and local, then
 * offers to buy or paste a key. Rendered instead of the app shell by the layout.
 */
export function LicenseGate({ status, reason }: { status: LicenseStatus; reason?: string }) {
  const headline =
    status === "license-expired"
      ? "Your license has expired"
      : status === "license-invalid"
        ? "That key didn't check out"
        : "Your free trial has ended";

  return (
    <div className="mx-auto flex min-h-dvh max-w-lg flex-col items-center justify-center px-6 text-center">
      <span className="grid h-14 w-14 place-items-center rounded-2xl border border-[var(--brass-dim)] bg-[var(--panel)] text-[var(--brass)]">
        <Lock size={24} />
      </span>
      <h1 className="mt-6 font-display text-4xl tracking-tight">{headline}</h1>
      <p className="mt-3 text-[var(--muted)]">
        {reason ? `${reason} ` : ""}Enter a license key to keep using budgetr. Your accounts,
        transactions and settings are untouched — everything stays on this device.
      </p>

      <div className="mt-8 w-full">
        <LicenseForm autoFocus />
      </div>

      <a
        href={LICENSE_BUY_URL}
        target="_blank"
        rel="noreferrer"
        className="mt-6 inline-flex items-center gap-1.5 text-sm text-[var(--brass)] transition hover:underline"
      >
        Buy a license
        <ArrowUpRight size={15} />
      </a>

      <p className="mt-10 text-xs text-[var(--faint)]">
        Already bought one? Paste it above — activation is instant and works offline.
      </p>
    </div>
  );
}
