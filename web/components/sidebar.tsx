"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  Menu,
  X,
  LayoutDashboard,
  LayoutGrid,
  ArrowLeftRight,
  LineChart,
  Gauge,
  Building2,
  Landmark,
  Shapes,
  Wallet,
  PiggyBank,
  Repeat,
  Receipt,
  Sparkles,
  Store,
  TrendingUp,
  Users,
  Wand2,
  Flame,
  Settings,
  type LucideIcon,
} from "lucide-react";
import { formatCurrency } from "@/lib/utils";

type NavItem = { href: string; label: string; icon: LucideIcon };

// Grouped by what you're doing, not by data model. The first and last groups
// are unlabelled: the landing screens sit above the fold, Settings below.
const navGroups: { label?: string; items: NavItem[] }[] = [
  {
    items: [
      { href: "/overview", label: "Overview", icon: LayoutDashboard },
      { href: "/dashboards", label: "Dashboards", icon: LayoutGrid },
    ],
  },
  {
    label: "Ledger",
    items: [
      { href: "/accounts", label: "Accounts", icon: Landmark },
      { href: "/transactions", label: "Transactions", icon: ArrowLeftRight },
      { href: "/recurring", label: "Recurring", icon: Repeat },
      { href: "/shared", label: "Shared", icon: Users },
      { href: "/vendors", label: "Vendors", icon: Store },
      { href: "/categories", label: "Categories", icon: Shapes },
    ],
  },
  {
    label: "Investments",
    items: [
      { href: "/investments", label: "Investments", icon: LineChart },
      { href: "/investments/analysis", label: "Analysis", icon: Gauge },
      { href: "/fundamentals", label: "Fundamentals", icon: Building2 },
      { href: "/realized-gains", label: "Realized gains", icon: Receipt },
    ],
  },
  {
    label: "Planning",
    items: [
      { href: "/budgets", label: "Budgets", icon: Wallet },
      { href: "/cashflow", label: "Cashflow", icon: TrendingUp },
      { href: "/goals", label: "Goals", icon: PiggyBank },
      { href: "/fire", label: "FIRE", icon: Flame },
    ],
  },
  {
    label: "Assistant",
    items: [
      { href: "/review", label: "Review", icon: Sparkles },
      { href: "/insights", label: "Insights", icon: Sparkles },
      { href: "/rules", label: "Auto-tag rules", icon: Wand2 },
    ],
  },
  {
    items: [{ href: "/settings", label: "Settings", icon: Settings }],
  },
];

const nav: NavItem[] = navGroups.flatMap((g) => g.items);

// On the read-only web demo, drop nav items that only make sense on a real
// install (Settings → API keys). Everything else is browsable.
const DEMO_HIDDEN = new Set(["/settings"]);
function visibleGroups(webDemo: boolean) {
  if (!webDemo) return navGroups;
  return navGroups
    .map((g) => ({ ...g, items: g.items.filter((i) => !DEMO_HIDDEN.has(i.href)) }))
    .filter((g) => g.items.length > 0);
}

// Does `pathname` sit at or under `href`? Uses a segment-aware prefix test so
// "/investments" matches "/investments/analysis" but never "/investments-foo".
function matchesHref(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}

// The single most-specific nav item for the current path: the longest matching
// href across all items. This makes exactly one row active — on
// "/investments/analysis" only "Analysis" lights up (not its "/investments"
// parent), and the mobile header resolves to the deepest match.
function bestMatchHref(pathname: string, items: NavItem[]): string | null {
  let best: string | null = null;
  for (const { href } of items) {
    if (matchesHref(pathname, href) && (best === null || href.length > best.length)) {
      best = href;
    }
  }
  return best;
}

export type SidebarAccount = {
  id: string;
  name: string;
  mask: string | null;
  type: string;
  currentBalance: number | null;
  currency: string | null;
  excluded?: boolean;
};

// Display order + labels for the grouped accounts section.
const ACCOUNT_GROUPS: { type: string; label: string }[] = [
  { type: "credit", label: "Credit card" },
  { type: "depository", label: "Depository" },
  { type: "investment", label: "Investment" },
  { type: "loan", label: "Loan" },
  { type: "other", label: "Other" },
];

function fmtBalance(amount: number | null, currency: string | null) {
  // Routes through the shared formatter so privacy mode masks these too.
  return formatCurrency(amount ?? 0, currency ?? "USD", { maximumFractionDigits: 0 });
}

