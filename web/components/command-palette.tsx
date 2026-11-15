"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, CornerDownLeft, EyeOff, RefreshCw, Search } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { INVESTMENTS_TABS, investmentsTabHref } from "@/components/investments-tab-keys";
import { OBF_COOKIE } from "@/lib/scale";

/**
 * ⌘K. 0.15 folded twenty-one sidebar rows into nine, which is right for the
 * sidebar and wrong for someone who knew exactly where "Bills" lived. The
 * palette is the other half of that trade: every tab and sub-page is one
 * keystroke and a few letters away, without earning a permanent row.
 *
 * Opens on ⌘K / Ctrl+K anywhere, or from any <PaletteTrigger />.
 */

const OPEN_EVENT = "budgetr:open-palette";

export function openPalette() {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

type Item = {
  id: string;
  group: "Go to" | "Trading desk" | "Actions" | "Search";
  label: string;
  /** Extra words that should match but aren't shown. */
  keywords?: string;
  hint?: string;
  icon?: React.ReactNode;
} & ({ href: string } | { run: () => void | Promise<void> });

const ONE_YEAR = 60 * 60 * 24 * 365;

function destinations(tradingDesk: boolean, webDemo: boolean): Item[] {
  const go = (label: string, href: string, keywords?: string): Item => ({
    id: href,
    group: "Go to",
    label,
    href,
    keywords,
  });
  const desk = (label: string, href: string, keywords?: string): Item => ({
    id: href,
    group: "Trading desk",
    label,
    href,
    keywords,
  });

  return [
    go("Home", "/overview", "overview dashboard net worth"),
    go("Transactions", "/transactions", "ledger activity"),
    go("Transactions · Review queue", "/transactions?view=review", "inbox unreviewed matches"),
    go("Spending", "/spending", "categories vendors insights report"),
    go("Budgets", "/budgets", "envelopes goals pace"),
    go("Plan · This month", "/plan", "forecast cashflow"),
    go("Plan · Bills & income", "/plan?tab=bills", "recurring subscriptions upcoming"),
    go("Plan · Long run", "/plan?tab=long-run", "fire retirement projection"),
    ...INVESTMENTS_TABS.map((t) =>
      go(`Investments · ${t.label}`, investmentsTabHref(t.key), "portfolio positions dividends realized"),
    ),
    go("Investments · Import trades", "/investments/import", "csv history"),
    go("Accounts", "/accounts", "connections banks wallets plaid"),
    go("Shared", "/shared", "split bills people owed"),
    ...(webDemo ? [] : [go("Settings", "/settings", "theme currency api keys license companion")]),
    ...(tradingDesk
      ? [
          desk("Markets", "/markets", "watchlist quotes"),
          desk("Options · Positions", "/investments/options", "legs greeks"),
          desk("Options · Wheel", "/investments/options/wheel", "premium puts calls"),
          desk("Options · Chain", "/investments/options/chain", "strategy leaps volatility iv"),
          desk("Fundamentals", "/fundamentals", "income statement earnings"),
        ]
      : []),
  ];
}

const matches = (item: Item, q: string) =>
  q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => `${item.label} ${item.keywords ?? ""}`.toLowerCase().includes(word));

