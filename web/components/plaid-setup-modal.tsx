"use client";

/**
 * Interactive, in-app walkthrough for connecting real accounts via Plaid —
 * launched from the demo banner ("Set up my accounts") or anywhere else that
 * wants a guided setup without leaving the current page.
 *
 * It mirrors the full-page onboarding wizard but as a modal, and adds a demo
 * teardown as its first step: when the app is showing demo data, committing to
 * setup clears that data (via the exitDemoMode action) before any real bank is
 * linked, so demo + real data never mix.
 *
 * The heavy lifting is reused, not reimplemented: keys are entered and
 * live-verified through <ApiKeysForm> (a bad pair is never saved), and the bank
 * link is the same <PlaidLink> used across the app — so this is genuinely
 * interactive, not a gallery of screenshots. Optional annotated screenshots can
 * be dropped into /public/onboarding/*.png and they appear automatically; if a
 * file is absent the figure simply hides.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, ShieldCheck, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ApiKeysForm } from "@/components/api-keys-form";
import { PlaidLink } from "@/components/plaid-link";
import { Stepper, Step, Walk, A } from "@/components/onboarding-steps";
import { exitDemoMode } from "@/lib/actions-onboarding";

export type PlaidSetupInitial = {
  hasPlaidKeys: boolean;
  env: string;
  hasFinnhub: boolean;
  clientIdHint: string | null;
  /** True when the app is currently showing demo data (adds the teardown step). */
  demo: boolean;
};

const STEPS = ["Start", "Create account", "Get keys", "Enter keys", "Connect", "Done"] as const;

