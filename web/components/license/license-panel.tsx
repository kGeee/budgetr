import { BadgeCheck, Clock, ShieldAlert } from "lucide-react";
import { LicenseForm, LicenseRemoveButton } from "@/components/license-form";
import { LICENSE_BUY_URL, TRIAL_DAYS, type Entitlement } from "@/lib/license";

/**
 * Settings card for license status + activation. Reads the entitlement resolved
 * by the page and renders the right affordance: licensed → details + remove;
 * trial/expired/invalid → the activation form and a buy link.
 */
export function LicensePanel({ entitlement }: { entitlement: Entitlement }) {
  const { status } = entitlement;
  const licensed = status === "licensed";

  const fmtDate = (unixSeconds: number) =>
    new Date(unixSeconds * 1000).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });

  return (
    <div className="space-y-5">
      {/* Status line */}
      {licensed && entitlement.payload ? (
        <div className="flex items-start gap-3">
          <BadgeCheck size={18} className="mt-0.5 shrink-0 text-[var(--jade)]" />
          <div>
            <p className="text-sm text-[var(--paper)]">
              Licensed to <span className="font-medium">{entitlement.payload.sub}</span>
              <span className="text-[var(--muted)]"> · {entitlement.payload.edition}</span>
            </p>
            <p className="mt-0.5 text-sm text-[var(--muted)]">
              {entitlement.expiresAt
                ? `Valid until ${fmtDate(entitlement.expiresAt)}.`
                : "Perpetual license — no expiry."}
            </p>
          </div>
        </div>
      ) : status === "trial" ? (
        <div className="flex items-start gap-3">
          <Clock size={18} className="mt-0.5 shrink-0 text-[var(--brass)]" />
          <p className="text-sm text-[var(--muted)]">
            You&apos;re on the free trial —{" "}
            <span className="text-[var(--paper)]">
              {entitlement.trialDaysLeft} of {TRIAL_DAYS} days
            </span>{" "}
            remaining. Activate a license to keep budgetr after it ends.
          </p>
        </div>
      ) : (
        <div className="flex items-start gap-3">
          <ShieldAlert size={18} className="mt-0.5 shrink-0 text-[var(--coral)]" />
          <p className="text-sm text-[var(--muted)]">
            {entitlement.reason ?? "No active license."} Enter a key below to continue.
          </p>
        </div>
      )}

      {/* Action */}
      {licensed ? (
        <LicenseRemoveButton />
      ) : (
        <>
          <LicenseForm />
          <a
            href={LICENSE_BUY_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-block text-sm text-[var(--brass)] transition hover:underline"
          >
            Buy a license →
          </a>
        </>
      )}
    </div>
  );
}