export function Sidebar({ accounts, webDemo = false }: { accounts: SidebarAccount[]; webDemo?: boolean }) {
  const pathname = usePathname();
  const groupsNav = visibleGroups(webDemo);
  // Resolve the single active href once per render; an item is active iff it is
  // that most-specific match.
  const activeHref = bestMatchHref(pathname, nav);

  // Excluded accounts are hidden from the sidebar entirely — managed on /accounts.
  const visible = accounts.filter((a) => !a.excluded);
  const groups = ACCOUNT_GROUPS.map((g) => ({
    ...g,
    accounts: visible.filter((a) =>
      g.type === "other"
        ? !["credit", "depository", "investment", "loan"].includes(a.type)
        : a.type === g.type,
    ),
  })).filter((g) => g.accounts.length > 0);

  return (
    <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-r border-line md:flex">
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 py-7">
        <Link
          href="/overview"
          className="group mb-9 flex items-center gap-3 px-2 transition-opacity hover:opacity-90"
        >
          <span className="grid h-9 w-9 place-items-center rounded-xl border border-[var(--brass-dim)] bg-[var(--panel)] font-display text-lg text-[var(--brass)] shadow-[var(--elev-1)] transition-colors duration-200 group-hover:border-[var(--brass)]">
            ₿
          </span>
          <span className="font-display text-2xl tracking-tight">budgetr</span>
        </Link>

        <nav className="flex flex-col gap-5">
          {groupsNav.map((group, i) => (
            <div key={group.label ?? `group-${i}`}>
              {group.label && <p className="eyebrow mb-2 px-3">{group.label}</p>}
              <div className="flex flex-col gap-1">
                {group.items.map(({ href, label, icon: Icon }) => {
                  const active = href === activeHref;
                  return (
                    <Link
                      key={href}
                      href={href}
                      aria-current={active ? "page" : undefined}
                      className={`group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors duration-200 ${
                        active
                          ? "bg-[var(--panel-2)] text-[var(--paper)] shadow-[var(--elev-1)]"
                          : "text-[var(--muted)] hover:bg-[var(--panel)] hover:text-[var(--paper)]"
                      }`}
                    >
                      <span
                        className={`absolute left-0 top-1/2 h-5 -translate-y-1/2 rounded-full bg-[var(--brass)] transition-all ${
                          active ? "w-[3px] opacity-100" : "w-0 opacity-0"
                        }`}
                      />
                      <Icon size={18} strokeWidth={active ? 2.2 : 1.8} />
                      {label}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* Accounts grouped by type, with inline balances. */}
        {groups.length > 0 && (
          <div className="mt-8 space-y-5">
            {groups.map((g) => (
              <div key={g.type}>
                <p className="eyebrow mb-2 px-3">{g.label}</p>
                <ul className="space-y-0.5">
                  {g.accounts.map((a) => {
                    const liability = a.type === "credit" || a.type === "loan";
                    return (
                      <li
                        key={a.id}
                        className="flex items-center justify-between gap-2 rounded-lg px-3 py-1.5 text-sm"
                      >
                        <span className="min-w-0 truncate text-[var(--muted)]">{a.name}</span>
                        <span
                          className={`mono shrink-0 text-xs ${liability ? "text-[var(--coral)]" : "text-[var(--paper)]"}`}
                        >
                          {fmtBalance(a.currentBalance, a.currency)}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-line px-5 py-4">
        <p className="mt-1 text-xs leading-relaxed text-[var(--muted)]">
          Read-only · data stays on this machine.
        </p>
      </div>
    </aside>
  );
}

export function MobileNav({ webDemo = false }: { webDemo?: boolean }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  // Header label + drawer highlight both key off the single most-specific match,
  // so the analysis page reads "Analysis" rather than its "/investments" parent.
  const activeHref = bestMatchHref(pathname, nav);
  const current = nav.find(({ href }) => href === activeHref);
  const groupsNav = visibleGroups(webDemo);

  return (
    <div className="min-w-0 flex-1 md:hidden">
      {/* Hamburger + current page name — one comfortable touch target. The
          label truncates so the header controls never get pushed past the
          viewport edge (which breaks page width on phones). */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open navigation"
        aria-expanded={open}
        className="-ml-1 flex max-w-full min-w-0 items-center gap-2.5 rounded-lg px-2 py-2 text-[var(--paper)] active:bg-[var(--panel)]"
      >
        <Menu size={21} className="shrink-0" />
        <span className="truncate font-display text-lg tracking-tight">
          {current?.label ?? "budgetr"}
        </span>
      </button>

      {/* Dimmed click-away backdrop. Stays mounted so open/close can animate. */}
      <div
        className={`fixed inset-0 z-40 bg-[var(--scrim)] backdrop-blur-[2px] transition-opacity duration-200 md:hidden ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        onClick={() => setOpen(false)}
        aria-hidden
      />

      {/* Slide-in drawer from the left (mirrors the right-side detail drawers). */}
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Navigation"
        className={`material-thick fixed left-0 top-0 z-50 flex h-dvh w-[85vw] max-w-[320px] flex-col border-r border-line shadow-[8px_0_40px_-12px_rgba(0,0,0,0.7)] transition-transform duration-300 ease-[var(--ease)] will-change-transform md:hidden ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-line px-5 py-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
          <Link
            href="/overview"
            onClick={() => setOpen(false)}
            className="flex items-center gap-3"
          >
            <span className="grid h-9 w-9 place-items-center rounded-xl border border-[var(--brass-dim)] bg-[var(--panel)] font-display text-lg text-[var(--brass)]">
              ₿
            </span>
            <span className="font-display text-2xl tracking-tight">budgetr</span>
          </Link>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close navigation"
            className="rounded-lg p-2.5 text-[var(--muted)] active:bg-[var(--panel)]"
          >
            <X size={22} />
          </button>
        </div>
        <nav className="min-h-0 flex-1 space-y-4 overflow-y-auto px-3 py-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
          {groupsNav.map((group, i) => (
            <div key={group.label ?? `group-${i}`}>
              {group.label && <p className="eyebrow mb-1.5 px-4">{group.label}</p>}
              {group.items.map(({ href, label, icon: Icon }) => {
                const active = href === activeHref;
                return (
                  <Link
                    key={href}
                    href={href}
                    onClick={() => setOpen(false)}
                    aria-current={active ? "page" : undefined}
                    className={`flex items-center gap-3.5 rounded-xl px-4 py-3 text-base transition-colors ${
                      active
                        ? "bg-[var(--panel-2)] text-[var(--paper)]"
                        : "text-[var(--muted)] active:bg-[var(--panel)]"
                    }`}
                  >
                    <Icon size={20} strokeWidth={active ? 2.2 : 1.8} />
                    {label}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>
      </aside>
    </div>
  );
}
