"use client";

/**
 * First-run onboarding wizard. Walks a new user from zero to a connected,
 * synced ledger: welcome → get Plaid keys → enter keys → connect a bank → done.
 *
 * The heavy lifting lives elsewhere — key persistence/verification in
 * lib/actions-onboarding.ts (via the shared <ApiKeysForm>), and the bank link in
 * the existing <PlaidLink>. This component is the guided shell + step state. It's
 * rendered by app/onboarding/page.tsx, which passes the current server-side state
 * (keys present? bank connected?) so the wizard can resume at the right step.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ExternalLink,
  Loader2,
  ShieldCheck,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ApiKeysForm } from "@/components/api-keys-form";
import { PlaidLink } from "@/components/plaid-link";

type Initial = {
  hasPlaidKeys: boolean;
  env: string;
  hasFinnhub: boolean;
  clientIdHint: string | null;
  connected: boolean;
};

const STEPS = ["Welcome", "Get keys", "Enter keys", "Connect", "Done"] as const;

export function OnboardingWizard({ initial }: { initial: Initial }) {
  const router = useRouter();
  // Resume where it makes sense: connected → done; keys set → connect; else start.
  const [step, setStep] = useState(initial.connected ? 4 : initial.hasPlaidKeys ? 3 : 0);
  const [syncing, startSync] = useTransition();

  const finish = () =>
    startSync(async () => {
      try {
        await fetch("/api/plaid/sync", { method: "POST" });
      } catch {
        // Non-fatal — the dashboard's Sync button can retry.
      }
      router.push("/overview");
    });

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <Stepper step={step} />

      <Card className="rise">
        {step === 0 && (
          <Step
            title="Welcome to budgetr"
            body={
              <>
                <p>
                  budgetr tracks your net worth, spending, and income — all read-only and stored on
                  this machine. Nothing leaves your computer except the calls that fetch your data.
                </p>
                <p className="mt-3">
                  To pull in your accounts, budgetr uses <b>Plaid</b>  (the bank-connection service).
                  You&apos;ll bring your own free Plaid keys — this takes about 5 minutes.
                </p>
                <p className="mt-3 inline-flex items-center gap-2 text-[var(--jade)]">
                  <ShieldCheck size={15} /> Your keys are encrypted and never leave this device.
                </p>
                <p className="mt-4 border-t border-line pt-4 text-sm text-[var(--muted)]">
                  No bank connection needed to start —{" "}
                  <a
                    href="/investments/import"
                    className="text-[var(--brass)] underline decoration-[var(--brass-dim)] underline-offset-2 hover:decoration-[var(--brass)]"
                  >
                    import your broker&apos;s trade history
                  </a>{" "}
                  from an OFX/QFX file and see your portfolio right away.
                </p>
              </>
            }
            next={() => setStep(1)}
          />
        )}

        {step === 1 && (
          <Step
            title="Get your Plaid keys"
            back={() => setStep(0)}
            next={() => setStep(2)}
            body={
              <ol className="space-y-4">
                <Walk n={1}>
                  Create a free account at{" "}
                  <A href="https://dashboard.plaid.com/signup">dashboard.plaid.com</A>.
                </Walk>
                <Walk n={2}>
                  Open{" "}
                  <A href="https://dashboard.plaid.com/developers/keys">Developers → Keys</A> and copy
                  your <b>client ID</b> and a <b>secret</b>.
                </Walk>
                <Walk n={3}>
                  Pick an environment. <b>Sandbox</b> is free and uses fake data — perfect to try
                  budgetr now (log in with <code className="mono">user_good</code> /{" "}
                  <code className="mono">pass_good</code>). <b>Production</b> connects your real banks;
                  Plaid grants production access on request (pay-as-you-go with a free allowance).
                </Walk>
              </ol>
            }
          />
        )}

        {step === 2 && (
          <Step
            title="Enter your keys"
            back={() => setStep(1)}
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
                  onSaved={() => setStep(3)}
                />
              </>
            }
          />
        )}

        {step === 3 && (
          <Step
            title="Connect a bank"
            back={() => setStep(2)}
            body={
              <>
                <p className="mb-5">
                  Launch Plaid and connect a card, bank, or brokerage. In Sandbox, search any
                  institution and log in with <code className="mono">user_good</code> /{" "}
                  <code className="mono">pass_good</code>.
                </p>
                <PlaidLink onConnected={() => setStep(4)} />
                <button
                  type="button"
                  onClick={() => router.push("/overview")}
                  className="mt-5 block text-sm text-[var(--muted)] hover:text-[var(--paper)]"
                >
                  Skip for now — I&apos;ll connect from the dashboard
                </button>
              </>
            }
          />
        )}

        {step === 4 && (
          <div className="text-center">
            <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl border border-[color-mix(in_srgb,var(--jade)_40%,transparent)] bg-[color-mix(in_srgb,var(--jade)_10%,transparent)] text-[var(--jade)]">
              <CheckCircle2 size={26} />
            </span>
            <h2 className="mt-5 font-display text-3xl tracking-tight">You&apos;re all set</h2>
            <p className="mx-auto mt-3 max-w-sm text-[var(--muted)]">
              budgetr is connected. Let&apos;s pull your first sync and open your dashboard.
            </p>
            <div className="mt-8 flex justify-center">
              <Button variant="primary" onClick={finish} disabled={syncing}>
                {syncing ? <Loader2 size={15} className="animate-spin" /> : <ArrowRight size={15} />}
                {syncing ? "Syncing…" : "Sync & open dashboard"}
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

function Stepper({ step }: { step: number }) {
  return (
    <div className="flex items-center gap-2">
      {STEPS.map((label, i) => (
        <div key={label} className="flex flex-1 items-center gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <span
              className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-medium transition-colors ${
                i < step
                  ? "bg-[var(--jade)] text-[var(--on-jade)]"
                  : i === step
                    ? "bg-[var(--brass)] text-[var(--on-brass)]"
                    : "border border-line text-[var(--faint)]"
              }`}
            >
              {i < step ? "✓" : i + 1}
            </span>
            <span
              className={`hidden truncate text-xs sm:block ${i === step ? "text-[var(--paper)]" : "text-[var(--muted)]"}`}
            >
              {label}
            </span>
          </div>
          {i < STEPS.length - 1 && (
            <span className={`h-px flex-1 ${i < step ? "bg-[var(--jade)]" : "bg-line"}`} />
          )}
        </div>
      ))}
    </div>
  );
}

function Step({
  title,
  body,
  back,
  next,
}: {
  title: string;
  body: React.ReactNode;
  back?: () => void;
  next?: () => void;
}) {
  return (
    <div>
      <h2 className="font-display text-2xl tracking-tight">{title}</h2>
      <div className="mt-4 text-sm leading-relaxed text-[var(--paper)]/90">{body}</div>
      {(back || next) && (
        <div className="mt-8 flex items-center justify-between">
          {back ? (
            <button
              type="button"
              onClick={back}
              className="inline-flex items-center gap-1.5 text-sm text-[var(--muted)] hover:text-[var(--paper)]"
            >
              <ArrowLeft size={15} /> Back
            </button>
          ) : (
            <span />
          )}
          {next && (
            <Button variant="primary" onClick={next}>
              Continue <ArrowRight size={15} />
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function Walk({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full border border-[var(--brass-dim)] text-xs text-[var(--brass)]">
        {n}
      </span>
      <span className="text-[var(--paper)]/90">{children}</span>
    </li>
  );
}

function A({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-0.5 text-[var(--brass)] underline decoration-[var(--brass-dim)] underline-offset-2 hover:decoration-[var(--brass)]"
    >
      {children}
      <ExternalLink size={12} />
    </a>
  );
}
