import { describe, expect, it } from "vitest";
import { autoSyncDue, autoSyncLabel } from "./auto-sync";

const HOUR = 3_600_000;
const now = 1_800_000_000_000;

describe("autoSyncDue", () => {
  it("never runs when switched off", () => {
    expect(autoSyncDue({ hours: 0, lastRunAt: null, now })).toBe(false);
    expect(autoSyncDue({ hours: 0, lastRunAt: now - 100 * HOUR, now })).toBe(false);
  });

  it("runs the first time it is switched on", () => {
    expect(autoSyncDue({ hours: 6, lastRunAt: null, now })).toBe(true);
  });

  it("waits a full interval after the last attempt", () => {
    expect(autoSyncDue({ hours: 6, lastRunAt: now - 6 * HOUR + 1, now })).toBe(false);
    expect(autoSyncDue({ hours: 6, lastRunAt: now - 6 * HOUR, now })).toBe(true);
    expect(autoSyncDue({ hours: 1, lastRunAt: now - 61 * 60_000, now })).toBe(true);
  });

  it("recovers if the clock moved backwards", () => {
    expect(autoSyncDue({ hours: 6, lastRunAt: now + HOUR, now })).toBe(true);
  });
});

describe("autoSyncLabel", () => {
  it("reads the way a person would say it", () => {
    expect(autoSyncLabel(0)).toBe("Off");
    expect(autoSyncLabel(1)).toBe("Every hour");
    expect(autoSyncLabel(6)).toBe("Every 6 hours");
    expect(autoSyncLabel(24)).toBe("Once a day");
  });
});