export function PlaidSetupModal({
  initial,
  onClose,
}: {
  initial: PlaidSetupInitial;
  onClose: () => void;
}) {
  const router = useRouter();
  // Resume sensibly if keys already exist (e.g. re-opened from Settings).
  const [step, setStep] = useState(initial.hasPlaidKeys ? 3 : 0);
  const [clearing, startClear] = useTransition();
  const [syncing, startSync] = useTransition();

  // Step 0 → clear demo data (if any) before entering the real-setup flow.
  const begin = () =>
    startClear(async () => {
      if (initial.demo) await exitDemoMode();
      setStep(1);
    });

  const finish = () =>
    startSync(async () => {
      try {
        await fetch("/api/plaid/sync", { method: "POST" });
      } catch {
        // Non-fatal — the dashboard's Sync button can retry.
      }
      router.refresh();
      onClose();
    });

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-[var(--scrim)] p-4 sm:p-6"
      onClick={(e) => e.target === e.currentTarget && onClose()}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Connect your accounts"
        className="my-auto w-full max-w-xl rounded-[var(--radius)] border border-line bg-[var(--panel)] text-[var(--paper)] shadow-[var(--elev-3)]"
      >
        <div className="flex items-center justify-between border-b border-line px-6 py-4">
          <h3 className="font-display text-lg tracking-tight">Connect your accounts</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid h-8 w-8 place-items-center rounded-lg text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--paper)]"
          >
            <X size={18} />
          </button>
        </div>

        <div className="space-y-6 p-6">
          <Stepper steps={STEPS} step={step} />

          {step === 0 && (
            <Step
              title="Set up your real accounts"
              nextLabel={initial.demo ? "Clear demo & continue" : "Get started"}
              next={initial.demo ? undefined : () => setStep(1)}
              body={
                <>
                  <p>
                    You&apos;re currently exploring budgetr with <b>demo data</b>. To track your own
                    finances you&apos;ll connect your banks through <b>Plaid</b> — this takes about 5
                    minutes and needs a free Plaid account.
                  </p>
                  <p className="mt-3 inline-flex items-center gap-2 text-[var(--jade)]">
                    <ShieldCheck size={15} /> Your keys are encrypted and never leave this device.
                  </p>
                  {initial.demo && (
                    <>
                      <p className="mt-4 rounded-lg border border-[var(--brass-dim)] bg-[color-mix(in_srgb,var(--brass)_8%,transparent)] px-3 py-2.5 text-[13px] text-[var(--paper)]/90">
                        Continuing clears the demo data so you start with a clean slate. You can&apos;t
                        undo this — but it&apos;s only sample data.
                      </p>
                      <div className="mt-8 flex items-center justify-between">
                        <button
                          type="button"
                          onClick={onClose}
                          className="text-sm text-[var(--muted)] hover:text-[var(--paper)]"
                        >
                          Keep exploring
                        </button>
                        <Button variant="primary" onClick={begin} disabled={clearing}>
                          {clearing ? <Loader2 size={15} className="animate-spin" /> : null}
                          {clearing ? "Clearing…" : "Clear demo & continue"}
                        </Button>
                      </div>
                    </>
                  )}
                </>
              }
            />
          )}

          {step === 1 && (
            <Step
              title="Create a free Plaid account"
              back={() => setStep(0)}
              next={() => setStep(2)}
              body={
                <>
                  <ol className="space-y-4">
                    <Walk n={1}>
                      Go to <A href="https://dashboard.plaid.com/signup">dashboard.plaid.com/signup</A>{" "}
                      and create a free developer account (email + password).
                    </Walk>
                    <Walk n={2}>
                      Verify your email and sign in. You don&apos;t need to request production access
                      yet — <b>Sandbox</b> works immediately with fake bank logins.
                    </Walk>
                  </ol>
                  <Figure src="/onboarding/plaid-signup.png" alt="Plaid sign-up page" />
                </>
              }
            />
          )}

          {step === 2 && (
            <Step
              title="Copy your API keys"
              back={() => setStep(1)}
              next={() => setStep(3)}
              body={
                <>
                  <ol className="space-y-4">
                    <Walk n={1}>
                      Open <A href="https://dashboard.plaid.com/developers/keys">Developers → Keys</A>{" "}
                      in the Plaid dashboard.
                    </Walk>
                    <Walk n={2}>
                      Copy your <b>client_id</b> and the <b>Sandbox</b> secret (or your Production
                      secret once approved). You&apos;ll paste both on the next step.
                    </Walk>
                    <Walk n={3}>
                      Choose an environment: <b>Sandbox</b> is free and uses fake data — log in with{" "}
                      <code className="mono">user_good</code> / <code className="mono">pass_good</code>.{" "}
                      <b>Production</b> connects your real banks (Plaid grants it on request,
                      pay-as-you-go with a free allowance).
                    </Walk>
                  </ol>
                  <Figure src="/onboarding/plaid-keys.png" alt="Plaid Developers → Keys page" />
                </>
              }
            />
          )}

          {step === 3 && (
            <Step
              title="Enter your keys"
              back={() => setStep(2)}
              body={
                <>
                  <p className="mb-5">
                    Paste your keys below. budgetr verifies them with Plaid before saving — a bad pair
                    is never stored. You can change these later in Settings.
                  </p>
                  <ApiKeysForm
                    initial={{
                      hasPlaidKeys: initial.hasPlaidKeys,
                      env: initial.env,
                      hasFinnhub: initial.hasFinnhub,
                      clientIdHint: initial.clientIdHint,
                    }}
                    saveLabel="Save & continue"
                    onSaved={() => setStep(4)}
                  />
                </>
              }
            />
          )}

          {step === 4 && (
            <Step
              title="Connect a bank"
              back={() => setStep(3)}
              body={
                <>
                  <p className="mb-5">
                    Launch Plaid and connect a card, bank, or brokerage. In Sandbox, search any
                    institution and log in with <code className="mono">user_good</code> /{" "}
                    <code className="mono">pass_good</code>.
                  </p>
                  <PlaidLink onConnected={() => setStep(5)} />
                  <button
                    type="button"
                    onClick={onClose}
                    className="mt-5 block text-sm text-[var(--muted)] hover:text-[var(--paper)]"
                  >
                    Skip for now — I&apos;ll connect from the dashboard
                  </button>
                </>
              }
            />
          )}

          {step === 5 && (
            <div className="py-2 text-center">
              <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl border border-[color-mix(in_srgb,var(--jade)_40%,transparent)] bg-[color-mix(in_srgb,var(--jade)_10%,transparent)] text-[var(--jade)]">
                <CheckCircle2 size={26} />
              </span>
              <h2 className="mt-5 font-display text-2xl tracking-tight">You&apos;re all set</h2>
              <p className="mx-auto mt-3 max-w-sm text-[var(--muted)]">
                budgetr is connected. Let&apos;s pull your first sync and refresh your dashboard.
              </p>
              <div className="mt-8 flex justify-center">
                <Button variant="primary" onClick={finish} disabled={syncing}>
                  {syncing ? <Loader2 size={15} className="animate-spin" /> : null}
                  {syncing ? "Syncing…" : "Sync & finish"}
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Optional annotated screenshot. Renders nothing until the image loads, and
 * removes itself if the file is absent — so screenshots are drop-in
 * (public/onboarding/*.png) without any code change, and their absence is
 * invisible rather than a broken image.
 */
function Figure({ src, alt }: { src: string; alt: string }) {
  const [ok, setOk] = useState(false);
  return (
    <figure className={ok ? "mt-5" : "hidden"}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        onLoad={() => setOk(true)}
        onError={() => setOk(false)}
        className="w-full rounded-lg border border-line"
      />
      <figcaption className="mt-2 text-xs text-[var(--muted)]">{alt}</figcaption>
    </figure>
  );
}
