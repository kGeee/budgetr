import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  isPrivacyGatePending,
  markPrivacyGateComplete,
  PRIVACY_GATE_MARKER,
} from "@/lib/desktop-privacy-gate";

const tmpDirs: string[] = [];

afterEach(() => {
  for (const d of tmpDirs.splice(0)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

function tmpUserData() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "budgetr-gate-"));
  tmpDirs.push(d);
  return d;
}

describe("isPrivacyGatePending", () => {
  it("is pending on packaged Windows before the marker exists", () => {
    const userData = tmpUserData();
    expect(
      isPrivacyGatePending({
        desktop: true,
        platform: "win32",
        userData,
        marketingOnly: false,
      }),
    ).toBe(true);
  });

  it("is not pending after the marker is written", () => {
    const userData = tmpUserData();
    markPrivacyGateComplete(userData);
    expect(fs.existsSync(path.join(userData, PRIVACY_GATE_MARKER))).toBe(true);
    expect(
      isPrivacyGatePending({
        desktop: true,
        platform: "win32",
        userData,
        marketingOnly: false,
      }),
    ).toBe(false);
  });

  it("never gates macOS, unpackaged, or marketing-only", () => {
    const userData = tmpUserData();
    expect(
      isPrivacyGatePending({
        desktop: true,
        platform: "darwin",
        userData,
        marketingOnly: false,
      }),
    ).toBe(false);
    expect(
      isPrivacyGatePending({
        desktop: false,
        platform: "win32",
        userData,
        marketingOnly: false,
      }),
    ).toBe(false);
    expect(
      isPrivacyGatePending({
        desktop: true,
        platform: "win32",
        userData,
        marketingOnly: true,
      }),
    ).toBe(false);
  });

  it("allows a non-production force preview on any platform", () => {
    const userData = tmpUserData();
    expect(
      isPrivacyGatePending({
        desktop: true,
        platform: "linux",
        userData,
        marketingOnly: false,
        force: true,
        nodeEnv: "development",
      }),
    ).toBe(true);
    expect(
      isPrivacyGatePending({
        desktop: true,
        platform: "linux",
        userData,
        marketingOnly: false,
        force: true,
        nodeEnv: "production",
      }),
    ).toBe(false);
  });
});