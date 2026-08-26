"use client";

/**
 * Windows packaged-desktop first-run privacy gate.
 * Copy is from Marketing Chief — use verbatim; do not invent privacy claims.
 *
 * Screen 1 secondary peeks at screen 3 without skipping the gate: Continue into
 * the app stays disabled until screens 1 and 2 have been completed with acks.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

type Screen = 1 | 2 | 3;

export function DesktopPrivacyGate({
  resolvedUserDataPath,
}: {
  /** Expanded app.getPath("userData") path for display alongside %APPDATA%. */
  resolvedUserDataPath: string;
}) {
  const router = useRouter();
  const [screen, setScreen] = useState<Screen>(1);
  const [ack1, setAck1] = useState(false);
  const [ack2, setAck2] = useState(false);
  const [done1, setDone1] = useState(false);
  const [done2, setDone2] = useState(false);
  const [busy, setBusy] = useState(false);
  const [clientPath, setClientPath] = useState(resolvedUserDataPath);

  // Prefer the live Electron path if the preload bridge is available (should
  // match the server-rendered BUDGETR_USER_DATA value).
  useEffect(() => {
    const bridge = window.budgetrDesktop;
    if (!bridge) return;
    bridge.getUserDataPath().then((p) => {
      if (p) setClientPath(p);
    });
  }, []);

  const displayPath = clientPath || resolvedUserDataPath;

  const openDataFolder = async () => {
    const bridge = window.budgetrDesktop;
    if (bridge) {
      await bridge.openDataFolder();
      return;
    }
    // Dev fallback — should not happen on the packaged Windows path.
    window.alert(`Data folder:\n${displayPath}`);
  };

  const exitSetup = async () => {
    const bridge = window.budgetrDesktop;
    if (bridge) {
      await bridge.quitApp();
      return;
    }
    window.close();
  };

  const continueIntoApp = async () => {
    if (!done1 || !done2) return;
    setBusy(true);
    try {
      const bridge = window.budgetrDesktop;
      if (bridge) {
        await bridge.completePrivacyGate();
      } else {
        await fetch("/api/desktop/privacy-gate", { method: "POST" });
      }
      router.replace("/overview");
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center px-5 py-10 sm:px-8">
      <p className="font-display text-2xl tracking-tight text-[var(--paper)]">budgetr</p>
      <p className="mt-1 text-xs uppercase tracking-[0.14em] text-[var(--faint)]">
        Setup · {screen} of 3
      </p>

      {screen === 1 && (
        <section className="mt-8 space-y-5">
          <h1 className="font-display text-3xl tracking-tight sm:text-4xl">
            Your ledger stays on this PC.
          </h1>
          <div className="space-y-3 text-[var(--muted)] leading-relaxed">
            <p>
              budgetr stores your balances, transactions, and lots in a SQLite file on this
              computer. There is no budgetr account and no budgetr copy of that file.
            </p>
            <p>The app is read-only. It cannot transfer money.</p>
            <p>
              Outbound calls go only to providers you configure: Plaid, Finnhub, Yahoo. You bring
              your own Plaid keys. They are encrypted at rest on this device.
            </p>
          </div>
          <label className="flex cursor-pointer items-start gap-3 rounded-[var(--radius)] border border-line bg-[var(--panel)] p-4 text-sm text-[var(--paper)]">
            <input
              type="checkbox"
              className="mt-0.5 size-4 shrink-0 accent-[var(--jade)]"
              checked={ack1}
              onChange={(e) => setAck1(e.target.checked)}
            />
            <span>
              I understand my ledger is a local file. budgetr does not keep a server-side copy.
            </span>
          </label>
          <div className="flex flex-col gap-3 pt-2 sm:flex-row sm:items-center">
            <Button
              type="button"
              disabled={!ack1}
              onClick={() => {
                setDone1(true);
                setScreen(2);
              }}
            >
              Continue
            </Button>
            <Button type="button" variant="ghost" onClick={() => setScreen(3)}>
              Where the file will live
            </Button>
          </div>
        </section>
      )}

      {screen === 2 && (
        <section className="mt-8 space-y-5">
          <h1 className="font-display text-3xl tracking-tight sm:text-4xl">
            What this app is allowed to do.
          </h1>
          <div className="space-y-3 text-[var(--muted)] leading-relaxed">
            <p>Before it is usable, budgetr needs to do two things on this PC:</p>
            <ol className="list-decimal space-y-2 pl-5">
              <li>
                Create and update files in %APPDATA%\budgetr\ (your database and settings).
              </li>
              <li>
                Talk to the providers you configure — Plaid, Finnhub, Yahoo — and nothing else.
              </li>
            </ol>
            <p>
              It will not move money. It will not create a budgetr cloud account. It will not send
              your ledger to us.
            </p>
          </div>
          <label className="flex cursor-pointer items-start gap-3 rounded-[var(--radius)] border border-line bg-[var(--panel)] p-4 text-sm text-[var(--paper)]">
            <input
              type="checkbox"
              className="mt-0.5 size-4 shrink-0 accent-[var(--jade)]"
              checked={ack2}
              onChange={(e) => setAck2(e.target.checked)}
            />
            <span>
              Allow budgetr to store files in %APPDATA%\budgetr\ and to contact only the providers I
              configure.
            </span>
          </label>
          <div className="flex flex-col gap-3 pt-2 sm:flex-row sm:items-center">
            <Button
              type="button"
              disabled={!ack2}
              onClick={() => {
                setDone2(true);
                setScreen(3);
              }}
            >
              Allow and continue
            </Button>
            <Button type="button" variant="ghost" onClick={() => void exitSetup()}>
              Not now (exit setup)
            </Button>
          </div>
          {!done1 && (
            <button
              type="button"
              className="text-sm text-[var(--brass)] underline-offset-2 hover:underline"
              onClick={() => setScreen(1)}
            >
              Back
            </button>
          )}
        </section>
      )}

      {screen === 3 && (
        <section className="mt-8 space-y-5">
          <h1 className="font-display text-3xl tracking-tight sm:text-4xl">This is the folder.</h1>
          <div className="space-y-3 text-[var(--muted)] leading-relaxed">
            <p>Everything lives in %APPDATA%\budgetr\ on this PC.</p>
            <ul className="list-disc space-y-1 pl-5">
              <li>
                <span className="font-mono text-[var(--paper)]">budgetr.db</span> — the ledger
                (SQLite)
              </li>
              <li>
                <span className="font-mono text-[var(--paper)]">budgetr.env</span> — your keys,
                including Plaid, encrypted at rest
              </li>
            </ul>
            <p>Same idea as Mac: stored on this machine. Your keys stay on this device.</p>
            <p>
              Open that folder any time. If you delete it, the ledger is gone from budgetr, because
              we never had it.
            </p>
          </div>
          <div className="rounded-[var(--radius)] border border-line bg-[var(--panel)] p-4">
            <p className="text-xs uppercase tracking-wide text-[var(--faint)]">On this PC</p>
            <p className="mt-1 break-all font-mono text-sm text-[var(--paper)]">{displayPath}</p>
          </div>
          {!done1 || !done2 ? (
            <p className="text-sm text-[var(--brass)]">
              Finish the earlier setup steps before continuing into the app.
            </p>
          ) : null}
          <div className="flex flex-col gap-3 pt-2 sm:flex-row sm:items-center">
            <Button type="button" onClick={() => void openDataFolder()}>
              Open data folder
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={!done1 || !done2 || busy}
              onClick={() => void continueIntoApp()}
            >
              Continue into the app
            </Button>
          </div>
          {(!done1 || !done2) && (
            <button
              type="button"
              className="text-sm text-[var(--brass)] underline-offset-2 hover:underline"
              onClick={() => setScreen(done1 ? 2 : 1)}
            >
              Back to setup
            </button>
          )}
        </section>
      )}
    </div>
  );
}
