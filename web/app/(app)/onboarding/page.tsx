import { PageHead } from "@/components/page-head";
import { OnboardingWizard } from "@/components/onboarding-wizard";
import { getFinnhubKey, getPlaidConfig } from "@/lib/app-config";
import { hasPlaidCredentials } from "@/lib/plaid";
import { getItems } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default function OnboardingPage() {
  const cfg = getPlaidConfig();
  const items = getItems();
  const clientIdHint = cfg.clientId ? `••••${cfg.clientId.slice(-4)}` : null;

  return (
    <div className="space-y-7">
      <PageHead title="Get started" />
      <OnboardingWizard
        initial={{
          hasPlaidKeys: hasPlaidCredentials(),
          env: cfg.env,
          hasFinnhub: Boolean(getFinnhubKey()),
          clientIdHint,
          connected: items.length > 0,
        }}
      />
    </div>
  );
}
