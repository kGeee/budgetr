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
  Wallet,
  Settings,
  type LucideIcon,
} from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import { formatCurrency, isLiability, signedBalance } from "@/lib/utils";
import { convertToDisplay, getDisplayCurrency } from "@/lib/currency";

type NavItem = {
  href: string;
  label: string;
  /** Primary destinations only. The rest are text; 21 icons is texture, not signal. */
  icon?: LucideIcon;
  /** Which count, if any, this row reports. Absent counts render nothing. */
  badge?: "review";
};

/**
 * The four screens this app is opened for. They get icons, size, and a fixed
 * position above the scroll; everything else is one rank quieter. A flat list of
 * twenty-one equal rows can't say that Transactions is a daily habit and
 * Fundamentals is a twice-a-year visit — so it said neither.
 *
 * Editing this list is the whole knob: move an href up here to promote it.
 */
const primaryNav: NavItem[] = [
  { href: "/overview", label: "Overview", icon: LayoutDashboard },
  // { href: "/dashboards", label: "Dashboards", icon: LayoutGrid },
  { href: "/transactions", label: "Transactions", icon: ArrowLeftRight },
  { href: "/investments", label: "Investments", icon: LineChart },
  { href: "/budgets", label: "Budgets", icon: Wallet },
];

/** Everything else, grouped by what you're doing rather than by data model. */
const navGroups: { label: string; items: NavItem[] }[] = [
  {
    label: "Ledger",
    items: [
      { href: "/accounts", label: "Accounts" },
      { href: "/recurring", label: "Recurring" },
      { href: "/shared", label: "Shared" },
      { href: "/vendors", label: "Vendors" },
      { href: "/categories", label: "Categories" },
    ],
  },
  {
    label: "Investing",
    items: [
      { href: "/markets", label: "Markets" },
      { href: "/investments/options", label: "Options" },
      { href: "/investments/analysis", label: "Analysis" },
      { href: "/fundamentals", label: "Fundamentals" },
      { href: "/realized-gains", label: "Realized gains" },
    ],
  },
  {
    label: "Planning",
    items: [
      { href: "/cashflow", label: "Cashflow" },
      { href: "/goals", label: "Goals" },
      { href: "/fire", label: "FIRE" },
    ],
  },
  {
    label: "Assistant",
    items: [
      { href: "/review", label: "Review", badge: "review" },
      { href: "/insights", label: "Insights" },
      { href: "/rules", label: "Auto-tag rules" },
    ],
  },
];

const settingsItem: NavItem = { href: "/settings", label: "Settings", icon: Settings };

const nav: NavItem[] = [...primaryNav, ...navGroups.flatMap((g) => g.items), settingsItem];

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

// Display order + labels for the grouped accounts section. Labelled the way a
// person would say it, not the way Plaid types it — "Cash", never "Depository".
const ACCOUNT_GROUPS: { type: string; label: string }[] = [
  { type: "depository", label: "Cash" },
  { type: "investment", label: "Investments" },
  { type: "credit", label: "Cards" },
  { type: "loan", label: "Loans" },
  { type: "other", label: "Other" },
];

function fmtBalance(amount: number | null, currency: string | null) {
  // Routes through the shared formatter so privacy mode masks these too.
  return formatCurrency(amount ?? 0, currency ?? "USD", { maximumFractionDigits: 0 });
}

/** Every balance in one currency, so a mixed-currency book still totals. */
function inDisplayCurrency(a: SidebarAccount): number {
  return convertToDisplay(signedBalance(a.type, a.currentBalance), a.currency);
}

type Ledger = {
  netWorth: number;
  assets: number;
  liabilities: number;
  /** Asset composition, in render order. Zero-value slices are dropped. */
  slices: { key: string; label: string; value: number; color: string }[];
};

/**
 * What the account list adds up to. Everything here comes from balances the
 * sidebar was already being handed — the list was showing the parts and never
 * the sum, which is the one figure you open a finance app to see.
 */
