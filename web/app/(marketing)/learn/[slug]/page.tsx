import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LearnCloser } from "@/components/marketing/learn-closer";
import { LEARN_GUIDES, getLearnGuide } from "@/lib/learn";

type Params = { slug: string };

export const dynamicParams = false;

export function generateStaticParams(): Params[] {
  return LEARN_GUIDES.map((g) => ({ slug: g.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { slug } = await params;
  const guide = getLearnGuide(slug);
  if (!guide) return { title: "Guides — budgetr" };
  return {
    title: `${guide.hook.replace(/\.$/, "")} — budgetr`,
    description: guide.gold,
  };
}

export default async function LearnGuidePage({ params }: { params: Promise<Params> }) {
  const { slug } = await params;
  const guide = getLearnGuide(slug);
  if (!guide) notFound();

  return (
    <main className="mx-auto max-w-3xl px-5 py-16 sm:px-8">
      <p className="eyebrow">
        <Link href="/learn" className="hover:text-[var(--paper)]">
          Guides
        </Link>
      </p>

      <h1 className="display-1 mt-4 font-display text-4xl leading-[1.05] sm:text-5xl">
        {guide.hook}
      </h1>

      <p className="mt-8 font-display text-2xl tracking-tight text-[var(--brass)] sm:text-3xl">
        {guide.gold}
      </p>
      {guide.goldNote ? (
        <p className="mt-3 text-sm text-[var(--muted)]">{guide.goldNote}</p>
      ) : null}

      <div className="mt-10 space-y-5">
        {guide.teach.map((paragraph) => (
          <p key={paragraph} className="max-w-xl text-lg leading-relaxed text-[var(--paper)]/90">
            {paragraph}
          </p>
        ))}
      </div>

      <LearnCloser />
    </main>
  );
}
