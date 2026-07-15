import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { MarketingShell } from "@/components/marketing/marketing-shell";
import { MarketingLanding } from "@/components/marketing/landing";
import { SITE } from "@/lib/site";

// The root "/" is claimed by two deployments of one codebase: the public
// marketing site (MARKETING_ONLY set → the landing page) and the local/desktop
// dashboard (→ redirect to /overview). Env decides which, so there's no route
// conflict with the (app) group.

export const metadata: Metadata = {
  metadataBase: new URL(SITE.siteUrl),
  title: "budgetr — private personal finance for macOS",
  description: SITE.description,
  openGraph: {
    title: "budgetr — private personal finance for macOS",
    description: SITE.description,
    url: SITE.siteUrl,
    siteName: "budgetr",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "budgetr — private personal finance for macOS",
    description: SITE.description,
  },
};

export default function RootPage() {
  if (!process.env.MARKETING_ONLY) redirect("/overview");
  return (
    <MarketingShell>
      <MarketingLanding />
    </MarketingShell>
  );
}
