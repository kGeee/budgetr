"use client";

/**
 * Shared credential form for Plaid (client id + secret + environment) and the
 * optional Finnhub key. Used by the onboarding wizard's "Enter keys" step and
 * the Settings → Connections card. Keys are verified against Plaid before they're
 * persisted, so a bad pair is never saved. Secrets are write-only here — existing
 * values are shown as a masked hint, never echoed back.
 */

import { useState, useTransition } from "react";
import { CheckCircle2, Eye, EyeOff, KeyRound, Loader2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { saveApiKeys, verifyKeys, type ApiKeysInput } from "@/lib/actions-onboarding";

type Status = { type: "idle" | "ok" | "error"; msg?: string };

export function ApiKeysForm({
  initial,
  saveLabel = "Save keys",
  onSaved,
}: {
  initial: { hasPlaidKeys: boolean; env: string; hasFinnhub: boolean; clientIdHint: string | null };
  saveLabel?: string;
  /** Called after a successful save (wizard advances; settings just refreshes). */
  onSaved?: () => void;
}) {
  const [clientId, setClientId] = useState("");
  const [secret, setSecret] = useState("");
  const [env, setEnv] = useState(initial.env === "production" ? "production" : "sandbox");
  const [finnhub, setFinnhub] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  const [status, setStatus] = useState<Status>({ type: "idle" });
  const [pending, startTransition] = useTransition();

  const input = (): ApiKeysInput => ({ clientId, secret, env, finnhubKey: finnhub });

  const test = () =>
    startTransition(async () => {
      const r = await verifyKeys(input());
      setStatus(r.ok ? { type: "ok", msg: "Plaid connection verified." } : { type: "error", msg: r.error });
    });

  const save = () =>
    startTransition(async () => {
      const wantPlaid = Boolean(clientId.trim() && secret.trim());
      const wantFinnhub = Boolean(finnhub.trim());
      if (!wantPlaid && !wantFinnhub) {
        setStatus({ type: "error", msg: "Enter your Plaid client ID and secret to continue." });
        return;
      }
      // Never persist a Plaid pair we couldn't verify.
      if (wantPlaid) {
        const v = await verifyKeys(input());
        if (!v.ok) {
          setStatus({ type: "error", msg: v.error });
          return;
        }
      }
      await saveApiKeys(input());
      setStatus({ type: "ok", msg: "Saved." });
      setSecret("");
      onSaved?.();
    });

  return (
    <div className="space-y-4">
      <Field label="Plaid client ID">
        <input
          type="text"
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
          placeholder={initial.hasPlaidKeys ? `saved · ${initial.clientIdHint ?? "•••• set"}` : "e.g. 65a1…"}
          autoComplete="off"
          spellCheck={false}
          className="w-full rounded-lg border border-line bg-[var(--panel)] px-3 py-2 text-sm text-[var(--paper)] outline-none focus:border-[var(--brass-dim)]"
        />
      </Field>

      <Field label="Plaid secret">
        <div className="relative">
          <input
            type={showSecret ? "text" : "password"}
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            placeholder={initial.hasPlaidKeys ? "saved · leave blank to keep" : "your Plaid secret"}
            autoComplete="off"
            spellCheck={false}
            className="w-full rounded-lg border border-line bg-[var(--panel)] px-3 py-2 pr-10 text-sm text-[var(--paper)] outline-none focus:border-[var(--brass-dim)]"
          />
          <button
            type="button"
            onClick={() => setShowSecret((v) => !v)}
            aria-label={showSecret ? "Hide secret" : "Show secret"}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--muted)] hover:text-[var(--paper)]"
          >
            {showSecret ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>
        </div>
      </Field>

      <Field label="Environment">
        <div className="inline-flex rounded-lg border border-line p-0.5">
          {(["sandbox", "production"] as const).map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => setEnv(e)}
              className={`rounded-md px-3 py-1 text-xs capitalize transition-colors ${
                env === e ? "bg-[var(--panel-2)] text-[var(--paper)]" : "text-[var(--muted)] hover:text-[var(--paper)]"
              }`}
            >
              {e}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-xs text-[var(--muted)]">
          Sandbox uses fake data (log in with <code className="mono">user_good</code> /{" "}
          <code className="mono">pass_good</code>). Production connects real banks.
        </p>
      </Field>

      <Field label="Finnhub API key" optional>
        <input
          type="password"
          value={finnhub}
          onChange={(e) => setFinnhub(e.target.value)}
          placeholder={initial.hasFinnhub ? "saved · leave blank to keep" : "optional — live stock prices"}
          autoComplete="off"
          spellCheck={false}
          className="w-full rounded-lg border border-line bg-[var(--panel)] px-3 py-2 text-sm text-[var(--paper)] outline-none focus:border-[var(--brass-dim)]"
        />
      </Field>

      {status.type !== "idle" && (
        <p
          className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
            status.type === "ok"
              ? "border-[color-mix(in_srgb,var(--jade)_40%,transparent)] bg-[color-mix(in_srgb,var(--jade)_8%,transparent)] text-[var(--jade)]"
              : "border-[color-mix(in_srgb,var(--coral)_40%,transparent)] bg-[color-mix(in_srgb,var(--coral)_8%,transparent)] text-[var(--coral)]"
          }`}
        >
          {status.type === "ok" ? <CheckCircle2 size={15} /> : <XCircle size={15} />}
          {status.msg}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3 pt-1">
        <Button variant="primary" onClick={save} disabled={pending}>
          {pending ? <Loader2 size={15} className="animate-spin" /> : <KeyRound size={15} />}
          {saveLabel}
        </Button>
        <Button variant="outline" onClick={test} disabled={pending}>
          Test connection
        </Button>
      </div>
    </div>
  );
}

function Field({
  label,
  optional,
  children,
}: {
  label: string;
  optional?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="eyebrow mb-1.5 flex items-center gap-1.5">
        {label}
        {optional && <span className="text-[9px] normal-case text-[var(--faint)]">· optional</span>}
      </span>
      {children}
    </label>
  );
}
