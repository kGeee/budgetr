// electron-builder `afterPack` hook — ad-hoc sign the packed macOS .app when no
// real Developer ID signing identity is in play.
//
// WHY THIS EXISTS
// ---------------
// With no signing identity, electron-builder skips *bundle* signing entirely.
// On arm64 the Mach-O linker still applies an ad-hoc code signature to the
// executable, but the .app bundle is left with "Sealed Resources=none", so:
//
//     codesign --verify --deep --strict budgetr.app
//     -> "code has no resources but signature indicates they must be present"
//
// Gatekeeper then reports a quarantined download as "budgetr is damaged and
// can't be opened" with NO Open-Anyway escape hatch. Running
// `codesign --force --deep --sign -` over the whole bundle produces a VALID
// ad-hoc signature (it seals the resources), which downgrades the quarantined
// verdict to merely "unnotarized" — so the user CAN reach the
// System Settings -> Privacy & Security -> "Open Anyway" flow. A fully
// dialog-free experience still requires Developer ID + notarization.
//
// IDENTITY HANDLING (why we no longer pin `mac.identity: null`)
// -------------------------------------------------------------
// `mac.identity: null` made electron-builder skip signing forever — which was
// fine for unsigned builds but would permanently block future real signing in
// CI. Instead:
//
//   * No real cert (local `npm run package`, or CI with no CSC_LINK secret):
//     electron-builder finds no "Developer ID Application" cert and skips
//     signing (locally reinforced by CSC_IDENTITY_AUTO_DISCOVERY=false in the
//     release workflow when no secret is configured). This hook then applies
//     the ad-hoc signature. Note: a stray "Apple Development" cert in the login
//     keychain does NOT match distribution signing, so local builds stay
//     unsigned-then-ad-hoc regardless.
//
//   * Real cert present (CI with CSC_LINK + CSC_KEY_PASSWORD, auto-discovery
//     on): electron-builder signs with Developer ID and — given APPLE_ID /
//     APPLE_APP_SPECIFIC_PASSWORD / APPLE_TEAM_ID — notarizes. We detect that
//     case via CSC_LINK and DO NOTHING here, so we never clobber a real
//     signature with an ad-hoc one.
//
// afterPack fires for every pack, before electron-builder's own signing step,
// so in the unsigned case our ad-hoc signature survives (the skipped sign step
// never touches the bundle).

const { execFileSync } = require("node:child_process");
const path = require("node:path");

/** @param {import("app-builder-lib").AfterPackContext} context */
exports.default = async function afterPack(context) {
  // Only macOS bundles need resource sealing for Gatekeeper.
  if (context.electronPlatformName !== "darwin") {
    return;
  }

  // A real signing identity is in play — electron-builder will produce a proper
  // Developer ID signature (and notarize). Leave the bundle untouched.
  if (process.env.CSC_LINK) {
    console.log(
      "[afterpack-sign] CSC_LINK set — deferring to electron-builder's real signing; skipping ad-hoc sign.",
    );
    return;
  }

  const appName = `${context.packager.appInfo.productFilename}.app`;
  const appPath = path.join(context.appOutDir, appName);

  console.log(`[afterpack-sign] ad-hoc signing ${appPath}`);
  try {
    execFileSync("codesign", ["--force", "--deep", "--sign", "-", appPath], {
      stdio: "inherit",
    });
  } catch (err) {
    throw new Error(
      `[afterpack-sign] ad-hoc codesign failed for ${appPath}: ${err.message}`,
    );
  }

  // Verify the signature we just applied; a broken signature is worse than none
  // for Gatekeeper, so fail the build loudly if verification does not pass.
  try {
    execFileSync(
      "codesign",
      ["--verify", "--deep", "--strict", "-v", appPath],
      { stdio: "inherit" },
    );
  } catch (err) {
    throw new Error(
      `[afterpack-sign] ad-hoc signature failed verification for ${appPath}: ${err.message}`,
    );
  }

  console.log(`[afterpack-sign] ad-hoc signature valid for ${appPath}`);
};
