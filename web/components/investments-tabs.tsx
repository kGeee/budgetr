"use client";

import { Suspense } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  INVESTMENTS_TABS,
  investmentsTabHref,
  parseInvestmentsTab,
} from "@/components/investments-tab-keys";

/**
 * Navigation for the whole investing section.
 *
 * Two bars, one idiom. `InvestmentsTabs` is the section bar: the three tabs of
 * /investments (Holdings · Allocation · Income & gains) and, only with the
 * Trading desk switched on, the desk's Markets · Options · Fundamentals. It's
 * rendered by `investments/layout.tsx` plus the two desk pages outside that
 * layout. `OptionsToolTabs` names the three tools inside the Options desk, and
 * `SubTabs` is the same pill row for a tool's own modes (Chain › Vol › LEAPS).
 *
 * Everything takes the desk flag as a prop: it's a server-side setting and this
 * is a client component.
 */

type Tab = { key: string; href: string; label: string };

// Segment-aware prefix test, same rule the sidebar uses: "/investments/options"
// matches "/investments/options/chain" but never "/investments/options-foo".
function matches(pathname: string, path: string) {
  return pathname === path || pathname.startsWith(path + "/");
}

function TabBar({
  tabs,
  active,
  label,
  size = "md",
}: {
  tabs: Tab[];
  active: string | null;
  label: string;
  size?: "md" | "sm";
}) {
  return (
    // Never wraps: on a phone the bar scrolls sideways rather than stacking into
    // three ragged rows. `-mx-1 px-1` keeps the focus ring off the clip edge.
    <nav
      aria-label={label}
      className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {tabs.map((t) => {
        const on = t.key === active;
        return (
          <Link
            key={t.key}
            href={t.href}
            aria-current={on ? "page" : undefined}
            className={`shrink-0 rounded-full border transition-colors ${
              size === "sm" ? "px-3 py-1 text-xs" : "px-3 py-1.5 text-sm"
            } ${
              on
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

const DESK: Tab[] = [
  { key: "markets", href: "/markets", label: "Markets" },
  { key: "options", href: "/investments/options", label: "Options" },
  { key: "fundamentals", href: "/fundamentals", label: "Fundamentals" },
];

export function sectionTabs(tradingDesk: boolean): Tab[] {
  const own = INVESTMENTS_TABS.map((t) => ({
    key: t.key,
    href: investmentsTabHref(t.key),
    label: t.label,
  }));
  return tradingDesk ? [...own, ...DESK] : own;
}

/** Which section tab a URL belongs to. Import is a Holdings action, so it lights Holdings. */
export function activeSection(pathname: string, tab: string | null): string | null {
  for (const d of DESK) if (matches(pathname, d.href)) return d.key;
  if (pathname === "/investments") return parseInvestmentsTab(tab);
  if (matches(pathname, "/investments/import")) return "holdings";
  return null;
}

function SectionBarWithQuery({ tradingDesk }: { tradingDesk: boolean }) {
  const pathname = usePathname();
  const tab = useSearchParams().get("tab");
  return (
    <TabBar
      tabs={sectionTabs(tradingDesk)}
      active={activeSection(pathname, tab)}
      label="Investments"
    />
  );
}

/**
 * The section bar. `?tab=` is only readable through useSearchParams, which
 * needs a Suspense boundary; the fallback is the same bar lit by path alone
 * (so /investments shows Holdings until the query is known).
 */
export function InvestmentsTabs({ tradingDesk }: { tradingDesk: boolean }) {
  const pathname = usePathname();
  return (
    <Suspense
      fallback={
        <TabBar
          tabs={sectionTabs(tradingDesk)}
          active={activeSection(pathname, null)}
          label="Investments"
        />
      }
    >
      <SectionBarWithQuery tradingDesk={tradingDesk} />
    </Suspense>
  );
}

/** Tools of the Options desk. `carriesTicker` marks the symbol-scoped one. */
const TOOLS: (Tab & { carriesTicker?: boolean })[] = [
  { key: "/investments/options", href: "/investments/options", label: "Positions" },
  { key: "/investments/options/chain", href: "/investments/options/chain", label: "Chain", carriesTicker: true },
  { key: "/investments/options/wheel", href: "/investments/options/wheel", label: "Wheel" },
];

/**
 * The Options desk's tool bar. Rendered by each options page rather than the
 * options layout, because only a page can read `?ticker=` — and Chain has to
 * keep the symbol when you come back to it.
 */
export function OptionsToolTabs({ ticker }: { ticker?: string | null }) {
  const pathname = usePathname();
  const sym = ticker?.trim().toUpperCase();
  const tabs: Tab[] = TOOLS.map((t) =>
    t.carriesTicker && sym ? { ...t, href: `${t.href}?ticker=${encodeURIComponent(sym)}` } : t,
  );
  // Longest matching path wins, so /investments/options/chain lights Chain
  // rather than its Positions parent.
  let active: string | null = null;
  for (const t of TOOLS) {
    if (matches(pathname, t.key) && (active === null || t.key.length > active.length)) active = t.key;
  }
  return <TabBar tabs={tabs} active={active} label="Options tools" size="sm" />;
}

/**
 * A tool's own modes, e.g. Chain · Vol · LEAPS on the chain page or Your wheel ·
 * Scanner on the wheel page. The page knows its mode, so it passes it in.
 */
export function SubTabs({
  tabs,
  active,
  label,
}: {
  tabs: Tab[];
  active: string;
  label: string;
}) {
  return <TabBar tabs={tabs} active={active} label={label} size="sm" />;
}
