import type { Metadata } from "next";
import Link from "next/link";
import { LEARN_ARTICLES } from "@/lib/learn";

export const metadata: Metadata = {
  title: "Learn — budgetr",
  description:
    "Saving, then investing, then how to read a market. A knowledge path in eleven pages.",
};

export default function LearnIndexPage() {
  return (
    <main className="mx-auto max-w-3xl px-5 py-16 sm:px-8">
      <div className="max-w-2xl">
        <p className="eyebrow">Guides</p>
        <h1 className="display-1 mt-3 font-display text-4xl sm:text-5xl">Learn, in order</h1>
        <p className="mt-4 text-[var(--muted)]">
          Saving, then investing, then how to read a market. The Mac app is optional until the last
          page.
        </p>
      </div>

      <ol className="mt-12 space-y-4">
        {LEARN_ARTICLES.map((article, i) => (
          <li key={article.slug} className="flex gap-4">
            <span className="w-6 shrink-0 tabular text-[var(--brass)]">{i + 1}.</span>
            <Link
              href={`/learn/${article.slug}`}
              className="font-display text-lg tracking-tight text-[var(--paper)] underline decoration-[var(--brass-dim)] underline-offset-4 transition hover:decoration-[var(--brass)] sm:text-xl"
            >
              {article.title}
            </Link>
          </li>
        ))}
      </ol>
    </main>
  );
}
