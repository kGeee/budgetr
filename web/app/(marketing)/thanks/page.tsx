import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2, Download } from "lucide-react";
import { Card } from "@/components/ui/card";
import { SITE } from "@/lib/site";

export const metadata: Metadata = {
  title: "Thank you — budgetr",
  description: "Your budgetr download and next steps.",
  robots: { index: false },
};

// Post-checkout landing (Polar success/redirect target). The DMG + license key
// are also emailed by the merchant; this page mirrors the download + next steps.
export default function ThanksPage() {
  return (
    <main className="mx-auto max-w-xl px-5 py-20 text-center sm:px-8">
      <span className="mx-auto grid h-16 w-16 place-items-center rounded-2xl border border-[color-mix(in_srgb,var(--jade)_40%,transparent)] bg-[color-mix(in_srgb,var(--jade)_10%,transparent)] text-[var(--jade)]">
        <CheckCircle2 size={30} />
      </span>
      <h1 className="display-1 mt-6 font-display text-4xl">Thank you</h1>
      <p className="mx-auto mt-4 max-w-md text-[var(--muted)]">
        Your license key and receipt are on their way by email. Download budgetr below and open it —
        the first-run wizard will help you connect your accounts.
      </p>

      <Card className="mt-8 p-6 text-left">
        <a
          href={SITE.directDmgUrl}
          className="inline-flex items-center gap-2 rounded-full bg-[var(--jade)] px-5 py-2.5 text-sm font-medium text-[var(--on-jade)] transition hover:brightness-105"
        >
          <Download size={16} />
          Download budgetr for macOS
        </a>
        <ol className="mt-6 space-y-3 text-sm text-[var(--muted)]">
          <li>1. Open the downloaded DMG and drag budgetr to Applications.</li>
          <li>2. Launch it — it&apos;s notarized, so it opens normally.</li>
          <li>
            3. Follow the setup wizard to add your Plaid keys and connect a bank. Need a hand? See{" "}
            <Link href="/getting-started" className="text-[var(--brass)] hover:underline">
              Getting Started
            </Link>
            .
          </li>
        </ol>
      </Card>
    </main>
  );
}
