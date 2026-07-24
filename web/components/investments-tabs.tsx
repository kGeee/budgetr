"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// The two desks that share the segmented control. Ordered as they read.
const TABS: { href: string; label: string }[] = [
  { href: "/investments", label: "Portfolio" },
  { href: "/investments/analysis", label: "Analysis" },
];

/**
 * Segmented control tying the Portfolio and Analysis desks together so Analysis
 * reads as a sub-view of Investments rather than a separate destination.
 *
 * Rendered by `investments/layout.tsx` above every `/investments/*` page, but it
 * only shows on the two desks it actually links to — it returns `null` on
 * `/investments/options/...`, `/investments/import`, and any other sub-route so
 * those pages are left untouched.
 */
export function InvestmentsTabs() {
  const pathname = usePathname();

  // Only the two exact desk routes get the tab bar. An exact match keeps deeper
  // sub-routes (options, import, …) free of it.
  const onTabRoute = TABS.some((t) => t.href === pathname);
  if (!onTabRoute) return null;

  return (
    <nav aria-label="Investments" className="flex flex-wrap gap-1.5">
      {TABS.map((t) => {
        const active = t.href === pathname;
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
              active
                ? "border-[var(--brass-dim)] bg-[var(--panel-2)] text-[var(--paper)]"
                : "border-line text-[var(--muted)] hover:border-[var(--brass-dim)] hover:text-[var(--paper)]"
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
