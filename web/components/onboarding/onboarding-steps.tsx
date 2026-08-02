"use client";

/**
 * Presentational building blocks shared by the full-page onboarding wizard
 * (components/onboarding-wizard.tsx) and the in-app Plaid setup modal
 * (components/plaid-setup-modal.tsx): the progress Stepper, a titled Step with
 * back/next controls, a numbered Walk list item, and an external-link anchor.
 *
 * These are pure UI — no data access, no step state — so both flows can compose
 * the same look without duplicating markup.
 */

import { ArrowLeft, ArrowRight, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Horizontal numbered progress indicator. `step` is the 0-based active index. */
export function Stepper({ steps, step }: { steps: readonly string[]; step: number }) {
  return (
    <div className="flex items-center gap-2">
      {steps.map((label, i) => (
        <div key={label} className="flex flex-1 items-center gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <span
              className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-medium transition-colors ${
                i < step
                  ? "bg-[var(--jade)] text-[var(--on-jade)]"
                  : i === step
                    ? "bg-[var(--brass)] text-[var(--on-brass)]"
                    : "border border-line text-[var(--faint)]"
              }`}
            >
              {i < step ? "✓" : i + 1}
            </span>
            <span
              className={`hidden truncate text-xs sm:block ${i === step ? "text-[var(--paper)]" : "text-[var(--muted)]"}`}
            >
              {label}
            </span>
          </div>
          {i < steps.length - 1 && (
            <span className={`h-px flex-1 ${i < step ? "bg-[var(--jade)]" : "bg-line"}`} />
          )}
        </div>
      ))}
    </div>
  );
}

/** A titled step body with optional Back / Continue controls. */
export function Step({
  title,
  body,
  back,
  next,
  nextLabel = "Continue",
}: {
  title: string;
  body: React.ReactNode;
  back?: () => void;
  next?: () => void;
  nextLabel?: string;
}) {
  return (
    <div>
      <h2 className="font-display text-2xl tracking-tight">{title}</h2>
      <div className="mt-4 text-sm leading-relaxed text-[var(--paper)]/90">{body}</div>
      {(back || next) && (
        <div className="mt-8 flex items-center justify-between">
          {back ? (
            <button
              type="button"
              onClick={back}
              className="inline-flex items-center gap-1.5 text-sm text-[var(--muted)] hover:text-[var(--paper)]"
            >
              <ArrowLeft size={15} /> Back
            </button>
          ) : (
            <span />
          )}
          {next && (
            <Button variant="primary" onClick={next}>
              {nextLabel} <ArrowRight size={15} />
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

/** A numbered list item for a "do this" walkthrough. */
export function Walk({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full border border-[var(--brass-dim)] text-xs text-[var(--brass)]">
        {n}
      </span>
      <span className="text-[var(--paper)]/90">{children}</span>
    </li>
  );
}

/** External link styled for the onboarding copy. */
export function A({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-0.5 text-[var(--brass)] underline decoration-[var(--brass-dim)] underline-offset-2 hover:decoration-[var(--brass)]"
    >
      {children}
      <ExternalLink size={12} />
    </a>
  );
}
