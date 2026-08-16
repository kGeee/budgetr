import { describe, it, expect } from "vitest";
import {
  STALE_AFTER_DAYS,
  classifyConnection,
  describeAge,
  type ItemAccountStats,
  type ItemFacts,
} from "@/lib/connection-health";

// Classification is pure, so the state boundaries and the copy are covered here
// without a database. The query that feeds it is exercised by the pages.

const NOW = Date.parse("2026-08-10T12:00:00Z");
const secondsAgo = (days: number) => Math.floor((NOW - days * 86_400_000) / 1000);

const healthy: ItemFacts = {
  itemId: "item_1",
  institutionName: "Bank of America",
  status: "active",
  error: null,
};
const stats = (days: number | null, count = 2): ItemAccountStats => ({
  count,
  lastSuccess: days === null ? null : secondsAgo(days),
});

describe("classifyConnection", () => {
  it("is live inside the staleness window", () => {
    const c = classifyConnection(healthy, stats(STALE_AFTER_DAYS - 1), NOW);
    expect(c.state).toBe("live");
    expect(c.accountCount).toBe(2);
  });

  it("turns stale exactly at the threshold, not a day later", () => {
    expect(classifyConnection(healthy, stats(STALE_AFTER_DAYS), NOW).state).toBe("stale");
  });

  it("reports an error state ahead of any staleness", () => {
    // A broken item that was refreshed moments ago is still broken: syncAllItems
    // writes items.updatedAt on failure, so recency must never imply health.
    const c = classifyConnection(
      { ...healthy, status: "error", error: "NO_ACCOUNTS" },
      stats(0),
      NOW,
    );
    expect(c.state).toBe("error");
    expect(c.message).toMatch(/Re-linking is the only fix/);
  });

  it("explains a known Plaid code in the user's terms, without the code", () => {
    const c = classifyConnection(
      { ...healthy, status: "error", error: "ITEM_LOGIN_REQUIRED" },
      stats(1),
      NOW,
    );
    expect(c.message).toBe("Your bank needs you to sign in again before it will share data.");
    expect(c.errorCode).toBe("ITEM_LOGIN_REQUIRED");
  });

  it("falls back to the raw code rather than saying nothing", () => {
    const c = classifyConnection(
      { ...healthy, status: "error", error: "SOME_NEW_CODE" },
      stats(1),
      NOW,
    );
    expect(c.message).toBe("Your bank returned SOME_NEW_CODE.");
  });

  it("handles an item that has never successfully synced", () => {
    const c = classifyConnection(healthy, stats(null, 0), NOW);
    expect(c.state).toBe("stale");
    expect(c.lastSuccessAt).toBeNull();
    expect(c.daysSinceSuccess).toBe(Infinity);
    expect(c.message).toMatch(/never/);
  });

  it("names an institution that Plaid gave no name for", () => {
    const c = classifyConnection({ ...healthy, institutionName: null }, stats(0), NOW);
    expect(c.institutionName).toBe("Unnamed institution");
  });

  it("reads lastSuccess as seconds, not milliseconds", () => {
    // Getting this wrong puts the timestamp in 1970 and every item reads stale.
    const c = classifyConnection(healthy, stats(1), NOW);
    expect(c.lastSuccessAt?.getUTCFullYear()).toBe(2026);
    expect(c.daysSinceSuccess).toBe(1);
  });
});

describe("describeAge", () => {
  it("covers the phrasing the chips and banners use", () => {
    expect(describeAge(0)).toBe("today");
    expect(describeAge(1)).toBe("yesterday");
    expect(describeAge(9)).toBe("9 days ago");
    expect(describeAge(47)).toBe("a month ago");
    expect(describeAge(90)).toBe("3 months ago");
    expect(describeAge(Infinity)).toBe("never");
  });
});
