import Link from "next/link";

export const PLAN_TABS = [
  { id: "forecast", label: "This month" },
  { id: "bills", label: "Bills & income" },
  { id: "long-run", label: "Long run" },
] as const;

export type PlanTab = (typeof PLAN_TABS)[number]["id"];

export function isPlanTab(v: string | undefined): v is PlanTab {
  return PLAN_TABS.some((t) => t.id === v);
}

/**
 * Same pill idiom as InvestmentsTabs, but server-rendered: the active tab comes
 * from `?tab=`, which only the page can read, so no usePathname round-trip.
 */
export function PlanTabs({ active }: { active: PlanTab }) {
  return (
    <nav
      aria-label="Plan"
      className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {PLAN_TABS.map((t) => {
        const on = t.id === active;
        return (
          <Link
            key={t.id}
            // The default tab gets the bare URL so it matches the sidebar link.
            href={t.id === "forecast" ? "/plan" : `/plan?tab=${t.id}`}
            aria-current={on ? "page" : undefined}
            className={`shrink-0 rounded-full border px-3 py-1.5 text-sm transition-colors ${
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
