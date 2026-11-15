"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { SettingRow } from "@/app/(app)/settings/setting-row";
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
      setStatus({
        paired: false,
        channelId: null,
        lastSyncAt: null,
        lastError: null,
      });
    });

  return (
    <div>
      <SettingRow
        title={
          status.paired ? (
            <span className="flex items-center gap-2">
              <span
                aria-hidden
                className={`h-[7px] w-[7px] shrink-0 rounded-full ${
                  status.lastError ? "bg-[var(--coral)]" : "bg-[var(--jade)]"
                }`}
              />
              Phone paired
            </span>
          ) : (
            "Pair your phone"
          )
        }
        control={
          <div className="flex flex-wrap gap-2">
            {status.paired ? (
              <>
                <Button variant="secondary" className="h-11 px-4" onClick={sync} disabled={pending}>
                  Sync now
                </Button>
                <Button variant="secondary" className="h-11 px-4" onClick={pair} disabled={pending}>
                  Re-pair (rotate keys)
                </Button>
                <Button
                  variant="secondary"
                  className="h-11 px-4 text-[var(--coral)]"
                  onClick={unpair}
                  disabled={pending}
                >
                  Unpair
                </Button>
              </>
            ) : (
              <Button className="h-11" onClick={pair} disabled={pending}>
                Pair phone
              </Button>
            )}
          </div>
        }
      >
        {status.paired ? (
          <>
            Paired — your phone shows an encrypted snapshot this Mac publishes.{" "}
            <span className="text-[var(--paper)]">
              Last sync: {lastSyncLabel(status.lastSyncAt)}.
            </span>{" "}
            {status.lastError ? (
              <span className="text-[var(--coral)]">Sync error: {status.lastError}</span>
            ) : null}
          </>
        ) : (
          <>
            Pair the budgetr companion app to see a glanceable, end-to-end encrypted summary on your
            phone. Nothing readable ever leaves this Mac.
          </>
        )}
      </SettingRow>

      {qrSvg ? (
        <div className="flex flex-wrap items-center gap-5 border-b border-line py-4">
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
