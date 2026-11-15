import { BadgeCheck, Clock, ShieldAlert } from "lucide-react";
import { LicenseForm, LicenseRemoveButton } from "@/components/license/license-form";
import { SettingRow } from "@/app/(app)/settings/setting-row";
import { LICENSE_BUY_URL, TRIAL_DAYS, type Entitlement } from "@/lib/license";

/**
 * Settings row for license status + activation. Reads the entitlement resolved
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
    <SettingRow
      align={licensed ? "center" : "start"}
      title={
        licensed && entitlement.payload ? (
          <span className="flex items-center gap-2">
            <BadgeCheck size={16} className="shrink-0 text-[var(--jade)]" />
            <span>
              Licensed to {entitlement.payload.sub}
              <span className="font-normal text-[var(--muted)]">
                {" "}
                · {entitlement.payload.edition}
              </span>
            </span>
          </span>
        ) : status === "trial" ? (
          <span className="flex items-center gap-2">
            <Clock size={16} className="shrink-0 text-[var(--brass)]" />
            Free trial
          </span>
        ) : (
          <span className="flex items-center gap-2">
            <ShieldAlert size={16} className="shrink-0 text-[var(--coral)]" />
            No active license
          </span>
        )
      }
      control={
        licensed ? (
          <LicenseRemoveButton />
        ) : (
          <div className="w-[26rem] max-w-full space-y-3">
            <LicenseForm />
            <a
              href={LICENSE_BUY_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-block text-sm text-[var(--brass)] transition hover:underline"
            >
              Buy a license →
            </a>
          </div>
        )
      }
    >
      {licensed && entitlement.payload ? (
        entitlement.expiresAt ? (
          `Valid until ${fmtDate(entitlement.expiresAt)}.`
        ) : (
          "Perpetual license — no expiry."
        )
      ) : status === "trial" ? (
        <>
          You&apos;re on the free trial —{" "}
          <span className="text-[var(--paper)]">
            {entitlement.trialDaysLeft} of {TRIAL_DAYS} days
          </span>{" "}
          remaining. Activate a license to keep budgetr after it ends.
        </>
      ) : (
        <>{entitlement.reason ?? "No active license."} Enter a key to continue.</>
      )}
    </SettingRow>
  );
}
