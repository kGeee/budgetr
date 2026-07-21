"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { pairPhone, syncPhoneNow, unpairPhone } from "@/lib/actions-companion";

type Status = {
  paired: boolean;
  channelId: string | null;
  lastSyncAt: number | null;
  lastError: string | null;
};

function lastSyncLabel(lastSyncAt: number | null): string {
  if (!lastSyncAt) return "never";
  const mins = Math.max(0, Math.floor(Date.now() / 1000 - lastSyncAt) / 60);
  if (mins < 1) return "just now";
  if (mins < 60) return `${Math.floor(mins)}m ago`;
  const hours = mins / 60;
  if (hours < 48) return `${Math.floor(hours)}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function CompanionCard({ initial }: { initial: Status }) {
  const [status, setStatus] = useState(initial);
  const [qrSvg, setQrSvg] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const pair = () =>
    startTransition(async () => {
      const { qrSvg } = await pairPhone();
      setQrSvg(qrSvg);
      setStatus((s) => ({ ...s, paired: true, lastError: null }));
    });

  const sync = () =>
    startTransition(async () => {
      const r = await syncPhoneNow();
      setStatus((s) => ({
        ...s,
        lastSyncAt: r.error ? s.lastSyncAt : Math.floor(Date.now() / 1000),
        lastError: r.error,
      }));
    });

  const unpair = () =>
    startTransition(async () => {
      await unpairPhone();
      setQrSvg(null);
      setStatus({ paired: false, channelId: null, lastSyncAt: null, lastError: null });
    });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <p className="max-w-md text-sm text-[var(--muted)]">
          {status.paired ? (
            <>
              Paired — your phone shows an encrypted snapshot this Mac publishes.{" "}
              <span className="text-[var(--paper)]">Last sync: {lastSyncLabel(status.lastSyncAt)}.</span>{" "}
              {status.lastError ? (
                <span className="text-[var(--coral)]">Sync error: {status.lastError}</span>
              ) : null}
            </>
          ) : (
            <>
              Pair the budgetr companion app to see a glanceable, end-to-end encrypted summary on
              your phone. Nothing readable ever leaves this Mac.
            </>
          )}
        </p>
        <div className="flex flex-wrap gap-2">
          {status.paired ? (
            <>
              <Button variant="secondary" size="sm" onClick={sync} disabled={pending}>
                Sync now
              </Button>
              <Button variant="outline" size="sm" onClick={pair} disabled={pending}>
                Re-pair (rotate keys)
              </Button>
              <Button variant="ghost" size="sm" onClick={unpair} disabled={pending}>
                Unpair
              </Button>
            </>
          ) : (
            <Button size="sm" onClick={pair} disabled={pending}>
              Pair phone
            </Button>
          )}
        </div>
      </div>

      {qrSvg ? (
        <div className="flex flex-wrap items-center gap-5 rounded-lg border border-line bg-[var(--panel)] p-4">
          <div
            className="h-[210px] w-[210px] shrink-0 overflow-hidden rounded-md bg-white p-2 [&>svg]:h-full [&>svg]:w-full"
            // QR contains the encryption key — rendered locally, never logged or sent anywhere.
            dangerouslySetInnerHTML={{ __html: qrSvg }}
          />
          <div className="max-w-sm space-y-2 text-sm text-[var(--muted)]">
            <p className="text-[var(--paper)]">Scan with the budgetr companion app.</p>
            <p>
              Your devices exchange the encryption key directly, on-screen — it never touches a
              server. Anyone who scans this code can read your synced summary, so close it when
              you&apos;re done.
            </p>
            <Button variant="secondary" size="sm" onClick={() => setQrSvg(null)}>
              Done — hide code
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
