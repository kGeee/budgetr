"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  Menu,
  X,
  LayoutDashboard,
  ArrowLeftRight,
  PieChart,
  CalendarClock,
  LineChart,
  Wallet,
  Settings,
  Landmark,
  Users,
  type LucideIcon,
} from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import { PaletteTrigger } from "@/components/command-palette";
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
 * The six screens this app is opened for, one question each: am I OK (Home),
 * what happened (Transactions), where did it go (Spending), am I on plan
 * (Budgets), what's coming (Plan), what do I own (Investments). They get icons,
 * size, and a fixed position above the scroll.
 *
 * 0.15 folded twenty-one destinations into these — most of the old pages were
 * the same queries drawn a second time. Editing this list is the whole knob.
 */
const primaryNav: NavItem[] = [
  { href: "/overview", label: "Home", icon: LayoutDashboard },
  { href: "/transactions", label: "Transactions", icon: ArrowLeftRight, badge: "review" },
  { href: "/spending", label: "Spending", icon: PieChart },
  { href: "/budgets", label: "Budgets", icon: Wallet },
  { href: "/plan", label: "Plan", icon: CalendarClock },
  { href: "/investments", label: "Investments", icon: LineChart },
];

/** The occasional destinations, one rank quieter. */
const ledgerGroup = {
  label: "Ledger",
  items: [
    { href: "/accounts", label: "Accounts", icon: Landmark },
    { href: "/shared", label: "Shared", icon: Users },
  ],
};

/** Trading tools — shown only when Settings → Trading desk is on (lib/trading-desk.ts). */
const deskGroup = {
  label: "Trading desk",
  items: [
    { href: "/markets", label: "Markets" },
    { href: "/investments/options", label: "Options" },
    { href: "/fundamentals", label: "Fundamentals" },
  ],
};

const settingsItem: NavItem = { href: "/settings", label: "Settings", icon: Settings };

const nav: NavItem[] = [
  ...primaryNav,
  ...ledgerGroup.items,
  ...deskGroup.items,
  settingsItem,
];

function visibleGroups(tradingDesk: boolean): { label: string; items: NavItem[] }[] {
  return tradingDesk ? [ledgerGroup, deskGroup] : [ledgerGroup];
}

// Does `pathname` sit at or under `href`? Uses a segment-aware prefix test so
// "/investments" matches "/investments/options" but never "/investments-foo".
function matchesHref(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}

// The single most-specific nav item for the current path: the longest matching
// href across all items. This makes exactly one row active — on
// "/investments/options" only "Options" lights up (not its "/investments"
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

/** Count that appears only when it's non-zero — an inbox worth opening. */
function Badge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="mono ml-auto shrink-0 rounded-full bg-[color-mix(in_srgb,var(--brass)_18%,transparent)] px-1.5 py-0.5 text-[10px] text-[var(--brass)]">
      {count > 99 ? "99+" : count}
    </span>
  );
}

export type SidebarStatus = { tone: "ok" | "warn" | "bad"; label: string };

const STATUS_DOT: Record<SidebarStatus["tone"], string> = {
  ok: "bg-[var(--jade)]",
  warn: "bg-[var(--brass)]",
  bad: "bg-[var(--coral)]",
};

