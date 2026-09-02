import Link from "next/link";
import { LEARN_CTA, LEARN_INDEX_CTA } from "@/lib/learn";

/** Frozen closer on every /learn guide — links to the live demo overview, not a DMG. */
export function LearnCloser() {
  return (
    <section className="mt-16 border-t border-line pt-10">
      <h2 className="display-2 font-display text-2xl text-[var(--paper)] sm:text-3xl">
        {LEARN_CTA.title}
      </h2>
      <p className="mt-4 max-w-md text-[var(--muted)]">{LEARN_CTA.body}</p>
      <p className="mt-6 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
        <Link
          href={LEARN_CTA.href}
          className="font-medium text-[var(--brass)] underline decoration-[var(--brass-dim)] underline-offset-4 transition hover:decoration-[var(--brass)]"
        >
          {LEARN_CTA.demoLabel}
        </Link>
        <span className="text-[var(--faint)]">/</span>
        <Link
          href={LEARN_CTA.href}
          className="font-medium text-[var(--brass)] underline decoration-[var(--brass-dim)] underline-offset-4 transition hover:decoration-[var(--brass)]"
        >
          {LEARN_CTA.linkLabel}
        </Link>
      </p>
    </section>
  );
}

/** Index footer CTA — sample-data demo, not a download. */
export function LearnIndexCloser() {
  return (
    <section className="mt-16 border-t border-line pt-10">
      <h2 className="display-2 font-display text-2xl text-[var(--paper)] sm:text-3xl">
        {LEARN_INDEX_CTA.title}
      </h2>
      <p className="mt-4 text-[var(--muted)]">
        {LEARN_INDEX_CTA.body}{" "}
        <Link
          href={LEARN_INDEX_CTA.href}
          className="font-medium text-[var(--brass)] underline decoration-[var(--brass-dim)] underline-offset-4 transition hover:decoration-[var(--brass)]"
        >
          {LEARN_INDEX_CTA.linkLabel}
        </Link>
      </p>
    </section>
  );
}
