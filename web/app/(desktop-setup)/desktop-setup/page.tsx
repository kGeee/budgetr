import { notFound } from "next/navigation";
import { DesktopPrivacyGate } from "@/components/desktop/desktop-privacy-gate";
import {
  getDesktopUserDataPath,
  isPrivacyGatePending,
} from "@/lib/desktop-privacy-gate";

export const dynamic = "force-dynamic";

/**
 * Packaged Windows first-run privacy gate. Not the Plaid /onboarding wizard.
 * Only served when the Electron shell has flagged a pending gate.
 */
export default function DesktopSetupPage() {
  if (process.env.MARKETING_ONLY) notFound();
  if (!isPrivacyGatePending()) notFound();

  const resolved =
    getDesktopUserDataPath() ||
    // Fallback label if env is missing (should not happen on the real path).
    "%APPDATA%\\budgetr";

  return <DesktopPrivacyGate resolvedUserDataPath={resolved} />;
}
