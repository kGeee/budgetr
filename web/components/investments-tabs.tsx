"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Navigation for the whole investing section.
 *
 * Two bars, one idiom. `InvestmentsTabs` names every desk in the section and is
 * rendered by `investments/layout.tsx` (plus the two desks that live outside
 * that layout, Fundamentals and Realized gains). `OptionsToolTabs` names the
 * five tools inside the Options desk.
 *
 * It used to list only Portfolio + Analysis and return `null` on every options
 * route, which is how the wheel scanner ended up with no reachable entry point:
 * navigation vanished exactly where the section got deep, and each page
 * hand-wrote its own back-links instead. Both bars now persist, so a desk is
 * always one click from any other.
 */

// `href` is where the tab goes; `path` is the bare route it represents. They
// differ only for the ticker-carrying tools, whose href gains a query string —
// which must not stop the tab from lighting up.
type Tab = { href: string; label: string; path?: string };

const SECTION: Tab[] = [
  { href: "/investments", label: "Portfolio" },
  { href: "/investments/options", label: "Options" },
  { href: "/investments/analysis", label: "Analysis" },
  { href: "/fundamentals", label: "Fundamentals" },
  { href: "/realized-gains", label: "Realized gains" },
];

/** Tools of the Options desk. `carriesTicker` marks the symbol-scoped ones. */
const TOOLS: (Tab & { carriesTicker?: boolean })[] = [
  { href: "/investments/options", label: "Positions" },
  { href: "/investments/options/chain", label: "Chain", carriesTicker: true },
  { href: "/investments/options/wheel", label: "Wheel" },
  { href: "/investments/options/scanner", label: "Scanner" },
  { href: "/investments/options/vol", label: "Vol", carriesTicker: true },
];

// Segment-aware prefix test, same rule the sidebar uses: "/investments" matches
// "/investments/analysis" but never "/investments-foo".
function matches(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(href + "/");
}

/** The longest matching href wins, so /investments/options lights up Options
 * rather than its Portfolio parent. */
function activeHref(pathname: string, tabs: Tab[]): string | null {
  let best: string | null = null;
  for (const t of tabs) {
    const path = t.path ?? t.href;
    if (matches(pathname, path) && (best === null || path.length > best.length)) best = path;
  }
  return best;
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
        const on = (t.path ?? t.href) === active;
        return (
          <Link
            key={t.path ?? t.href}
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

/** The section bar: Portfolio · Options · Analysis · Fundamentals · Realized gains. */
export function InvestmentsTabs() {
  const pathname = usePathname();
  return <TabBar tabs={SECTION} active={activeHref(pathname, SECTION)} label="Investments" />;
}

/**
 * The Options desk's tool bar. Rendered by each options page rather than a
 * layout, because only a page can read `?ticker=` — and Chain and Vol have to
 * keep the symbol when you move between them.
 */
export function OptionsToolTabs({ ticker }: { ticker?: string | null }) {
  const pathname = usePathname();
  const sym = ticker?.trim().toUpperCase();
  const tabs: Tab[] = TOOLS.map((t) =>
    t.carriesTicker && sym
      ? { ...t, path: t.href, href: `${t.href}?ticker=${encodeURIComponent(sym)}` }
      : t,
  );
  return <TabBar tabs={tabs} active={activeHref(pathname, TOOLS)} label="Options tools" size="sm" />;
}
