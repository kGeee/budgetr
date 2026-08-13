import { describe, it, expect } from "vitest";
import { detectDataHealth } from "@/lib/data-health";
import { classifyFreshness } from "@/lib/data-freshness";
import type { ConnectionHealth, ConnectionSummary } from "@/lib/connection-health";

const NOW = Date.parse("2026-08-10T12:00:00");

const conn = (
  state: ConnectionHealth["state"],
  name: string,
  daysSinceSuccess = 0,
): ConnectionHealth => ({
  itemId: `item_${name}`,
  institutionName: name,
  state,
  errorCode: state === "error" ? "NO_ACCOUNTS" : null,
  message: "This institution reports no accounts we can access.",
  lastSuccessAt: new Date(NOW - daysSinceSuccess * 86_400_000),
  daysSinceSuccess,
  accountCount: 1,
});

const summary = (...all: ConnectionHealth[]): ConnectionSummary => ({
  all,
  worst: all.find((c) => c.state !== "live") ?? null,
  liveCount: all.filter((c) => c.state === "live").length,
  total: all.length,
  daysSinceAnySync: 0,
});

const healthy = classifyFreshness("2026-08-09", summary(conn("live", "BofA")), NOW);

describe("detectDataHealth", () => {
  it("stays quiet when the ledger is current and reviewed", () => {
    expect(detectDataHealth(healthy, { total: 699, unreviewed: 3 })).toEqual([]);
  });

  it("raises a dead connection, naming it and how long it has been down", () => {
    const f = classifyFreshness(
      "2026-08-09",
      summary(conn("live", "BofA"), conn("error", "Chase", 47)),
      NOW,
    );
    const [alert, ...rest] = detectDataHealth(f, { total: 699, unreviewed: 0 });
    expect(rest).toEqual([]);
    expect(alert.kind).toBe("health");
    expect(alert.severity).toBe("high");
    expect(alert.title).toContain("Chase");
    expect(alert.title).toContain("a month ago");
    expect(alert.action?.href).toBe("/settings#connections");
  });

  it("sends each alert somewhere it can actually be resolved", () => {
    // A review backlog is not fixed in Settings; routing every health alert to
    // one destination is what makes an insight a notification.
    const backlog = detectDataHealth(healthy, { total: 699, unreviewed: 594 })[0];
    expect(backlog.action?.href).toBe("/transactions?reviewed=no");
  });

  it("raises one alert per dead connection", () => {
    const f = classifyFreshness(
      "2026-08-09",
      summary(conn("error", "Chase", 47), conn("error", "Amex", 4)),
      NOW,
    );
    expect(detectDataHealth(f, { total: 10, unreviewed: 0 })).toHaveLength(2);
  });

  it("raises a stale sync only when no connection is broken", () => {
    // A broken link already explains the silence; saying both would send the
    // user to re-sync when re-linking is the actual fix.
    const stale = classifyFreshness("2026-08-02", summary(conn("live", "BofA")), NOW);
    expect(detectDataHealth(stale, { total: 10, unreviewed: 0 })[0].key).toBe(
      "health:stale-sync",
    );

    const broken = classifyFreshness("2026-08-02", summary(conn("error", "Chase", 47)), NOW);
    const keys = detectDataHealth(broken, { total: 10, unreviewed: 0 }).map((a) => a.key);
    expect(keys).not.toContain("health:stale-sync");
  });

  it("raises the review backlog above both a share and a floor", () => {
    const big = detectDataHealth(healthy, { total: 699, unreviewed: 594 });
    expect(big.map((a) => a.key)).toContain("health:review-backlog");
    expect(big[0].title).toContain("594");

    // 85% unreviewed but only 17 entries — a sandbox, not a backlog.
    expect(detectDataHealth(healthy, { total: 20, unreviewed: 17 })).toEqual([]);
    // 300 unreviewed but only 10% of a large history — under control.
    expect(detectDataHealth(healthy, { total: 3000, unreviewed: 300 })).toEqual([]);
  });

  it("orders by consequence: wrong, then late, then guessed", () => {
    const f = classifyFreshness(
      "2026-08-02",
      summary(conn("live", "BofA"), conn("error", "Chase", 47)),
      NOW,
    );
    // Stale is suppressed by the broken link, so this is connection → backlog.
    const keys = detectDataHealth(f, { total: 699, unreviewed: 594 }).map((a) => a.key);
    expect(keys).toEqual(["health:connection:item_Chase", "health:review-backlog"]);
  });

  it("handles an empty ledger without claiming a stale sync date", () => {
    const empty = classifyFreshness(null, summary(conn("live", "BofA")), NOW);
    const [alert] = detectDataHealth(empty, { total: 0, unreviewed: 0 });
    expect(alert.title).toBe("No transactions have ever landed");
    expect(alert.date).toBeUndefined();
  });
});
