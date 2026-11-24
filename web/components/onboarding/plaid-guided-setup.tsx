"use client";

/**
 * Guided Plaid setup — desktop app only. Plaid's dashboard opens in a browser
 * pane inside budgetr (desktop/electron/plaid-guide.js), with a checklist beside
 * it that walks a new user from "no Plaid account" to "keys saved":
 *
 *   create account → verify email → open Developers → Keys → copy → paste & check
 *
 * Steps tick themselves off from the pane's page ADDRESS (lib/plaid-guide.ts);
 * budgetr never reads the page, so the keys are copied and pasted by the user
 * into the same <ApiKeysForm> used everywhere else, which verifies them with
 * Plaid before saving. Every step can also be ticked by hand, in case Plaid
 * moves a page.
 *
 * Rendered full-window in place of the wizard / setup modal while it's open.
 * The native pane is laid over the placeholder on the right, whose bounds are
 * reported to the main process whenever they change.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Compass,
  ExternalLink,
  Loader2,
  Lock,
  RotateCw,
  TriangleAlert,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ApiKeysForm } from "@/components/api-keys-form";
import type { GuidePaneState, PlaidGuideBridge } from "@/lib/desktop-bridge";
import {
  GUIDE_STEPS,
  PLAID_KEYS_URL,
  PLAID_SIGNIN_URL,
  PLAID_SIGNUP_URL,
  classifyPlaidUrl,
  currentStep,
  displayUrl,
  stepsProvenBy,
  type GuideStepId,
} from "@/lib/plaid-guide";

export type GuidedSetupKeys = {
  hasPlaidKeys: boolean;
  env: string;
  hasFinnhub: boolean;
  clientIdHint: string | null;
};

// The frameless desktop window has no title bar, so the header doubles as the
// drag handle; its controls opt back out.
const DRAG = { WebkitAppRegion: "drag" } as React.CSSProperties;
const NO_DRAG = { WebkitAppRegion: "no-drag" } as React.CSSProperties;

export function PlaidGuidedSetup({
  bridge,
  keys,
  onClose,
  onSaved,
}: {
  bridge: PlaidGuideBridge;
  keys: GuidedSetupKeys;
  onClose: () => void;
  /** Keys verified and saved — the caller moves on to connecting a bank. */
  onSaved: () => void;
}) {
  const [done, setDone] = useState<Set<GuideStepId>>(() => new Set());
  const [open, setOpen] = useState<GuideStepId | null>(null);
  const [pane, setPane] = useState<GuidePaneState | null>(null);
  const [googleBlocked, setGoogleBlocked] = useState(false);
  const [sentOut, setSentOut] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const slot = useRef<HTMLDivElement>(null);

  const active = currentStep(done);
  const expanded = open ?? active;

  const markDone = useCallback((ids: GuideStepId[]) => {
    if (ids.length === 0) return;
    setDone((prev) => {
      if (ids.every((id) => prev.has(id))) return prev;
      const next = new Set(prev);
      ids.forEach((id) => next.add(id));
      return next;
    });
  }, []);

  const toggle = (id: GuideStepId) =>
    setDone((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // ── The native pane: open over the slot, follow its size, close on unmount.
  const bounds = useCallback(() => {
    const r = slot.current?.getBoundingClientRect();
    return r ? { x: r.left, y: r.top, width: r.width, height: r.height } : { x: 0, y: 0, width: 0, height: 0 };
  }, []);

  // Last bounds sent, so a re-render only crosses to the main process when the
  // slot actually moved or resized.
  const sent = useRef("");
  const sync = useCallback(() => {
    const b = bounds();
    const key = `${b.x},${b.y},${b.width},${b.height}`;
    if (key === sent.current) return;
    sent.current = key;
    bridge.setBounds(b);
  }, [bridge, bounds]);

  useLayoutEffect(() => {
    const node = slot.current;
    if (!node) return;
    const first = bounds();
    sent.current = `${first.x},${first.y},${first.width},${first.height}`;
    bridge
      .open(PLAID_SIGNUP_URL, first)
      .then((r) => !r.ok && setLoadError(true))
      .catch(() => setLoadError(true));
    const ro = new ResizeObserver(sync);
    ro.observe(node);
    window.addEventListener("resize", sync);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", sync);
      bridge.close().catch(() => {});
    };
  }, [bridge, bounds, sync]);

  // ResizeObserver only reports size changes; after every render, also catch a
  // slot that moved without resizing (e.g. a banner appearing above it).
  useLayoutEffect(() => {
    sync();
  });

  useEffect(() => {
    const offState = bridge.onState((s) => {
      setPane(s);
      if (s.loading) setLoadError(false);
      const page = classifyPlaidUrl(s.url);
      markDone(stepsProvenBy(page));
      if (page !== "signup" && page !== "signin" && page !== "other") setGoogleBlocked(false);
    });
    const offBlocked = bridge.onBlocked((b) => {
      if (b.reason === "google") setGoogleBlocked(true);
      else setSentOut(true);
    });
    const offError = bridge.onError(() => setLoadError(true));
    return () => {
      offState();
      offBlocked();
      offError();
    };
  }, [bridge, markDone]);

  // When a step finishes, close any step the user had opened by hand so the
  // checklist follows the work.
  const prevActive = useRef(active);
  useEffect(() => {
    if (prevActive.current !== active) {
      prevActive.current = active;
      setOpen(null);
    }
  }, [active]);

  const go = (url: string) => {
    setLoadError(false);
    bridge.navigate(url).catch(() => setLoadError(true));
  };

  const doneCount = useMemo(() => GUIDE_STEPS.filter((s) => done.has(s.id)).length, [done]);
  const onPlaid = pane ? classifyPlaidUrl(pane.url) !== "other" : true;

  return (
    <div
      className="fixed inset-0 z-[60] flex flex-col bg-[var(--ink)] text-[var(--paper)]"
      role="dialog"
      aria-modal="true"
      aria-label="Set up Plaid"
    >
      {/* Header — clears the macOS traffic lights and drags the window. */}
      <header style={DRAG} className="flex h-14 shrink-0 items-center justify-between border-b border-line pl-24 pr-4">
        <div className="flex items-center gap-3">
          <h2 className="font-display text-lg tracking-tight">Set up Plaid</h2>
          <span className="text-xs text-[var(--muted)]">
            {doneCount} of {GUIDE_STEPS.length} done
          </span>
        </div>
        <button
          type="button"
          style={NO_DRAG}
          onClick={onClose}
          aria-label="Close guided setup"
          className="grid h-8 w-8 place-items-center rounded-lg text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--paper)]"
        >
          <X size={18} />
        </button>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* ── Checklist ─────────────────────────────────────────────────── */}
        <aside className="w-[380px] shrink-0 overflow-y-auto border-r border-line px-5 py-5">
          <p className="text-sm leading-relaxed text-[var(--muted)]">
            Plaid is the service budgetr uses to read your accounts. You need your own free Plaid
            keys; this takes about 5 minutes. Steps tick off as you go.
          </p>

          <ol className="mt-5 space-y-2">
            {GUIDE_STEPS.map((s, i) => {
              const isDone = done.has(s.id);
              const isOpen = expanded === s.id || (s.id === "paste" && (active === "copy" || active === "paste"));
              return (
                <li
                  key={s.id}
                  className={`rounded-xl border transition-colors ${
                    isOpen ? "border-[var(--brass-dim)] bg-[var(--panel)]" : "border-line"
                  }`}
                >
                  <div className="flex items-center gap-3 px-3 py-2.5">
                    <button
                      type="button"
                      onClick={() => toggle(s.id)}
                      aria-label={isDone ? `Mark "${s.title}" not done` : `Mark "${s.title}" done`}
                      aria-pressed={isDone}
                      className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-medium transition-colors ${
                        isDone
                          ? "bg-[var(--jade)] text-[var(--on-jade)]"
                          : s.id === active
                            ? "bg-[var(--brass)] text-[var(--on-brass)]"
                            : "border border-line text-[var(--faint)] hover:border-[var(--line-strong)]"
                      }`}
                    >
                      {isDone ? <Check size={13} /> : i + 1}
                    </button>
                    <button
                      type="button"
                      onClick={() => setOpen(open === s.id ? null : s.id)}
                      className={`flex-1 text-left text-sm ${
                        isDone && !isOpen ? "text-[var(--muted)]" : "text-[var(--paper)]"
                      }`}
                    >
                      {s.title}
                    </button>
                  </div>
                  {/* The key form stays mounted while collapsed so a half-pasted
                      key survives a look at another step. */}
                  {(isOpen || s.id === "paste") && (
                    <div
                      className={`space-y-3 px-3 pb-4 pl-12 text-[13px] leading-relaxed text-[var(--paper)]/90 ${
                        isOpen ? "" : "hidden"
                      }`}
                    >
                      <StepBody
                        id={s.id}
                        keys={keys}
                        go={go}
                        markDone={markDone}
                        openInBrowser={() => bridge.openInBrowser().catch(() => {})}
                        onSaved={() => {
                          markDone(GUIDE_STEPS.map((g) => g.id));
                          onSaved();
                        }}
                      />
                    </div>
                  )}
                </li>
              );
            })}
          </ol>

          <p className="mt-6 inline-flex items-start gap-2 text-xs leading-relaxed text-[var(--muted)]">
            <Lock size={13} className="mt-0.5 shrink-0" />
            budgetr never reads this page. You copy your keys yourself; they&apos;re encrypted and
            stay on this Mac. Signing in here lasts until you quit budgetr.
          </p>
        </aside>

        {/* ── Browser pane ──────────────────────────────────────────────── */}
        <section className="flex min-w-0 flex-1 flex-col p-3">
          <div className="mb-2 flex items-center gap-1.5">
            <ToolButton label="Back" disabled={!pane?.canGoBack} onClick={() => bridge.back()}>
              <ArrowLeft size={15} />
            </ToolButton>
            <ToolButton label="Forward" disabled={!pane?.canGoForward} onClick={() => bridge.forward()}>
              <ArrowRight size={15} />
            </ToolButton>
            <ToolButton label="Reload" onClick={() => bridge.reload()}>
              {pane?.loading ? <Loader2 size={15} className="animate-spin" /> : <RotateCw size={15} />}
            </ToolButton>
            <div
              className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-lg border border-line bg-[var(--panel)] px-3 text-xs"
              title={pane?.url}
            >
              {onPlaid ? (
                <Lock size={12} className="shrink-0 text-[var(--jade)]" />
              ) : (
                <Compass size={12} className="shrink-0 text-[var(--brass)]" />
              )}
              <span className="truncate text-[var(--muted)]">
                {pane?.url ? displayUrl(pane.url) : "dashboard.plaid.com"}
              </span>
            </div>
            <Button variant="secondary" size="sm" onClick={() => bridge.openInBrowser().catch(() => {})}>
              <ExternalLink size={13} /> Open in browser
            </Button>
          </div>

          {googleBlocked && (
            <Banner>
              Google sign-in doesn&apos;t work inside apps, so Google blocked it here. Sign up with your
              email and a password instead, or finish this step in your browser.
              <span className="mt-2 flex gap-2">
                <Button size="sm" variant="secondary" onClick={() => bridge.openInBrowser().catch(() => {})}>
                  <ExternalLink size={13} /> Continue in browser
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setGoogleBlocked(false)}>
                  Use email here
                </Button>
              </span>
            </Banner>
          )}

          {sentOut && (
            <Banner>
              That link leads outside Plaid, so it opened in your browser. Your progress here is
              unchanged.
              <span className="mt-2 flex gap-2">
                <Button size="sm" variant="ghost" onClick={() => setSentOut(false)}>
                  Got it
                </Button>
              </span>
            </Banner>
          )}

          {loadError && (
            <Banner>
              Plaid&apos;s page didn&apos;t load. Check your internet connection and try again.
              <span className="mt-2 flex gap-2">
                <Button size="sm" variant="secondary" onClick={() => bridge.reload()}>
                  <RotateCw size={13} /> Try again
                </Button>
              </span>
            </Banner>
          )}

          {/* The native pane is drawn over this box. */}
          <div
            ref={slot}
            className="min-h-0 flex-1 overflow-hidden rounded-lg border border-line bg-[var(--panel)]"
            aria-label="Plaid dashboard"
          />
        </section>
      </div>
    </div>
  );
}

function StepBody({
  id,
  keys,
  go,
  markDone,
  openInBrowser,
  onSaved,
}: {
  id: GuideStepId;
  keys: GuidedSetupKeys;
  go: (url: string) => void;
  markDone: (ids: GuideStepId[]) => void;
  openInBrowser: () => void;
  onSaved: () => void;
}) {
  switch (id) {
    case "account":
      return (
        <>
          <p>
            Fill in Plaid&apos;s sign-up form on the right with your email and a password. It&apos;s
            free.
          </p>
          <p className="text-[var(--muted)]">
            Use email, not &ldquo;Sign up with Google&rdquo;: Google blocks its sign-in inside apps.
            If you&apos;d rather use Google,{" "}
            <LinkButton onClick={openInBrowser}>do this step in your browser</LinkButton>.
          </p>
          <span className="flex flex-wrap gap-2 pt-1">
            <Button size="sm" variant="secondary" onClick={() => go(PLAID_SIGNUP_URL)}>
              Show sign-up form
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                markDone(["account"]);
                go(PLAID_SIGNIN_URL);
              }}
            >
              I already have an account
            </Button>
          </span>
        </>
      );
    case "verify":
      return (
        <>
          <p>
            Plaid emails you a link to confirm your address. Click it; it opens in your usual
            browser. Then come back here and sign in.
          </p>
          <p className="text-[var(--muted)]">
            No email after a few minutes? Check your spam folder.
          </p>
          <span className="flex flex-wrap gap-2 pt-1">
            <Button size="sm" variant="secondary" onClick={() => go(PLAID_SIGNIN_URL)}>
              Go to sign in
            </Button>
          </span>
        </>
      );
    case "keys-page":
      return (
        <>
          <p>
            Your keys are on the <b>Developers → Keys</b> page. You don&apos;t need to ask Plaid for
            production access to start.
          </p>
          <span className="flex flex-wrap gap-2 pt-1">
            <Button size="sm" variant="secondary" onClick={() => go(PLAID_KEYS_URL)}>
              Take me there
            </Button>
          </span>
        </>
      );
    case "copy":
      return (
        <>
          <p>
            Copy the <b>client_id</b> and paste it into the first field below. Then copy the{" "}
            <b>Sandbox</b> secret and paste it into the second.
          </p>
          <p className="text-[var(--muted)]">
            Sandbox is free and uses test banks (log in with <code className="mono">user_good</code>{" "}
            / <code className="mono">pass_good</code>). Once Plaid approves you for <b>Production</b>,
            use that secret instead to connect your real banks.
          </p>
          <span className="flex flex-wrap gap-2 pt-1">
            <Button size="sm" variant="ghost" onClick={() => markDone(["copy"])}>
              <Check size={13} /> I&apos;ve copied them
            </Button>
          </span>
        </>
      );
    case "paste":
      return (
        <>
          <p className="text-[var(--muted)]">
            budgetr checks the keys with Plaid before saving, so you&apos;ll know right away if one
            is wrong.
          </p>
          <ApiKeysForm initial={keys} saveLabel="Check & save" onSaved={onSaved} />
        </>
      );
  }
}

function ToolButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--paper)] disabled:pointer-events-none disabled:opacity-35"
    >
      {children}
    </button>
  );
}

function Banner({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-2 flex gap-2.5 rounded-lg border border-[var(--brass-dim)] bg-[color-mix(in_srgb,var(--brass)_8%,transparent)] px-3 py-2.5 text-[13px] text-[var(--paper)]/90">
      <TriangleAlert size={15} className="mt-0.5 shrink-0 text-[var(--brass)]" />
      <div className="flex flex-col">{children}</div>
    </div>
  );
}

function LinkButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-[var(--brass)] underline decoration-[var(--brass-dim)] underline-offset-2 hover:decoration-[var(--brass)]"
    >
      {children}
    </button>
  );
}

/**
 * The invitation shown on the "get your keys" step of the wizard and the setup
 * modal when running in the desktop app.
 */
export function GuidedSetupCallout({ onStart }: { onStart: () => void }) {
  return (
    <div className="rounded-xl border border-[var(--brass-dim)] bg-[color-mix(in_srgb,var(--brass)_6%,transparent)] p-4">
      <p className="text-sm font-medium text-[var(--paper)]">Do it without leaving budgetr</p>
      <p className="mt-1 text-[13px] leading-relaxed text-[var(--muted)]">
        Open Plaid right here with a checklist beside it. Steps tick off as you go, and budgetr checks
        your keys at the end.
      </p>
      <Button size="sm" className="mt-3" onClick={onStart}>
        Start guided setup <ArrowRight size={14} />
      </Button>
    </div>
  );
}
