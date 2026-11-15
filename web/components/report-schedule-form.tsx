"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { CheckCircle2, ExternalLink, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SettingRow, SettingRows } from "@/app/(app)/settings/setting-row";
import { Switch } from "@/app/(app)/settings/switch";
import {
  saveReportSchedule,
  sendReportEmail,
  type ReportFrequency,
  type ReportSchedule,
} from "@/lib/actions-reports";

const FREQUENCIES: { value: ReportFrequency; label: string; hint: string }[] = [
  { value: "daily", label: "Daily", hint: "every morning" },
  { value: "weekly", label: "Weekly", hint: "once a week" },
  { value: "monthly", label: "Monthly", hint: "the prior month, recapped" },
];

/**
 * Scheduled-report config. Persists frequency / recipient / on-off to
 * app_settings via the server action, plus a "Send now" that renders the report
 * server-side (email delivery is a stub — see lib/actions-reports.ts) and a link
 * to open the printable report.
 */
export function ReportScheduleForm({ initial }: { initial: ReportSchedule }) {
  const [frequency, setFrequency] = useState<ReportFrequency>(initial.frequency);
  const [email, setEmail] = useState(initial.email);
  const [enabled, setEnabled] = useState(initial.enabled);
  const [saved, setSaved] = useState(false);
  const [sendMsg, setSendMsg] = useState<string | null>(null);
  const [savePending, startSave] = useTransition();
  const [sendPending, startSend] = useTransition();

  function save() {
    setSaved(false);
    startSave(async () => {
      await saveReportSchedule({
        frequency,
        email,
        enabled: enabled && Boolean(email.trim()),
      });
      setSaved(true);
    });
  }

  function sendNow() {
    setSendMsg(null);
    startSend(async () => {
      const res = await sendReportEmail("this-month");
      setSendMsg(res.message);
    });
  }

  return (
    <div>
      <SettingRows>
        <SettingRow
          title="Enable scheduled sending"
          control={
            <Switch
              id="report-enabled"
              on={enabled}
              label="Enable scheduled sending"
              onToggle={() => setEnabled((v) => !v)}
            />
          }
        >
          Totals, top vendors, category breakdown and net worth. Delivery is not wired to a mail
          provider yet — reports are rendered and logged when an external cron hits{" "}
          <code className="mono">/api/reports/run</code>.
        </SettingRow>

        <SettingRow
          title="Frequency"
          control={
            <div className="flex flex-wrap gap-1.5">
              {FREQUENCIES.map((f) => {
                const active = f.value === frequency;
                return (
                  <button
                    key={f.value}
                    type="button"
                    onClick={() => setFrequency(f.value)}
                    aria-pressed={active}
                    className={`min-h-[38px] rounded-full border px-4 text-sm transition-colors ${
                      active
                        ? "border-[var(--brass-dim)] bg-[var(--panel-2)] text-[var(--paper)]"
                        : "border-line text-[var(--muted)] hover:border-[var(--brass-dim)] hover:text-[var(--paper)]"
                    }`}
                    title={f.hint}
                  >
                    {f.label}
                  </button>
                );
              })}
            </div>
          }
        >
          How often the summary goes out.
        </SettingRow>

        <SettingRow
          title={<label htmlFor="report-email">Recipient</label>}
          control={
            <input
              id="report-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-80 max-w-full rounded-[var(--radius)] border border-line bg-[var(--panel)] px-4 py-2.5 text-sm text-[var(--paper)] outline-none transition-colors placeholder:text-[var(--muted)] focus:border-[var(--brass-dim)]"
            />
          }
        >
          Where the report is sent.
        </SettingRow>

      </SettingRows>

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-2 pt-3.5">
        <Button variant="primary" size="sm" onClick={save} disabled={savePending}>
          {savePending ? "Saving…" : "Save schedule"}
        </Button>
        <Button variant="secondary" size="sm" onClick={sendNow} disabled={sendPending}>
          <Send size={14} />
          {sendPending ? "Sending…" : "Send now"}
        </Button>
        <Link
          href="/spending?report=1"
          className="inline-flex items-center gap-1.5 rounded-full border border-[var(--brass-dim)] px-3.5 py-1.5 text-sm text-[var(--brass)] transition-colors hover:bg-[color-mix(in_srgb,var(--brass)_12%,transparent)]"
        >
          <ExternalLink size={14} />
          Open printable report
        </Link>
        {saved && (
          <span className="inline-flex items-center gap-1.5 text-sm text-[var(--jade)]">
            <CheckCircle2 size={14} /> Saved
          </span>
        )}
      </div>

      {sendMsg && <p className="pt-3 text-sm text-[var(--muted)]">{sendMsg}</p>}

      {initial.lastSentAt && (
        <p className="pt-2 text-xs text-[var(--muted)]">
          Last sent {new Date(initial.lastSentAt).toLocaleString()}.
        </p>
      )}
    </div>
  );
}
