import type { Metadata } from "next";
import Link from "next/link";
import { LEARN_GUIDES } from "@/lib/learn";

export const metadata: Metadata = {
  title: "Guides — budgetr",
  description: "Short money lessons: net worth, envelopes, savings rate, and who holds a copy of your ledger.",
};

export default function LearnIndexPage() {
  return (
    <main className="mx-auto max-w-3xl px-5 py-16 sm:px-8">
      <div>
        <p className="eyebrow">Guides</p>
        <h1 className="display-1 mt-3 font-display text-4xl sm:text-5xl">Learn</h1>
      </div>

      <ol className="mt-12 divide-y divide-line/60 border-y border-line/60">
        {LEARN_GUIDES.map((guide, i) => (
          <li key={guide.slug}>
            <Link
              href={`/learn/${guide.slug}`}
              className="group flex items-baseline gap-4 py-5 transition hover:bg-[color-mix(in_srgb,var(--brass)_4%,transparent)]"
            >
              <span className="w-8 shrink-0 font-display text-sm tabular text-[var(--brass)]">
                {String(i + 1).padStart(2, "0")}
              </span>
              <span className="font-display text-lg tracking-tight text-[var(--paper)] group-hover:text-[var(--brass)] sm:text-xl">
                {guide.hook}
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </main>
  );
}
