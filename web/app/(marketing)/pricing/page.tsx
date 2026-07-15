import type { Metadata } from "next";
import { ShieldCheck } from "lucide-react";
import { Card } from "@/components/ui/card";
import { BuyLink } from "@/components/marketing/marketing-shell";
import { SITE, hasCheckout } from "@/lib/site";

export const metadata: Metadata = {
  title: "Pricing — budgetr",
  description: "One-time purchase. A notarized macOS app that keeps your finances on your machine.",
};

const FAQ = [
  {
    q: "Is my financial data sent anywhere?",
    a: "No. budgetr runs on your Mac and stores everything in a local database. It connects to your bank through your own Plaid keys — there is no budgetr server holding your data.",
  },
  {
    q: "Do I need a Plaid account?",
    a: "Yes — a free one. budgetr uses Plaid to connect banks, and you bring your own keys (the app can't ship shared secrets safely). The first-run wizard walks you through getting them, and you can start in Plaid's free Sandbox with fake data.",
  },
  {
    q: "Will macOS say the app is unsafe?",
    a: "No — the app is signed with an Apple Developer ID and notarized by Apple, so it opens with a normal double-click. Apple Silicon Macs are supported.",
  },
  {
    q: "What do updates cost?",
    a: "Updates are included. It's a one-time purchase, not a subscription.",
  },
  {
    q: "Can I get a refund?",
    a: "Yes — if budgetr isn't for you, reply to your receipt within 14 days and we'll refund it.",
  },
];

export default function PricingPage() {
  return (
    <main className="mx-auto max-w-4xl px-5 py-16 sm:px-8">
      <div className="text-center">
        <p className="eyebrow">Pricing</p>
        <h1 className="display-1 mt-3 font-display text-4xl sm:text-5xl">Simple, one-time.</h1>
        <p className="mx-auto mt-4 max-w-lg text-[var(--muted)]">
          Buy once, own it. Your data never leaves your Mac.
        </p>
      </div>

      <Card className="mx-auto mt-10 max-w-md p-8 text-center">
        <p className="eyebrow">Lifetime license</p>
        <p className="mt-3 font-display text-6xl tabular">{SITE.price}</p>
        <p className="mt-2 text-sm text-[var(--muted)]">
          {hasCheckout() ? "One-time · free updates · 14-day refund" : "Free while in preview"}
        </p>
        <ul className="mt-6 space-y-2.5 text-left text-sm">
          {[
            "Net worth, spending, budgets & cashflow",
            "Investments, dividends & benchmark comparison",
            "Options desk — smile, term structure, 3D IV surface",
            "Tax lots & realized gains (FIFO/LIFO/Spec-ID)",
            "Notarized macOS app · your data stays local",
          ].map((t) => (
            <li key={t} className="flex items-center gap-2.5">
              <ShieldCheck size={15} className="shrink-0 text-[var(--jade)]" />
              <span className="text-[var(--paper)]/90">{t}</span>
            </li>
          ))}
        </ul>
        <div className="mt-8 flex justify-center">
          <BuyLink />
        </div>
      </Card>

      <section className="mx-auto mt-16 max-w-2xl">
        <h2 className="display-2 text-center font-display text-3xl">Questions</h2>
        <div className="mt-8 divide-y divide-line/60">
          {FAQ.map((item) => (
            <div key={item.q} className="py-5">
              <h3 className="font-medium">{item.q}</h3>
              <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">{item.a}</p>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
