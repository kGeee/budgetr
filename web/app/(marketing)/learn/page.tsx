import type { Metadata } from "next";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { LearnIndexCloser } from "@/components/marketing/learn-closer";
import { LEARN_GUIDES } from "@/lib/learn";

export const metadata: Metadata = {
  title: "Guides — budgetr",
  description: "Short money lessons: net worth, envelopes, savings rate, and who holds a copy of your ledger.",
};

export default function LearnIndexPage() {
  return (
    <main className="mx-auto max-w-4xl px-5 py-16 sm:px-8">
      <div className="max-w-2xl">
        <p className="eyebrow">Guides</p>
        <h1 className="display-1 mt-3 font-display text-4xl sm:text-5xl">
          Personal finance, one number at a time.
        </h1>
        <p className="mt-4 text-[var(--muted)]">Short guides. The Mac app is optional.</p>
      </div>

      <ul className="mt-12 grid gap-4 sm:grid-cols-2">
        {LEARN_GUIDES.map((guide) => (
          <li key={guide.slug}>
            <Link href={`/learn/${guide.slug}`} className="block h-full">
              <Card interactive className="h-full p-5 sm:p-6">
                <p className="font-display text-lg tracking-tight text-[var(--paper)] sm:text-xl">
                  {guide.hook}
                </p>
                <p className="mt-3 text-sm text-[var(--brass)]">{guide.gold}</p>
              </Card>
            </Link>
          </li>
        ))}
      </ul>

      <LearnIndexCloser />
    </main>
  );
}