function summarize(accounts: SidebarAccount[]): Ledger {
  const of = (pred: (a: SidebarAccount) => boolean) =>
    accounts.filter(pred).reduce((s, a) => s + Math.abs(inDisplayCurrency(a)), 0);

  const cash = of((a) => a.type === "depository");
  const invested = of((a) => a.type === "investment");
  const other = of((a) => !["depository", "investment", "credit", "loan"].includes(a.type));
  const liabilities = of((a) => isLiability(a.type));

  return {
    netWorth: accounts.reduce((s, a) => s + inDisplayCurrency(a), 0),
    assets: cash + invested + other,
    liabilities,
    slices: [
      { key: "cash", label: "cash", value: cash, color: "var(--brass)" },
      { key: "invested", label: "invested", value: invested, color: "var(--jade-deep)" },
      { key: "other", label: "other assets", value: other, color: "var(--line-strong)" },
    ].filter((s) => s.value > 0),
  };
}

/**
 * The signature line: net worth, with the shape of the book under it. One rule
 * split into what the money *is* (cash / invested / other), and — only when
 * there's debt — a second, shorter coral rule showing what's owed against it.
 * Leverage becomes something you see rather than something you compute.
 */
function LedgerHeadline({ ledger, compact = false }: { ledger: Ledger; compact?: boolean }) {
  const { netWorth, assets, liabilities, slices } = ledger;
  const currency = getDisplayCurrency();
  const money = (n: number) => formatCurrency(n, currency, { maximumFractionDigits: 0 });

  return (
    <div className={compact ? "" : "px-3"}>
      <p className="eyebrow">Net worth</p>
      <p
        className={`font-display tabular mt-1 ${netWorth < 0 ? "text-[var(--coral)]" : "text-[var(--paper)]"} ${
          compact ? "text-2xl" : "text-[22px]"
        }`}
      >
        {money(netWorth)}
      </p>

      {assets > 0 && (
        <div
          className="mt-2.5 space-y-1"
          role="img"
          aria-label={`${slices.map((s) => `${money(s.value)} ${s.label}`).join(", ")}${
            liabilities > 0 ? `, against ${money(liabilities)} owed` : ""
          }`}
        >
          <div className="flex h-[3px] gap-px overflow-hidden rounded-full">
            {slices.map((s) => (
              <span
                key={s.key}
                title={`${money(s.value)} ${s.label}`}
                style={{ width: `${(s.value / assets) * 100}%`, background: s.color }}
              />
            ))}
          </div>
          {liabilities > 0 && (
            <div className="h-[3px] rounded-full">
              <span
                className="block h-full rounded-full bg-[var(--coral)]/70"
                title={`${money(liabilities)} owed`}
                style={{ width: `${Math.min(100, (liabilities / assets) * 100)}%` }}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** One account line: what it's called, what's in it. */
function AccountRow({ account }: { account: SidebarAccount }) {
  const liability = isLiability(account.type);
  return (
    <li className="flex items-center justify-between gap-2 rounded-lg px-3 py-1 text-[13px]">
      <span className="min-w-0 truncate text-[var(--muted)]">{account.name}</span>
      <span
        className={`mono shrink-0 text-xs ${liability ? "text-[var(--coral)]" : "text-[var(--paper)]"}`}
      >
        {/* Debt reads as debt. A card balance shown as a positive number is the
            one place this sidebar could quietly flatter you. */}
        {liability && (account.currentBalance ?? 0) > 0 && "−"}
        {fmtBalance(account.currentBalance, account.currency)}
      </span>
    </li>
  );
}

/** Count that appears only when it's non-zero — an inbox worth opening. */
function Badge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="mono ml-auto shrink-0 rounded-full bg-[color-mix(in_srgb,var(--brass)_18%,transparent)] px-1.5 py-0.5 text-[10px] text-[var(--brass)]">
      {count > 99 ? "99+" : count}
    </span>
  );
}

/** The brass rail that marks the current page in both ranks of the nav. */
function ActiveRail({ active }: { active: boolean }) {
  return (
    <span
      className={`absolute left-0 top-1/2 h-4 -translate-y-1/2 rounded-full bg-[var(--brass)] transition-all ${
        active ? "w-[3px] opacity-100" : "w-0 opacity-0"
      }`}
    />
  );
}

export function Sidebar({
  accounts,
  reviewCount = 0,
  webDemo = false,
}: {
  accounts: SidebarAccount[];
  reviewCount?: number;
  webDemo?: boolean;
}) {
  const pathname = usePathname();
  const groupsNav = visibleGroups(webDemo);
  // Resolve the single active href once per render; an item is active iff it is
  // that most-specific match.
  const activeHref = bestMatchHref(pathname, nav);

  // Excluded accounts are hidden from the sidebar entirely — managed on /accounts.
  const visible = accounts.filter((a) => !a.excluded);
  const ledger = summarize(visible);
  const groups = ACCOUNT_GROUPS.map((g) => ({
    ...g,
    accounts: visible.filter((a) =>
      g.type === "other"
        ? !["credit", "depository", "investment", "loan"].includes(a.type)
        : a.type === g.type,
    ),
  })).filter((g) => g.accounts.length > 0);

  const counts: Record<string, number> = { review: reviewCount };

  return (
    /*
      Three zones, each with a job. The habits sit at the top and the money sits
      at the bottom, both out of the scroll; only the long tail of secondary
      destinations moves. Before this, one 1,400px column scrolled as a unit and
      the balances — the reason you open a finance app — lived permanently below
      the fold.
    */
    <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-r border-line md:flex">
      <div className="shrink-0 px-5 pt-6 pb-4">
        <Link
          href="/overview"
          className="flex items-center gap-2.5 px-2 transition-opacity hover:opacity-90"
        >
          <BrandMark size={28} />
          <span className="font-display text-xl tracking-tight">budgetr</span>
        </Link>

        <nav className="mt-6 flex flex-col gap-0.5">
          {primaryNav.map(({ href, label, icon: Icon }) => {
            const active = href === activeHref;
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={`relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors duration-200 ${
                  active
                    ? "bg-[var(--panel-2)] text-[var(--paper)] shadow-[var(--elev-1)]"
                    : "text-[var(--muted)] hover:bg-[var(--panel)] hover:text-[var(--paper)]"
                }`}
              >
                <ActiveRail active={active} />
                {Icon && <Icon size={17} strokeWidth={active ? 2.2 : 1.8} />}
                {label}
              </Link>
            );
          })}
        </nav>
      </div>

      {/* The tail: everything you reach for occasionally, one rank quieter and
          one indent in. Nothing is hidden — only weighted. */}
      <nav className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-1">
        {groupsNav.map((group) => (
          <div key={group.label}>
            <p className="eyebrow mb-1 px-3">{group.label}</p>
            <div className="flex flex-col">
              {group.items.map(({ href, label, badge }) => {
                const active = href === activeHref;
                return (
                  <Link
                    key={href}
                    href={href}
                    aria-current={active ? "page" : undefined}
                    className={`relative flex items-center gap-2 rounded-lg py-[5px] pl-6 pr-3 text-[13px] transition-colors ${
                      active
                        ? "text-[var(--brass)]"
                        : "text-[var(--muted)] hover:text-[var(--paper)]"
                    }`}
                  >
                    <ActiveRail active={active} />
                    {label}
                    {badge && <Badge count={counts[badge] ?? 0} />}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* The ledger itself, pinned. Capped so a book with fifteen accounts
          scrolls inside this panel instead of pushing the nav off-screen. */}
      {visible.length > 0 && (
        <div className="shrink-0 border-t border-line px-5 pt-4 pb-2">
          <LedgerHeadline ledger={ledger} />
          <div className="mt-3 max-h-[30dvh] space-y-3 overflow-y-auto">
            {groups.map((g) => (
              <div key={g.type}>
                <p className="eyebrow mb-1 px-3">{g.label}</p>
                <ul>
                  {g.accounts.map((a) => (
                    <AccountRow key={a.id} account={a} />
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex shrink-0 items-center justify-between gap-2 border-t border-line px-5 py-3">
        {!webDemo && (
          <Link
            href="/settings"
            aria-current={settingsItem.href === activeHref ? "page" : undefined}
            className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-[13px] transition-colors ${
              settingsItem.href === activeHref
                ? "text-[var(--brass)]"
                : "text-[var(--muted)] hover:text-[var(--paper)]"
            }`}
          >
            <Settings size={15} />
            Settings
          </Link>
        )}
        <p
          className="ml-auto text-right text-[11px] leading-tight text-[var(--faint)]"
          title="budgetr keeps every figure in a local database. Nothing is uploaded."
        >
          {webDemo ? "Read-only demo" : "Stays on this machine"}
        </p>
      </div>
    </aside>
  );
}

export function MobileNav({
  accounts = [],
  reviewCount = 0,
  webDemo = false,
}: {
  accounts?: SidebarAccount[];
  reviewCount?: number;
  webDemo?: boolean;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  // Header label + drawer highlight both key off the single most-specific match,
  // so the analysis page reads "Analysis" rather than its "/investments" parent.
  const activeHref = bestMatchHref(pathname, nav);
  const current = nav.find(({ href }) => href === activeHref);
  const groupsNav = visibleGroups(webDemo);
  const visible = accounts.filter((a) => !a.excluded);
  const counts: Record<string, number> = { review: reviewCount };

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
          <Link href="/overview" onClick={() => setOpen(false)} className="flex items-center gap-3">
            <BrandMark size={32} />
            <span className="font-display text-xl tracking-tight">budgetr</span>
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

        <nav className="min-h-0 flex-1 overflow-y-auto px-3 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          {/* Opening the drawer is the only way a phone sees the balances, so
              the headline leads rather than trailing eighteen links. */}
          {visible.length > 0 && (
            <div className="mb-5 px-4">
              <LedgerHeadline ledger={summarize(visible)} compact />
            </div>
          )}

          <div className="mb-5 flex flex-col gap-0.5">
            {primaryNav.map(({ href, label, icon: Icon }) => {
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
                  {Icon && <Icon size={19} strokeWidth={active ? 2.2 : 1.8} />}
                  {label}
                </Link>
              );
            })}
          </div>

          <div className="space-y-4">
            {groupsNav.map((group) => (
              <div key={group.label}>
                <p className="eyebrow mb-1 px-4">{group.label}</p>
                {group.items.map(({ href, label, badge }) => {
                  const active = href === activeHref;
                  return (
                    <Link
                      key={href}
                      href={href}
                      onClick={() => setOpen(false)}
                      aria-current={active ? "page" : undefined}
                      className={`flex items-center gap-2 rounded-xl py-2.5 pl-7 pr-4 text-[15px] transition-colors ${
                        active
                          ? "text-[var(--brass)]"
                          : "text-[var(--muted)] active:bg-[var(--panel)]"
                      }`}
                    >
                      {label}
                      {badge && <Badge count={counts[badge] ?? 0} />}
                    </Link>
                  );
                })}
              </div>
            ))}
          </div>

          {!webDemo && (
            <Link
              href="/settings"
              onClick={() => setOpen(false)}
              aria-current={settingsItem.href === activeHref ? "page" : undefined}
              className={`mt-5 flex items-center gap-3.5 rounded-xl px-4 py-3 text-base transition-colors ${
                settingsItem.href === activeHref
                  ? "text-[var(--brass)]"
                  : "text-[var(--muted)] active:bg-[var(--panel)]"
              }`}
            >
              <Settings size={19} />
              Settings
            </Link>
          )}
        </nav>
      </aside>
    </div>
  );
}
