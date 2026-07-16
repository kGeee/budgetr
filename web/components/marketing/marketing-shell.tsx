import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { SITE, hasCheckout, primaryCtaHref } from "@/lib/site";

/**
 * Public marketing chrome — a translucent top nav + footer wrapping every
 * marketing page (and the landing at /). On-brand with the app: the ₿ mark, the
 * Fraunces wordmark, jade primary CTA. No sidebar, no DB — fully public/static.
 */
export function MarketingShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh">
      <header className="material sticky top-0 z-30 border-b border-line">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-5 py-3.5 sm:px-8">
          <Link href="/" className="flex items-center gap-2.5">
            <span className="grid h-8 w-8 place-items-center rounded-lg border border-[var(--brass-dim)] bg-[var(--panel)] font-display text-[var(--brass)]">
              ₿
            </span>
            <span className="font-display text-xl tracking-tight">budgetr</span>
          </Link>
          <nav className="ml-auto hidden items-center gap-6 text-sm text-[var(--muted)] sm:flex">
            <Link href="/#features" className="hover:text-[var(--paper)]">
              Features
            </Link>
            <Link href="/pricing" className="hover:text-[var(--paper)]">
              Pricing
            </Link>
            <Link href="/getting-started" className="hover:text-[var(--paper)]">
              Getting started
            </Link>
          </nav>
          <BuyLink className="ml-auto sm:ml-0" />
        </div>
      </header>

      {children}

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-5 py-8 text-sm text-[var(--muted)] sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <div className="flex items-center gap-2.5">
            <span className="grid h-7 w-7 place-items-center rounded-lg border border-[var(--brass-dim)] bg-[var(--panel)] font-display text-sm text-[var(--brass)]">
              ₿
            </span>
            <span>Read-only · data stays on your machine.</span>
          </div>
          <div className="flex flex-wrap items-center gap-5">
            <Link href="/pricing" className="hover:text-[var(--paper)]">
              Pricing
            </Link>
            <Link href="/getting-started" className="hover:text-[var(--paper)]">
              Getting Started
            </Link>
            <a href={SITE.repoUrl} className="hover:text-[var(--paper)]" target="_blank" rel="noopener noreferrer">
              GitHub
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}

/** Primary purchase/download CTA — paid checkout when configured, else the free
 * GitHub download. External link (Polar / GitHub) so it opens directly. */
export function BuyLink({ className = "", label }: { className?: string; label?: string }) {
  const paid = hasCheckout();
  const text = label ?? (paid ? `Buy · ${SITE.price}` : "Download");
  return (
    <a
      href={primaryCtaHref()}
      target="_blank"
      rel="noopener noreferrer"
      className={`inline-flex items-center gap-1.5 rounded-full bg-[var(--jade)] px-4 py-2 text-sm font-medium text-[#06120c] transition hover:brightness-105 ${className}`}
    >
      {text}
      <ArrowUpRight size={15} />
    </a>
  );
}