export function Sidebar({
  accounts,
  reviewCount = 0,
  webDemo = false,
  tradingDesk = false,
  status,
}: {
  accounts: SidebarAccount[];
  reviewCount?: number;
  webDemo?: boolean;
  tradingDesk?: boolean;
  /** One line on whether the data behind every figure is current. */
  status?: SidebarStatus;
}) {
  const pathname = usePathname();
  // Resolve the single active href once per render; an item is active iff it is
  // that most-specific match.
  const activeHref = bestMatchHref(pathname, nav);

  // Excluded accounts stay out of the headline — managed on /accounts.
  const visible = accounts.filter((a) => !a.excluded);
  const ledger = summarize(visible);
  const counts: Record<string, number> = { review: reviewCount };

  const secondary: NavItem[] = [...ledgerGroup.items, ...(webDemo ? [] : [settingsItem])];

  function row({ href, label, icon: Icon, badge }: NavItem, quiet = false) {
    const active = href === activeHref;
    return (
      <Link
        key={href}
        href={href}
        aria-current={active ? "page" : undefined}
        className={`flex min-h-11 items-center gap-3 rounded-[10px] px-2.5 text-sm transition-colors duration-200 ${
          quiet ? "" : "font-medium"
        } ${
          active
            ? "bg-[var(--panel-2)] text-[var(--paper)]"
            : "text-[var(--muted)] hover:bg-[var(--panel)] hover:text-[var(--paper)]"
        }`}
      >
        {Icon ? (
          <Icon size={18} strokeWidth={1.7} className={active ? "text-[var(--jade)]" : undefined} />
        ) : (
          <span className="w-[18px]" aria-hidden />
        )}
        <span className="flex-1">{label}</span>
        {badge && <Badge count={counts[badge] ?? 0} />}
      </Link>
    );
  }

  return (
    /*
      One column, read top to bottom: where you are (brand), how to get anywhere
      (search), what you have (net worth), the six habits, then the three
      occasional places, and at the foot whether the data can be trusted. The
      per-account list that used to be pinned here lives on Accounts — the
      headline is the figure you open the app for; the parts are one click away.
    */
    <aside className="sticky top-0 hidden h-dvh w-[232px] shrink-0 flex-col gap-[18px] overflow-y-auto border-r border-line px-3.5 py-5 md:flex">
      <Link
        href="/overview"
        className="flex min-h-11 items-center gap-2.5 px-2.5 transition-opacity hover:opacity-90"
      >
        <BrandMark size={26} />
        <span className="font-display text-[21px] tracking-tight">budgetr</span>
      </Link>

      <PaletteTrigger />

      {visible.length > 0 && (
        <Link href="/accounts" className="block rounded-[10px] py-1 transition-opacity hover:opacity-90">
          <LedgerHeadline ledger={ledger} />
        </Link>
      )}

      <nav aria-label="Primary" className="flex flex-col gap-0.5">
        {primaryNav.map((item) => row(item))}
      </nav>

      <nav aria-label="Ledger and settings" className="flex flex-col gap-0.5 border-t border-line pt-3">
        {secondary.map((item) => row(item, true))}
      </nav>

      {tradingDesk && (
        <nav aria-label="Trading desk" className="flex flex-col gap-0.5 border-t border-line pt-3">
          <p className="eyebrow mb-1 px-2.5">{deskGroup.label}</p>
          {deskGroup.items.map((item) => row(item, true))}
        </nav>
      )}

      <p
        className="mt-auto flex items-start gap-2 border-t border-line px-2.5 pt-3 text-xs leading-snug text-[var(--muted)]"
        title="budgetr keeps every figure in a local database. Nothing is uploaded."
      >
        <span
          aria-hidden
          className={`mt-[5px] h-[7px] w-[7px] shrink-0 rounded-full ${STATUS_DOT[status?.tone ?? "ok"]}`}
        />
        <span>{status?.label ?? (webDemo ? "Read-only demo" : "Stays on this machine")}</span>
      </p>
    </aside>
  );
}

export function MobileNav({
  accounts = [],
  reviewCount = 0,
  webDemo = false,
  tradingDesk = false,
}: {
  accounts?: SidebarAccount[];
  reviewCount?: number;
  webDemo?: boolean;
  tradingDesk?: boolean;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  // Header label + drawer highlight both key off the single most-specific match,
  // so the analysis page reads "Analysis" rather than its "/investments" parent.
  const activeHref = bestMatchHref(pathname, nav);
  const current = nav.find(({ href }) => href === activeHref);
  const groupsNav = visibleGroups(tradingDesk);
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
            {primaryNav.map(({ href, label, icon: Icon, badge }) => {
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
                  {badge && <Badge count={counts[badge] ?? 0} />}
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