export function CommandPalette({
  tradingDesk = false,
  webDemo = false,
}: {
  tradingDesk?: boolean;
  webDemo?: boolean;
}) {
  const router = useRouter();
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);

  useEffect(() => {
    function show() {
      setQuery("");
      setCursor(0);
      setOpen(true);
    }
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((was) => {
          if (!was) {
            setQuery("");
            setCursor(0);
          }
          return !was;
        });
      }
    }
    window.addEventListener(OPEN_EVENT, show);
    document.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener(OPEN_EVENT, show);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  const all = useMemo<Item[]>(() => {
    const actions: Item[] = [
      ...(webDemo
        ? []
        : [
            {
              id: "action:sync",
              group: "Actions" as const,
              label: "Sync accounts now",
              keywords: "refresh plaid update",
              icon: <RefreshCw size={15} />,
              run: async () => {
                await fetch("/api/plaid/sync", { method: "POST" });
                router.refresh();
              },
            },
          ]),
      {
        id: "action:privacy",
        group: "Actions" as const,
        label: "Toggle privacy mode",
        keywords: "hide show dollar values obfuscate",
        icon: <EyeOff size={15} />,
        run: () => {
          const hidden = document.cookie.split("; ").includes(`${OBF_COOKIE}=1`);
          document.cookie = `${OBF_COOKIE}=${hidden ? "0" : "1"}; path=/; max-age=${ONE_YEAR}; samesite=lax`;
          // A full reload, not router.refresh(): the header toggle keeps its own
          // state, and this is the one way both stay truthful.
          window.location.reload();
        },
      },
    ];
    return [...destinations(tradingDesk, webDemo), ...actions];
  }, [router, tradingDesk, webDemo]);

  const q = query.trim();
  const results = useMemo<Item[]>(() => {
    const hits = q ? all.filter((i) => matches(i, q)) : all;
    if (!q) return hits;
    return [
      ...hits,
      {
        id: "search:transactions",
        group: "Search",
        label: `Search transactions for “${q}”`,
        icon: <Search size={15} />,
        href: `/transactions?q=${encodeURIComponent(q)}`,
      },
    ];
  }, [all, q]);

  if (!open) return null;

  const active = Math.min(cursor, Math.max(0, results.length - 1));

  function choose(item: Item | undefined) {
    if (!item) return;
    setOpen(false);
    if ("href" in item) router.push(item.href);
    else void item.run();
  }

  function onInputKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor(results.length ? (active + 1) % results.length : 0);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor(results.length ? (active - 1 + results.length) % results.length : 0);
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(results[active]);
    }
  }

  return (
    <Dialog onClose={() => setOpen(false)} label="Search or jump to" size="xl" align="top">
      <div className="flex items-center gap-3 border-b border-line px-4">
        <Search size={17} className="shrink-0 text-[var(--muted)]" aria-hidden />
        <input
          autoFocus
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setCursor(0);
          }}
          onKeyDown={onInputKey}
          placeholder="Search or jump to…"
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={results[active] ? `${listId}-${active}` : undefined}
          aria-label="Search or jump to"
          autoComplete="off"
          spellCheck={false}
          className="h-13 min-w-0 flex-1 !bg-transparent py-4 text-base outline-none"
        />
        <kbd className="mono shrink-0 rounded-md border border-line px-1.5 py-0.5 text-[11px] text-[var(--muted)]">
          esc
        </kbd>
      </div>

      <ul id={listId} role="listbox" aria-label="Results" className="max-h-[52vh] overflow-y-auto py-2">
        {results.map((item, i) => {
          const heading = i === 0 || results[i - 1].group !== item.group;
          const on = i === active;
          return (
            <li key={item.id} role="presentation">
              {heading && <p className="eyebrow px-4 pb-1 pt-3">{item.group}</p>}
              <div
                id={`${listId}-${i}`}
                role="option"
                aria-selected={on}
                onMouseMove={() => setCursor(i)}
                onClick={() => choose(item)}
                className={`mx-2 flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-3 text-sm ${
                  on ? "bg-[var(--panel-2)] text-[var(--paper)]" : "text-[var(--muted)]"
                }`}
              >
                <span className="grid w-4 shrink-0 place-items-center text-[var(--muted)]">
                  {item.icon ?? <ArrowRight size={14} />}
                </span>
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                {on && <CornerDownLeft size={14} className="shrink-0 text-[var(--muted)]" aria-hidden />}
              </div>
            </li>
          );
        })}
        {results.length === 0 && (
          <li className="px-4 py-8 text-center text-sm text-[var(--muted)]">Nothing matches.</li>
        )}
      </ul>
    </Dialog>
  );
}

/** The sidebar's search field — a button that opens the palette. */
export function PaletteTrigger({ className = "" }: { className?: string }) {
  return (
    <button
      type="button"
      onClick={openPalette}
      className={`flex w-full items-center gap-2.5 rounded-lg border border-line bg-[var(--panel)] px-3 py-2 text-left text-[13px] text-[var(--muted)] transition-colors hover:border-[var(--line-strong)] hover:text-[var(--paper)] ${className}`}
    >
      <Search size={15} aria-hidden />
      <span className="flex-1">Search or jump to…</span>
      <kbd className="mono rounded-md border border-line px-1.5 py-0.5 text-[10px]">⌘K</kbd>
    </button>
  );
}
