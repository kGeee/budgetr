"use client";

/**
 * The persistent "you're exploring demo data" bar shown across the app while
 * demo mode is on (see lib/demo-data.ts).
 *
 * Two flavours, chosen by `webDemo`:
 *  - In the desktop app: the CTA opens the interactive Plaid setup modal — a
 *    fresh install lands on a populated dashboard and this is how the user
 *    graduates to their real accounts.
 *  - On the read-only web demo (marketing site, DEMO_DB): there's nothing to set
 *    up, so the CTA is "Download budgetr" — the conversion path off the live demo.
 *
 * Rendered by the app layout. Dismiss hides it for the session only (it returns
 * on the next load) so the CTA is never permanently lost.
 */

import { useEffect, useState } from "react";
import { ArrowUpRight, Sparkles, X } from "lucide-react";
import { PlaidSetupModal, type PlaidSetupInitial } from "@/components/plaid-setup-modal";
import { hasCheckout, primaryCtaHref, SITE } from "@/lib/site";

const DISMISS_KEY = "budgetr:demo-banner-dismissed";

export function DemoBanner({
  initial,
  webDemo = false,
}: {
  initial: Omit<PlaidSetupInitial, "demo">;
  webDemo?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [hidden, setHidden] = useState(false);

  // Read the session dismiss after mount — sessionStorage isn't available during
  // SSR, so this can't be a render-time initializer without a hydration mismatch.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reading a browser API post-mount
    if (sessionStorage.getItem(DISMISS_KEY) === "1") setHidden(true);
  }, []);

  const dismiss = () => {
    sessionStorage.setItem(DISMISS_KEY, "1");
    setHidden(true);
  };

  if (hidden) return null;

  return (
    <>
      <div className="flex items-center gap-3 border-b border-[var(--brass-dim)] bg-[color-mix(in_srgb,var(--brass)_10%,transparent)] px-4 py-2.5 text-sm sm:px-8">
        <Sparkles size={16} className="shrink-0 text-[var(--brass)]" />
        <p className="min-w-0 text-[var(--paper)]/90">
          {webDemo ? (
            <>
              <span className="font-medium">This is a live demo of budgetr.</span>{" "}
              <span className="hidden text-[var(--muted)] sm:inline">
                Explore freely — it&apos;s all sample data. Download the app to track your own
                finances, private on your Mac.
              </span>
            </>
          ) : (
            <>
              <span className="font-medium">You&apos;re exploring demo data.</span>{" "}
              <span className="hidden text-[var(--muted)] sm:inline">
                Everything here is sample data — connect your accounts to track your real finances.
              </span>
            </>
          )}
        </p>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          {webDemo ? (
            <a
              href={primaryCtaHref()}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded-lg bg-[var(--brass)] px-3 py-1.5 text-[13px] font-medium text-[var(--on-brass)] hover:opacity-90"
            >
              {hasCheckout() ? `Get budgetr · ${SITE.price}` : "Download budgetr"}
              <ArrowUpRight size={14} />
            </a>
          ) : (
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="rounded-lg bg-[var(--brass)] px-3 py-1.5 text-[13px] font-medium text-[var(--on-brass)] hover:opacity-90"
            >
              Set up my accounts
            </button>
          )}
          <button
            type="button"
            onClick={dismiss}
            aria-label="Dismiss"
            className="grid h-7 w-7 place-items-center rounded-lg text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--paper)]"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {!webDemo && open && (
        <PlaidSetupModal initial={{ ...initial, demo: true }} onClose={() => setOpen(false)} />
      )}
    </>
  );
}
