/**
 * Packaged-desktop privacy / first-run gate helpers.
 *
 * The Electron shell sets BUDGETR_DESKTOP=1 and BUDGETR_USER_DATA=<userData>
 * when packaged. On Windows, a fresh install must complete the three-screen
 * privacy gate before /overview (or any app chrome) is usable. Completion is a
 * marker file in userData — not the DB — so it survives schema resets and stays
 * out of the Plaid onboarding wizard's firstRunDone flag.
 *
 * Never forced on MARKETING_ONLY, npm run dev, start.bat, or macOS packages.
 */

import fs from "node:fs";
import path from "node:path";

export const PRIVACY_GATE_MARKER = "privacy-gate-done";

/** True when this process is the packaged Electron-spawned Next server. */
export function isPackagedDesktop(): boolean {
  return process.env.BUDGETR_DESKTOP === "1";
}

/** Per-user data directory from Electron (`app.getPath("userData")`), if set. */
export function getDesktopUserDataPath(): string | null {
  const p = process.env.BUDGETR_USER_DATA?.trim();
  return p || null;
}

export function privacyGateMarkerPath(userData = getDesktopUserDataPath()): string | null {
  if (!userData) return null;
  return path.join(userData, PRIVACY_GATE_MARKER);
}

export function isPrivacyGateComplete(userData = getDesktopUserDataPath()): boolean {
  const marker = privacyGateMarkerPath(userData);
  if (!marker) return false;
  return fs.existsSync(marker);
}

/**
 * Whether the Windows packaged app must block on the privacy gate.
 * Pure enough to unit-test with injected platform + userData + marker state.
 *
 * `BUDGETR_PRIVACY_GATE_FORCE=1` (non-production only) previews the gate on any
 * platform for local QA — never set in Release builds.
 */
export function isPrivacyGatePending(opts?: {
  desktop?: boolean;
  platform?: NodeJS.Platform;
  userData?: string | null;
  marketingOnly?: boolean;
  force?: boolean;
  nodeEnv?: string;
}): boolean {
  const desktop = opts?.desktop ?? isPackagedDesktop();
  const platform = opts?.platform ?? process.platform;
  const userData = opts?.userData === undefined ? getDesktopUserDataPath() : opts.userData;
  const marketingOnly =
    opts?.marketingOnly ?? Boolean(process.env.MARKETING_ONLY);
  const force =
    opts?.force ?? process.env.BUDGETR_PRIVACY_GATE_FORCE === "1";
  const nodeEnv = opts?.nodeEnv ?? process.env.NODE_ENV ?? "production";

  if (marketingOnly) return false;
  if (!desktop) return false;
  if (!userData) return false;

  if (force && nodeEnv !== "production") {
    return !isPrivacyGateComplete(userData);
  }

  if (platform !== "win32") return false;
  return !isPrivacyGateComplete(userData);
}

/** Persist gate completion under userData. Idempotent. */
export function markPrivacyGateComplete(userData = getDesktopUserDataPath()): void {
  if (!userData) {
    throw new Error("BUDGETR_USER_DATA is not set — cannot mark privacy gate complete");
  }
  fs.mkdirSync(userData, { recursive: true });
  fs.writeFileSync(
    path.join(userData, PRIVACY_GATE_MARKER),
    `completed ${new Date().toISOString()}\n`,
    "utf8",
  );
}
