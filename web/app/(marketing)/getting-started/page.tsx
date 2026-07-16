import type { Metadata } from "next";
import { Card } from "@/components/ui/card";
import { BuyLink } from "@/components/marketing/marketing-shell";

export const metadata: Metadata = {
  title: "Getting started — budgetr",
  description: "Install budgetr, get your free Plaid keys, and connect your first account.",
};

const STEPS = [
  {
    title: "1 · Install budgetr",
    body: "Download the DMG, drag budgetr to Applications, and open it. The app is signed and notarized by Apple, so it launches with a normal double-click.",
  },
  {
    title: "2 · Create a free Plaid account",
    body: "budgetr connects to banks through Plaid, using your own keys. Sign up at dashboard.plaid.com, open Developers → Keys, and copy your client ID and a secret.",
    links: [
      { label: "Plaid sign-up", href: "https://dashboard.plaid.com/signup" },
      { label: "Plaid keys", href: "https://dashboard.plaid.com/developers/keys" },
    ],
  },
  {
    title: "3 · Choose an environment",
    body: "Sandbox is free and uses fake data — great for trying budgetr (log in with user_good / pass_good). Production connects your real banks; Plaid grants production access on request, pay-as-you-go with a free allowance.",
  },
  {
    title: "4 · Paste your keys",
    body: "The first-run wizard asks for your keys, verifies them with Plaid, and stores them encrypted on your Mac. You can change them any time in Settings → Connections.",
  },
  {
    title: "5 · Connect a bank & sync",
    body: "Launch Plaid Link, connect a card, bank, or brokerage, and budgetr pulls in your balances, transactions, and holdings. That's it — your dashboard fills in.",
  },
];

export default function GettingStartedPage() {
  return (
    <main className="mx-auto max-w-3xl px-5 py-16 sm:px-8">
      <div className="text-center">
        <p className="eyebrow">Getting started</p>
        <h1 className="display-1 mt-3 font-display text-4xl sm:text-5xl">
          From download to dashboard
        </h1>
        <p className="mx-auto mt-4 max-w-lg text-[var(--muted)]">
          About five minutes. You&apos;ll bring your own free Plaid keys — the app guides you through
          it on first launch.
        </p>
      </div>

      <div className="mt-10 space-y-4">
        {STEPS.map((s) => (
          <Card key={s.title} className="p-6">
            <h2 className="font-display text-xl tracking-tight">{s.title}</h2>
            <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">{s.body}</p>
            {s.links && (
              <div className="mt-3 flex flex-wrap gap-4">
                {s.links.map((l) => (
                  <a
                    key={l.href}
                    href={l.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-[var(--brass)] underline decoration-[var(--brass-dim)] underline-offset-2 hover:decoration-[var(--brass)]"
                  >
                    {l.label} ↗
                  </a>
                ))}
              </div>
            )}
          </Card>
        ))}
      </div>

      <div className="mt-10 flex justify-center">
        <BuyLink />
      </div>
    </main>
  );
}
