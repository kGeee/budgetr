import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight } from "lucide-react";
import {
  LEARN_ARTICLES,
  getLearnArticle,
  getLearnArticleIndex,
  getNextLearnArticle,
} from "@/lib/learn";
import { DEMO_HREF } from "@/lib/site";

type Params = { slug: string };

export const dynamicParams = false;

export function generateStaticParams(): Params[] {
  return LEARN_ARTICLES.map((a) => ({ slug: a.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { slug } = await params;
  const article = getLearnArticle(slug);
  if (!article) return { title: "Learn — budgetr" };
  return {
    title: `${article.title} — budgetr`,
    description: article.paragraphs[0],
  };
}

export default async function LearnArticlePage({ params }: { params: Promise<Params> }) {
  const { slug } = await params;
  const article = getLearnArticle(slug);
  if (!article) notFound();

  const index = getLearnArticleIndex(slug);
  const next = getNextLearnArticle(slug);
  const isLast = index === LEARN_ARTICLES.length - 1;

  return (
    <main className="mx-auto max-w-3xl px-5 py-16 sm:px-8">
      <p className="eyebrow">
        <Link href="/learn" className="hover:text-[var(--paper)]">
          Learn
        </Link>
        <span className="text-[var(--faint)]"> · </span>
        <span>
          {index + 1} of {LEARN_ARTICLES.length}
        </span>
      </p>

      <h1 className="display-1 mt-4 font-display text-4xl leading-[1.05] sm:text-5xl">
        {article.title}
      </h1>

      <div className="mt-10 space-y-5">
        {article.paragraphs.map((paragraph, i) => (
          <p
            key={`${slug}-${i}`}
            className="max-w-xl text-lg leading-relaxed text-[var(--paper)]/90"
          >
            {paragraph}
          </p>
        ))}
      </div>

      {isLast ? (
        <section className="mt-16 border-t border-line pt-10">
          <h2 className="display-2 font-display text-2xl text-[var(--paper)] sm:text-3xl">
            Do this on your Mac.
          </h2>
          <p className="mt-4 max-w-md text-[var(--muted)]">
            Your ledger is a SQLite file on this Mac. budgetr does not have a copy.
          </p>
          <p className="mt-6">
            <Link
              href={DEMO_HREF}
              className="inline-flex items-center gap-1.5 font-medium text-[var(--brass)] underline decoration-[var(--brass-dim)] underline-offset-4 transition hover:decoration-[var(--brass)]"
            >
              Try the live demo (sample data)
              <ArrowRight size={15} />
            </Link>
            <span className="text-[var(--faint)]">: </span>
            <Link
              href={DEMO_HREF}
              className="font-medium text-[var(--brass)] underline decoration-[var(--brass-dim)] underline-offset-4 transition hover:decoration-[var(--brass)]"
            >
              /overview
            </Link>
          </p>
        </section>
      ) : next ? (
        <p className="mt-16 border-t border-line pt-10">
          <Link
            href={`/learn/${next.slug}`}
            className="group inline-flex items-center gap-1.5 font-medium text-[var(--brass)] underline decoration-[var(--brass-dim)] underline-offset-4 transition hover:decoration-[var(--brass)]"
          >
            Next: {next.title}
            <ArrowRight size={15} className="transition-transform group-hover:translate-x-0.5" />
          </Link>
        </p>
      ) : null}
    </main>
  );
}
