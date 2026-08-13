/**
 * Alerts about the ledger itself, rather than about spending.
 *
 * The Insights page used to say "Nothing unusual" — four counters at zero — on a
 * day when a bank connection had been dead for seven weeks, the last sync was
 * eight days old, and 594 of 699 entries had never been reviewed. Every one of
 * those is a fact the user needs and none of them is a spending pattern, so
 * lib/anomalies never looked for them.
 *
 * These detectors live apart from the spending ones deliberately: they answer
 * "can I trust the numbers?" rather than "what did the numbers do?", and they
 * are the alerts most likely to be firing on any given day. They emit the same
 * `Alert` shape so the existing panel renders them with no special-casing.
 */

import { sql } from "drizzle-orm";
import { db } from "@/db";
import type { Alert } from "@/lib/anomalies";
import { describeAge } from "@/lib/connection-health";
import { getDataFreshness, type DataFreshness } from "@/lib/data-freshness";

/** Share of the ledger left unreviewed before it's worth saying so. */
const REVIEW_BACKLOG_RATIO = 0.25;
/** …and a floor, so a 3-transaction sandbox doesn't raise an alert. */
const REVIEW_BACKLOG_FLOOR = 25;

export type ReviewBacklog = { total: number; unreviewed: number };

export function getReviewBacklog(): ReviewBacklog {
  const row = db.get<{ total: number; unreviewed: number }>(sql`
    SELECT COUNT(*) AS total,
           SUM(CASE WHEN reviewed = 0 THEN 1 ELSE 0 END) AS unreviewed
    FROM transactions`);
  return {
    total: Number(row?.total ?? 0),
    unreviewed: Number(row?.unreviewed ?? 0),
  };
}

/**
 * Pure detection, so the thresholds are testable without a database.
 *
 * Ordering is by consequence, not by type: a dead institution means figures are
 * *wrong*, a stale sync means they're *late*, and an unreviewed backlog means
 * they're *guessed*. That's descending order of how much you should distrust
 * the page you're looking at.
 */
export function detectDataHealth(
  freshness: DataFreshness,
  backlog: ReviewBacklog,
): Alert[] {
  const alerts: Alert[] = [];

  for (const c of freshness.connections.all) {
    if (c.state !== "error") continue;
    alerts.push({
      key: `health:connection:${c.itemId}`,
      kind: "health",
      severity: "high",
      title: `${c.institutionName} last reported ${describeAge(c.daysSinceSuccess)}`,
      detail: `${c.message} ${
        c.accountCount === 1 ? "Its balance is" : "Their balances are"
      } frozen and excluded from anything computed since.`,
      vendor: c.institutionName,
      action: { href: "/settings#connections", label: "Reconnect" },
    });
  }

  if (freshness.state === "stale") {
    alerts.push({
      key: "health:stale-sync",
      kind: "health",
      severity: "high",
      title:
        freshness.latestDate === null
          ? "No transactions have ever landed"
          : `Nothing has synced since ${freshness.latestDate}`,
      detail:
        freshness.latestDate === null
          ? "Connect an account, or the figures on every page are empty rather than zero."
          : `That's ${describeAge(freshness.daysSinceLatest)}. Every "this month" figure covers only what arrived before then.`,
      date: freshness.latestDate ?? undefined,
      action: { href: "/settings#connections", label: "Check connections" },
    });
  }

  const { total, unreviewed } = backlog;
  if (
    total > 0 &&
    unreviewed >= REVIEW_BACKLOG_FLOOR &&
    unreviewed / total >= REVIEW_BACKLOG_RATIO
  ) {
    alerts.push({
      key: "health:review-backlog",
      kind: "health",
      severity: "medium",
      title: `${unreviewed.toLocaleString()} entries have never been reviewed`,
      detail: `${Math.round(
        (unreviewed / total) * 100,
      )}% of your history. Their categories are Plaid's guess, not yours — every category and budget figure inherits it.`,
      action: { href: "/transactions?reviewed=no", label: "Start reviewing" },
    });
  }

  return alerts;
}

export function getDataHealthAlerts(): Alert[] {
  return detectDataHealth(getDataFreshness(), getReviewBacklog());
}
