"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { appSettings } from "@/db/schema";
import { sql } from "drizzle-orm";
import { getAppSetting } from "@/lib/queries";
import {
  buildReportData,
  renderReportHtml,
  reportPeriodFromParam,
  type ReportPeriod,
} from "@/lib/report";

/**
 * Reporting server actions — the scheduled-email config and the 'send' itself.
 *
 * Schedule config lives in the generic app_settings KV table under three keys:
 *   report.frequency  — "daily" | "weekly" | "monthly"
 *   report.email      — recipient address
 *   report.enabled    — "1" | "0"
 *   report.lastSentAt — ISO timestamp of the last (stub) send, set by sendReportEmail
 *
 * Like every mutation in budgetr these write the local SQLite DB and revalidate
 * the root layout so every force-dynamic page re-reads the new state.
 */

export type ReportFrequency = "daily" | "weekly" | "monthly";

export const REPORT_FREQUENCIES: ReportFrequency[] = ["daily", "weekly", "monthly"];

/** Upsert one app_settings key (null clears it). */
function putSetting(key: string, value: string) {
  db.insert(appSettings)
    .values({ key, value })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value: sql`excluded."value"` },
    })
    .run();
}

export type ReportSchedule = {
  frequency: ReportFrequency;
  email: string;
  enabled: boolean;
  lastSentAt: string | null;
};

/** Read the persisted schedule config, with sane defaults. */
export async function getReportSchedule(): Promise<ReportSchedule> {
  const freq = getAppSetting("report.frequency");
  return {
    frequency: (REPORT_FREQUENCIES as string[]).includes(freq ?? "")
      ? (freq as ReportFrequency)
      : "monthly",
    email: getAppSetting("report.email") ?? "",
    enabled: getAppSetting("report.enabled") === "1",
    lastSentAt: getAppSetting("report.lastSentAt"),
  };
}

/** Persist the report schedule (frequency + recipient + on/off). */
export async function saveReportSchedule(input: {
  frequency: ReportFrequency;
  email: string;
  enabled: boolean;
}): Promise<void> {
  const frequency = REPORT_FREQUENCIES.includes(input.frequency)
    ? input.frequency
    : "monthly";
  const email = input.email.trim();

  putSetting("report.frequency", frequency);
  putSetting("report.email", email);
  // Never enable a schedule with no recipient — it could never deliver.
  putSetting("report.enabled", input.enabled && email ? "1" : "0");

  revalidatePath("/", "layout");
}

export type SendReportResult = {
  ok: boolean;
  /** The recipient the email would have gone to (empty when unset). */
  to: string;
  /** The rendered HTML body (returned so the UI/cron can preview it). */
  html: string;
  /** Human-readable status for the caller/logs. */
  message: string;
};

/**
 * "Send" the period report by email.
 *
 * STUB: budgetr ships no SMTP credentials, so instead of transmitting we render
 * the shared report HTML (the same renderReportHtml the printable route uses),
 * log it, record the send time, and return it for preview. Swap the marked
 * block below for a real provider (Resend / Postmark / nodemailer) to go live.
 */
export async function sendReportEmail(
  period: ReportPeriod | string = "this-month",
): Promise<SendReportResult> {
  const schedule = await getReportSchedule();
  const p = reportPeriodFromParam(period);
  const data = buildReportData(p);
  const html = renderReportHtml(data);
  const to = schedule.email;

  // ── TODO: replace with a real transactional email provider ──────────────────
  // e.g.  await resend.emails.send({ from, to, subject, html });
  // For now we only log the render so the flow is exercisable end-to-end without
  // leaking secrets into the app binary (per AGENTS.md, secrets stay server-side).
  const subject = `budgetr — ${data.label} in review`;
  console.info(
    `[reports] sendReportEmail stub → to=${to || "(unset)"} subject="${subject}" (${html.length} bytes)`,
  );
  console.debug(html);
  // ────────────────────────────────────────────────────────────────────────────

  putSetting("report.lastSentAt", new Date().toISOString());
  revalidatePath("/", "layout");

  return {
    ok: Boolean(to),
    to,
    html,
    message: to
      ? `Rendered ${data.label} report for ${to} (email delivery is a stub — see server logs).`
      : "Rendered report, but no recipient is configured. Add an email above first.",
  };
}
