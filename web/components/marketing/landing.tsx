import Link from "next/link";
import {
  Boxes,
  LineChart,
  Lock,
  PiggyBank,
  Receipt,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { BuyLink } from "@/components/marketing/marketing-shell";
import { HeroShot, ScreenshotShowcase } from "@/components/marketing/screenshots";
import { SITE, hasCheckout } from "@/lib/site";

/** The public landing page body (rendered inside <MarketingShell/>). */
export function MarketingLanding() {
  return (
    <main>
      {/* Hero */}
      <section className="mx-auto max-w-6xl px-5 pb-16 pt-16 text-center sm:px-8 sm:pt-24">
        <span className="mx-auto grid h-16 w-16 place-items-center rounded-2xl border border-[var(--brass-dim)] bg-[var(--panel)] font-display text-3xl text-[var(--brass)] shadow-[var(--elev-1)]">
          ₿
        </span>
        <p className="eyebrow mt-8">Private personal finance for macOS</p>
        <h1 className="display-1 mx-auto mt-4 max-w-3xl font-display text-5xl leading-[1.05] sm:text-6xl">
          {SITE.tagline}
        </h1>
        <p className="mx-auto mt-6 max-w-xl text-lg text-[var(--muted)]">{SITE.description}</p>
        <div className="mt-9 flex flex-wrap items-center justify-center gap-4">
          <BuyLink />
          <Link
            href="/getting-started"
            className="inline-flex items-center rounded-full border border-line px-4 py-2 text-sm text-[var(--paper)] transition hover:border-[var(--brass-dim)]"
          >
            See how it works
          </Link>
        </div>
        <p className="mt-5 inline-flex items-center gap-2 text-xs text-[var(--muted)]">
          <ShieldCheck size={13} className="text-[var(--jade)]" />
          macOS (Apple Silicon) · one-time purchase · your data never leaves your Mac
        </p>
      </section>

      {/* Hero screenshot */}
      <HeroShot />

      {/* Features */}
      <section id="features" className="mx-auto max-w-6xl px-5 py-8 sm:px-8">
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <Card key={f.title} className="p-6">
              <f.icon size={20} className="text-[var(--brass)]" />
              <h3 className="mt-4 font-display text-xl tracking-tight">{f.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">{f.body}</p>
            </Card>
          ))}
        </div>
      </section>

      {/* Privacy band */}
      <section className="mx-auto max-w-6xl px-5 py-12 sm:px-8">
        <Card className="overflow-hidden p-8 sm:p-12">
          <div className="flex flex-col items-start gap-6 lg:flex-row lg:items-center lg:justify-between">
            <div className="max-w-xl">
              <p className="eyebrow inline-flex items-center gap-2">
                <Lock size={13} className="text-[var(--jade)]" /> Private by design
              </p>
              <h2 className="display-2 mt-3 font-display text-3xl sm:text-4xl">
                No cloud account. No data resale.
              </h2>
              <p className="mt-4 text-[var(--muted)]">
                budgetr runs entirely on your Mac. It talks to your bank through your own Plaid keys
                and stores everything in a local database — encrypted secrets included. There&apos;s no
                budgetr server holding your finances, because there is no budgetr server.
              </p>
            </div>
            <ul className="space-y-3 text-sm">
              {["Local SQLite database on your machine", "Your own Plaid + Finnhub keys, encrypted at rest", "Read-only — budgetr never moves money", "Open pricing, one-time purchase"].map((t) => (
                <li key={t} className="flex items-center gap-2.5">
                  <ShieldCheck size={15} className="shrink-0 text-[var(--jade)]" />
                  <span className="text-[var(--paper)]/90">{t}</span>
                </li>
              ))}
            </ul>
          </div>
        </Card>
      </section>

      {/* Screenshot showcase */}
      <ScreenshotShowcase />

      {/* Onboarding preview */}
      <section className="mx-auto max-w-6xl px-5 py-8 sm:px-8">
        <div className="text-center">
          <p className="eyebrow">Up and running in minutes</p>
          <h2 className="display-2 mt-3 font-display text-3xl sm:text-4xl">Bring your own Plaid keys</h2>
          <p className="mx-auto mt-3 max-w-lg text-[var(--muted)]">
            A guided setup walks you through it the first time you open the app.
          </p>
        </div>
        <div className="mt-8 grid gap-5 sm:grid-cols-3">
          {STEPS.map((s, i) => (
            <Card key={s.title} className="p-6">
              <span className="grid h-8 w-8 place-items-center rounded-full border border-[var(--brass-dim)] font-display text-[var(--brass)]">
                {i + 1}
              </span>
              <h3 className="mt-4 font-medium">{s.title}</h3>
              <p className="mt-1.5 text-sm text-[var(--muted)]">{s.body}</p>
            </Card>
          ))}
        </div>
      </section>

      {/* Pricing + CTA */}
      <section className="mx-auto max-w-6xl px-5 py-16 sm:px-8">
        <Card className="mx-auto max-w-md p-8 text-center">
          <p className="eyebrow">One-time purchase</p>
          <p className="mt-3 font-display text-5xl tabular">{SITE.price}</p>
          <p className="mt-2 text-sm text-[var(--muted)]">
            {hasCheckout() ? "Lifetime license · free updates" : "Free while in preview"}
          </p>
          <ul className="mt-6 space-y-2 text-left text-sm">
            {["Every feature — budgets, investments, options, tax lots", "macOS app, notarized & signed", "Your data stays on your Mac"].map((t) => (
              <li key={t} className="flex items-center gap-2.5">
                <ShieldCheck size={14} className="shrink-0 text-[var(--jade)]" />
                <span className="text-[var(--paper)]/90">{t}</span>
              </li>
            ))}
          </ul>
          <div className="mt-8 flex justify-center">
            <BuyLink />
          </div>
          <Link href="/pricing" className="mt-4 inline-block text-xs text-[var(--brass)] hover:underline">
            Full pricing & FAQ →
          </Link>
        </Card>
      </section>
    </main>
  );
}

const FEATURES = [
  {
    icon: PiggyBank,
    title: "Net worth, tracked",
    body: "Every account — cards, banks, brokerages — rolled into one net-worth curve with daily snapshots.",
  },
  {
    icon: Wallet,
    title: "Spending & budgets",
    body: "Auto-categorized transactions, monthly budgets, and anomaly alerts for spikes and price creep.",
  },
  {
    icon: LineChart,
    title: "Investments",
    body: "Holdings, cost basis, dividends, benchmark comparison, and reconstructed value history.",
  },
  {
    icon: Boxes,
    title: "Options desk",
    body: "Per-ticker chains, the volatility smile, IV term structure, dealer gamma, and a 3D IV surface.",
  },
  {
    icon: Receipt,
    title: "Tax lots & realized gains",
    body: "FIFO/LIFO/Spec-ID cost basis, wash-sale flags, and Section 1256 60/40 — export-ready.",
  },
  {
    icon: Lock,
    title: "Yours alone",
    body: "Runs locally with your own keys. No budgetr account, no server holding your finances.",
  },
];

const STEPS = [
  { title: "Create a Plaid account", body: "Free at dashboard.plaid.com — copy your client ID and a secret." },
  { title: "Paste your keys", body: "budgetr verifies them and stores them encrypted, on your Mac." },
  { title: "Connect & sync", body: "Link a bank through Plaid and your dashboard fills in." },
];
