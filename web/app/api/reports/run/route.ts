import { NextRequest, NextResponse } from "next/server";
import {
  getReportSchedule,
  sendReportEmail,
  type ReportFrequency,
} from "@/lib/actions-reports";
import { getDisplayCurrencySetting } from "@/lib/queries";
import type { ReportPeriod } from "@/lib/report";

export const dynamic = "force-dynamic";

/**
 * GET /api/reports/run
 *
 * Fires the scheduled report if it's due. Designed to be hit by an EXTERNAL cron
 * (launchd, a system crontab, a hosted scheduler) rather than an in-process
 * timer — a local, single-user app has no long-lived scheduler, and this keeps
 * the "when to send" decision in one auditable place.
 *
 * Query params:
 *   ?force=1   — send regardless of the due check (manual trigger / testing).
 *   ?period=…  — override the report window (defaults per frequency).
 */

// Minimum elapsed time before a given frequency is considered due again. Monthly
// uses 28 days so a run on the 30th still fires the following month.
const DUE_AFTER_MS: Record<ReportFrequency, number> = {
  daily: 20 * 60 * 60 * 1000, // 20h — tolerant of a cron that drifts earlier
  weekly: 7 * 24 * 60 * 60 * 1000,
  monthly: 28 * 24 * 60 * 60 * 1000,
};

// The natural report window for each cadence.
const PERIOD_FOR: Record<ReportFrequency, ReportPeriod> = {
  daily: "this-month",
  weekly: "this-month",
  monthly: "last-month",
};

export async function GET(req: NextRequest) {
  const force = req.nextUrl.searchParams.get("force") === "1";
  const periodParam = req.nextUrl.searchParams.get("period") as ReportPeriod | null;

  const schedule = await getReportSchedule();

  if (!schedule.enabled && !force) {
    return NextResponse.json({ ran: false, reason: "schedule disabled" });
  }
  if (!schedule.email && !force) {
    return NextResponse.json({ ran: false, reason: "no recipient configured" });
  }

  const now = Date.now();
  const last = schedule.lastSentAt ? Date.parse(schedule.lastSentAt) : NaN;
  const elapsed = Number.isNaN(last) ? Infinity : now - last;
  const due = force || elapsed >= DUE_AFTER_MS[schedule.frequency];

  if (!due) {
    return NextResponse.json({
      ran: false,
      reason: "not due yet",
      frequency: schedule.frequency,
      lastSentAt: schedule.lastSentAt,
      nextDueInMs: DUE_AFTER_MS[schedule.frequency] - elapsed,
    });
  }

  const period = periodParam ?? PERIOD_FOR[schedule.frequency];
  const result = await sendReportEmail(period);

  return NextResponse.json({
    ran: true,
    forced: force,
    period,
    currency: getDisplayCurrencySetting(),
    to: result.to,
    ok: result.ok,
    message: result.message,
  });
}
