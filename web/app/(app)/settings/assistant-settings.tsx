"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Eye, EyeOff, KeyRound, Loader2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NoticeText } from "@/components/assistant/assistant-bubble";
import {
  chooseAssistantModel,
  removeAssistantKey,
  saveAssistantKey,
  setAssistantOn,
} from "@/lib/actions/assistant";
import { ASSISTANT_MODELS } from "@/lib/assistant/models";
import { SettingRow } from "./setting-row";
import { Switch } from "./switch";

type Status = { type: "idle" | "ok" | "error"; msg?: string };

/**
 * Settings → AI assistant. Off by default. Switching it on shows the chat
 * bubble; questions only go out once a key is saved and the notice accepted.
 * The key is write-only here: the saved value is shown as a masked hint.
 */
export function AssistantSettings({
  enabled,
  hasKey,
  keyHint,
  model,
}: {
  enabled: boolean;
  hasKey: boolean;
  keyHint: string | null;
  model: string;
}) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [key, setKey] = useState("");
  const [show, setShow] = useState(false);
  const [status, setStatus] = useState<Status>({ type: "idle" });

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, okMsg?: string) =>
    start(async () => {
      try {
        const r = await fn();
        setStatus(r.ok ? (okMsg ? { type: "ok", msg: okMsg } : { type: "idle" }) : { type: "error", msg: r.error });
        if (r.ok) router.refresh();
      } catch {
        setStatus({ type: "error", msg: "Something went wrong. Please try again." });
      }
    });

  return (
    <div>
      {/* A div rather than SectionIntro's <p>: the notice is two paragraphs. */}
      <div className="max-w-xl border-b border-line py-3.5">
        <NoticeText />
      </div>

      <SettingRow
        title="Turn on the AI assistant"
        control={
          <Switch
            on={enabled}
            label="Turn on the AI assistant"
            disabled={busy}
            onToggle={() => run(() => setAssistantOn(!enabled))}
          />
        }
      >
        Adds a chat bubble to every page. Ask questions about your money in plain words and get answers with
        charts. Off by default; budgetr works fully without it.
      </SettingRow>

      <SettingRow
        align="start"
        title="Anthropic API key"
        control={
          <div className="w-80 max-w-full space-y-2">
            <div className="relative">
              <input
                type={show ? "text" : "password"}
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder={hasKey ? `saved · ${keyHint ?? "••••"}` : "sk-ant-…"}
                autoComplete="off"
                spellCheck={false}
                aria-label="Anthropic API key"
                className="w-full rounded-lg border border-line bg-[var(--panel)] px-3 py-2 pr-10 text-sm text-[var(--paper)] outline-none focus:border-[var(--brass-dim)]"
              />
              <button
                type="button"
                onClick={() => setShow((v) => !v)}
                aria-label={show ? "Hide key" : "Show key"}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--muted)] hover:text-[var(--paper)]"
              >
                {show ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="primary"
                size="sm"
                disabled={busy || !key.trim()}
                onClick={() =>
                  run(async () => {
                    const r = await saveAssistantKey(key);
                    if (r.ok) setKey("");
                    return r;
                  }, "Key checked with Anthropic and saved.")
                }
              >
                {busy ? <Loader2 size={14} className="animate-spin" /> : <KeyRound size={14} />}
                {hasKey ? "Replace key" : "Save key"}
              </Button>
              {hasKey && (
                <Button variant="secondary" size="sm" disabled={busy} onClick={() => run(removeAssistantKey, "Key removed.")}>
                  Remove key
                </Button>
              )}
            </div>
          </div>
        }
      >
        Your own key from the Anthropic Console. It&apos;s checked with Anthropic before saving, then encrypted on
        this device and never shown again in full. Usage is billed to your Anthropic account.
      </SettingRow>

      <SettingRow
        align="start"
        title="Model"
        control={
          <fieldset className="w-80 max-w-full space-y-1.5">
            <legend className="sr-only">Model</legend>
            {ASSISTANT_MODELS.map((m) => (
              <label
                key={m.id}
                className={`flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2 text-sm transition-colors ${
                  model === m.id ? "border-[var(--jade-deep)]" : "border-line hover:border-[var(--line-strong)]"
                }`}
              >
                <input
                  type="radio"
                  name="assistant-model"
                  value={m.id}
                  checked={model === m.id}
                  disabled={busy}
                  onChange={() => run(() => chooseAssistantModel(m.id))}
                  className="mt-1 accent-[var(--jade)]"
                />
                <span>
                  <span className="block font-medium">{m.label}</span>
                  <span className="block text-[12px] text-[var(--muted)]">{m.hint}</span>
                </span>
              </label>
            ))}
          </fieldset>
        }
      >
        Which Claude model answers. More capable models cost more per question.
      </SettingRow>

      {status.type !== "idle" && (
        <p
          role="status"
          className={`my-4 flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
            status.type === "ok"
              ? "border-[color-mix(in_srgb,var(--jade)_40%,transparent)] text-[var(--jade)]"
              : "border-[color-mix(in_srgb,var(--coral)_40%,transparent)] text-[var(--coral)]"
          }`}
        >
          {status.type === "ok" ? <CheckCircle2 size={15} /> : <XCircle size={15} />}
          {status.msg}
        </p>
      )}
    </div>
  );
}
