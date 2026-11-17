"use client";

import { Suspense } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { PLAN_TABS } from "@/app/(app)/plan/plan-tabs";
import { activeSection, sectionTabs } from "@/components/investments-tabs";
import { SPENDING_VIEWS, spendingHref } from "@/components/spending/href";

/**
 * The page's name and its tabs, in the top bar.
 *
 * Every page used to spend its first row on a title and its second on a row of
 * pills. Both now live in the bar that was already there: the title sits left of
 * the controls and the section's tabs hang off the bar's bottom rule, so the
 * page itself starts with its figure.
 *
 * It's a client component because only the client knows the path and query a
 * shared layout is rendering for. The tab lists themselves come from the same
 * modules the pages parse their params with, so the two can't drift.
 */

type Tab = { key: string; label: string; href: string; badge?: number };
type Section = { title: string; label?: string; tabs?: Tab[]; active?: string | null };

function under(pathname: string, path: string) {
  return pathname === path || pathname.startsWith(path + "/");
}

function resolve(
  pathname: string,
  query: URLSearchParams | null,
  { tradingDesk, reviewCount }: { tradingDesk: boolean; reviewCount: number },
): Section {
  const q = (k: string) => query?.get(k) ?? null;

  if (under(pathname, "/overview")) return { title: "Home" };

  if (under(pathname, "/transactions")) {
    return {
      title: "Transactions",
      label: "Transactions view",
      tabs: [
        { key: "all", label: "All", href: "/transactions" },
        { key: "review", label: "Review", href: "/transactions?view=review", badge: reviewCount },
      ],
      active: q("view") === "review" ? "review" : "all",
    };
  }

  if (under(pathname, "/spending")) {
    // Carry a period only when the reader chose one — see spendingHref.
    const period = q("period") ?? undefined;
    return {
      title: "Spending",
      label: "Spending views",
      tabs: [
        ...SPENDING_VIEWS.map((v) => ({
          key: v.key,
          label: v.label,
          href: spendingHref({ view: v.key, period }),
        })),
        { key: "report", label: "Report", href: spendingHref({ report: true, period }) },
      ],
      active: q("report") ? "report" : (SPENDING_VIEWS.find((v) => v.key === q("view"))?.key ?? "category"),
    };
  }

  if (under(pathname, "/budgets")) return { title: "Budgets" };

  if (under(pathname, "/plan")) {
    return {
      title: "Plan",
      label: "Plan",
      tabs: PLAN_TABS.map((t) => ({
        key: t.id,
        label: t.label,
        href: t.id === "forecast" ? "/plan" : `/plan?tab=${t.id}`,
      })),
      active: PLAN_TABS.find((t) => t.id === q("tab"))?.id ?? "forecast",
    };
  }

  if (under(pathname, "/investments") || under(pathname, "/markets") || under(pathname, "/fundamentals")) {
    return {
      title: "Investments",
      label: "Investments",
      tabs: sectionTabs(tradingDesk),
      active: activeSection(pathname, q("tab")),
    };
  }

  if (under(pathname, "/accounts")) return { title: "Accounts" };
  if (under(pathname, "/shared")) return { title: "Shared" };
  if (under(pathname, "/settings")) return { title: "Settings" };
  return { title: "budgetr" };
}

function Bar({ section }: { section: Section }) {
  return (
    <>
      {/* On a phone the drawer button already names the page, so the heading is
          kept for assistive tech only. */}
      <h1 className="sr-only shrink-0 font-display text-[22px] tracking-tight md:not-sr-only">
        {section.title}
      </h1>
      {section.tabs && (
        <nav
          aria-label={section.label}
          className="order-last -mb-3 flex basis-full gap-1 overflow-x-auto [scrollbar-width:none] md:order-none md:-my-3 md:min-w-0 md:flex-1 md:basis-auto md:self-stretch [&::-webkit-scrollbar]:hidden"
        >
          {section.tabs.map((t) => {
            const on = t.key === section.active;
            return (
              <Link
                key={t.key}
                href={t.href}
                aria-current={on ? "page" : undefined}
                className={`flex min-h-11 shrink-0 items-center gap-2 border-b-2 px-3 text-sm font-medium transition-colors md:min-h-14 ${
                  on
                    ? "border-[var(--brass)] text-[var(--paper)]"
                    : "border-transparent text-[var(--muted)] hover:text-[var(--paper)]"
                }`}
              >
                {t.label}
                {t.badge != null && t.badge > 0 && (
                  <span className="mono rounded-full bg-[var(--brass)] px-1.5 py-px text-[11px] text-[var(--on-brass)]">
                    {t.badge > 99 ? "99+" : t.badge}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>
      )}
      {!section.tabs && <span className="hidden flex-1 md:block" />}
    </>
  );
}

function WithQuery(props: { tradingDesk: boolean; reviewCount: number }) {
  return <Bar section={resolve(usePathname(), useSearchParams(), props)} />;
}

/**
 * `?tab=` / `?view=` are only readable through useSearchParams, which needs a
 * Suspense boundary; the fallback is the same bar lit by path alone.
 */
export function Topbar(props: { tradingDesk: boolean; reviewCount: number }) {
  const pathname = usePathname();
  return (
    <Suspense fallback={<Bar section={resolve(pathname, null, props)} />}>
      <WithQuery {...props} />
    </Suspense>
  );
}
