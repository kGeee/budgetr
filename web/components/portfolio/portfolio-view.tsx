"use client";

import { createContext, Fragment, useContext, useEffect, useId, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowUpRight, Check, ChevronDown, Pencil, SlidersHorizontal, Tag } from "lucide-react";
import { Dialog, DialogBody, DialogHeader } from "@/components/ui/dialog";
import { Hero, Mark, SectionHead, Stat, StatStrip, Verdict } from "@/components/ui/statement";
import { Bar, HeroLine, pill, ruled, RuledFooter, Segmented, SideFigure } from "@/components/portfolio/ruled";
import { PayoffDiagram } from "@/components/options/payoff-diagram";
import { Sparkline, TickerPriceChart } from "@/components/charts";
import { ValueHistory } from "@/components/portfolio/value-history";
import {
  AddManualHoldingButton,
  DeleteManualHoldingButton,
  EditCostBasisButton,
  EditManualHoldingButton,
  HideWalletTokenButton,
} from "@/components/portfolio/manual-holding-dialog";
import { setHoldingSector } from "@/lib/actions";
import { formatCurrency, formatMoney } from "@/lib/utils";
import {
  classifyOptionLegs,
  daysToExpiry,
  expiryBucket,
  formatOptionExpiry,
  formatStrike,
  optionRiskFlag,
  parseOccSymbol,
  riskLevel,
} from "@/lib/options";
import type { InvestmentTxnRow } from "@/lib/queries";
import type { PricePoint as YahooPricePoint } from "@/lib/yahoo";
import type { BenchmarkKey, ComparisonRow } from "@/lib/benchmark";
import { classifyHolding, isCashLike, KIND_LABEL, KIND_ORDER, type HoldingKind } from "@/lib/portfolio/classify";
import { computeStanding, standingHeadline, WINDOW_LABEL } from "@/lib/portfolio/standing";
import {
  effectiveValue,
  liveSymbols,
  sectorColorMap,
  effectivePrice,
  type HoldingRow,
} from "@/components/portfolio/valuation";
import {
  LivePricesProvider,
  useLivePrices,
  type LiveStatus,
  type LiveQuote,
} from "@/components/portfolio/live-prices";

export type { HoldingRow };

/**
 * Whether the Trading desk (Markets, Options, Fundamentals) is switched on.
 * Rows deep in the table link into the desk, so the flag rides a context
 * rather than being threaded through every row renderer.
 */
const TradingDeskContext = createContext(false);

type PricePoint = { date: string; close: number };

/**
 * The Holdings tab of /investments: headline value, the value curve against the
 * benchmarks, and the holdings themselves. Allocation and income have their own
 * tabs (and their own data), so this no longer carries either.
 */
export function PortfolioView({
  holdings,
  histories = {},
  portfolioSeries = [],
  portfolioReturnSeries = [],
  benchmarks = {},
  comparison = [],
  transactions = [],
  knownSectors = [],
  tradingDesk = false,
}: {
  holdings: HoldingRow[];
  histories?: Record<string, PricePoint[]>;
  portfolioSeries?: { date: string; value: number }[];
  /**
   * Time-weighted return index (base 100) driving the benchmark overlay's
   * portfolio line — deposits/withdrawals removed so it compares fairly to
   * SPY/QQQ. The standalone value line still uses `portfolioSeries`.
   */
  portfolioReturnSeries?: { date: string; value: number }[];
  /** SPY/QQQ daily closes for the value-chart overlay. */
  benchmarks?: Partial<Record<BenchmarkKey, YahooPricePoint[]>>;
  /** Per-window portfolio-vs-benchmark return comparison. */
  comparison?: ComparisonRow[];
  transactions?: InvestmentTxnRow[];
  knownSectors?: string[];
  /** Trading desk on: rows get Chain/Vol/Fundamentals links and options get a summary card. */
  tradingDesk?: boolean;
}) {
  const symbols = useMemo(() => liveSymbols(holdings), [holdings]);

  return (
    <TradingDeskContext.Provider value={tradingDesk}>
      <LivePricesProvider symbols={symbols}>
        <PortfolioInner
          holdings={holdings}
          histories={histories}
          portfolioSeries={portfolioSeries}
          portfolioReturnSeries={portfolioReturnSeries}
          benchmarks={benchmarks}
          comparison={comparison}
          transactions={transactions}
          knownSectors={knownSectors}
        />
      </LivePricesProvider>
    </TradingDeskContext.Provider>
  );
}

/** Day-change % from the live quote's previous close, or null if unavailable. */
function dayChangePct(h: HoldingRow, quotes: Record<string, LiveQuote>): number | null {
  const q = h.ticker ? quotes[h.ticker.toUpperCase()] : undefined;
  if (q?.price != null && q.prevClose != null && q.prevClose !== 0) {
    return ((q.price - q.prevClose) / q.prevClose) * 100;
  }
  return null;
}

/**
 * Listed options exist only for individual equities and ETFs — never for cash,
 * crypto, mutual/fixed-income funds, or an option position itself. Gates the
 * "Options" desk chip so it stops appearing on rows like USD cash or SOL-USD.
 */
function isOptionable(h: HoldingRow): boolean {
  if (!h.ticker || parseOccSymbol(h.ticker)) return false;
  return h.securityType === "equity" || h.securityType === "etf";
}

/**
 * Plaid security names arrive as "Issuer - Product". A few issuers repeat the
 * same words on both sides (e.g. "SPDR S&P 500 ETF TRUST - SPDR S&P 500 ETF
 * Trust"); collapse only those to the single name. Names whose halves genuinely
 * differ ("Vanguard Index Funds - Vanguard S&P 500 ETF") are left untouched.
 */
function cleanSecurityName(name: string | null | undefined): string | null {
  if (!name) return name ?? null;
  const parts = name.split(" - ");
  if (parts.length === 2) {
    const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
    if (norm(parts[0]) === norm(parts[1])) return parts[1].trim();
  }
  return name;
}

/** Unrealized P&L = current value − total cost basis, or null with no basis. */
function effectivePnl(h: HoldingRow, quotes: Record<string, LiveQuote>): number | null {
  if (h.costBasis == null) return null;
  return effectiveValue(h, quotes) - h.costBasis;
}

/** Day-change in currency terms: qty × (price − prevClose), or null with no quote. */
function dayChangeValue(h: HoldingRow, quotes: Record<string, LiveQuote>): number | null {
  const q = h.ticker ? quotes[h.ticker.toUpperCase()] : undefined;
  if (q?.price != null && q.prevClose != null && h.quantity != null) {
    return (q.price - q.prevClose) * h.quantity;
  }
  return null;
}

/**
 * Display-ready numbers for one table row, normalized so a single-holding row and
 * a grouped option underlying render through the same cell renderer. Columns that
 * don't apply to a row (e.g. a live price for an option group) are `null` and show
 * an em dash.
 */
type RowMetrics = {
  account: string | null;
  qty: number | null;
  price: number | null;
  /** Day change, percent. */
  day: number | null;
  /** Day change, currency. */
  dayValue: number | null;
  /** Total cost basis (dollars). */
  costBasis: number | null;
  /** Cost basis per unit. */
  avgCost: number | null;
  value: number;
  /** Share of the whole portfolio, percent. */
  weight: number;
  pnl: number | null;
  pnlPct: number | null;
  currency: string;
};

function holdingMetrics(
  h: HoldingRow,
  quotes: Record<string, LiveQuote>,
  total: number,
): RowMetrics {
  const price = effectivePrice(h, quotes);
  const value = effectiveValue(h, quotes);
  const pnl = effectivePnl(h, quotes);
  const costBasis = h.costBasis ?? null;
  return {
    account: h.accountName,
    qty: h.quantity,
    price,
    day: dayChangePct(h, quotes),
    dayValue: dayChangeValue(h, quotes),
    costBasis,
    avgCost: costBasis != null && h.quantity ? costBasis / h.quantity : null,
    value,
    weight: total ? (value / total) * 100 : 0,
    pnl,
    pnlPct: pnl != null && costBasis ? (pnl / costBasis) * 100 : null,
    currency: h.currency ?? "USD",
  };
}

function optionMetrics(
  legs: HoldingRow[],
  quotes: Record<string, LiveQuote>,
  total: number,
): RowMetrics {
  const value = legs.reduce((s, h) => s + effectiveValue(h, quotes), 0);
  const costed = legs.filter((h) => h.costBasis != null);
  const costBasis = costed.length
    ? costed.reduce((s, h) => s + (h.costBasis ?? 0), 0)
    : null;
  const pnl = costed.length
    ? costed.reduce((s, h) => s + (effectiveValue(h, quotes) - (h.costBasis ?? 0)), 0)
    : null;
  const accounts = Array.from(new Set(legs.map((h) => h.accountName).filter(Boolean)));
  return {
    account: accounts.length === 1 ? (accounts[0] as string) : "Multiple",
    qty: legs.reduce((s, h) => s + Math.abs(h.quantity ?? 0), 0),
    price: null,
    day: null,
    dayValue: null,
    costBasis,
    avgCost: null,
    value,
    weight: total ? (value / total) * 100 : 0,
    pnl,
    pnlPct: pnl != null && costBasis ? (pnl / costBasis) * 100 : null,
    currency: legs[0]?.currency ?? "USD",
  };
}

/**
 * Positions below this share of the portfolio fold into one line. On the account
 * this was written against, 16 of 36 holdings sat under 1% each — half the table
 * for 4.5% of the money.
 */
const TAIL_WEIGHT_PCT = 1;

/**
 * Sort on magnitude, not signed value.
 *
 * An option structure whose short leg dominates carries a negative market value
 * (the MU bull put spread nets −$1,538). Sorted signed, it lands below a $2.27
 * dust position — the largest thing on the screen by exposure, filed last.
 */
function metricForSort(it: RowItem, key: Exclude<SortKey, "name">): number {
  const v = it.m[key];
  if (v == null) return Number.NEGATIVE_INFINITY;
  return key === "value" || key === "weight" ? Math.abs(v) : v;
}

/**
 * Collapse a brokerage's currency balances into one row per symbol.
 *
 * Three separate `CUR:USD` lines — one per account, $17.5k between them — read
 * as three positions you chose. They're one balance shown three ways, and the
 * per-account detail is on the Accounts page where it belongs.
 */
function mergeCashRows(rows: HoldingRow[], quotes: Record<string, LiveQuote>): HoldingRow[] {
  const cash = rows.filter(isCashLike);
  if (cash.length < 2) return rows;

  const bySymbol = new Map<string, HoldingRow[]>();
  for (const h of cash) {
    const key = (h.ticker ?? "cash").toUpperCase();
    const arr = bySymbol.get(key);
    if (arr) arr.push(h);
    else bySymbol.set(key, [h]);
  }

  const merged: HoldingRow[] = [];
  for (const [, group] of bySymbol) {
    if (group.length === 1) {
      merged.push(group[0]);
      continue;
    }
    const value = group.reduce((a, h) => a + effectiveValue(h, quotes), 0);
    const accounts = new Set(group.map((h) => h.accountName).filter(Boolean));
    merged.push({
      ...group[0],
      id: `cash:${(group[0].ticker ?? "cash").toUpperCase()}`,
      quantity: group.reduce((a, h) => a + (h.quantity ?? 0), 0),
      // Value is carried directly so the merged row never re-multiplies a
      // per-unit price against a summed quantity.
      value,
      price: null,
      closePrice: null,
      costBasis: null,
      accountName: `${accounts.size} accounts`,
      securityName: group[0].securityName,
    });
  }

  return [...rows.filter((h) => !isCashLike(h)), ...merged];
}

/** Sortable metric keys (Security sorts by `name`, handled separately). */
type SortKey =
  | "name"
  | "qty"
  | "price"
  | "day"
  | "dayValue"
  | "costBasis"
  | "avgCost"
  | "value"
  | "weight"
  | "pnl";

/** Every toggleable metric column, in display order. Security is always shown. */
type ColumnKey =
  | "account"
  | "trend"
  | "qty"
  | "price"
  | "day"
  | "dayValue"
  | "costBasis"
  | "avgCost"
  | "value"
  | "weight"
  | "pnl";

type ColumnDef = {
  key: ColumnKey;
  label: string;
  align: "left" | "right";
  /** Sortable columns share their key with SortKey. */
  sortable: boolean;
  /** Shown until the user hides it via the Columns menu. */
  defaultVisible: boolean;
};

const COLUMNS: ColumnDef[] = [
  { key: "account", label: "Account", align: "left", sortable: false, defaultVisible: true },
  // Trend is off by default: at this row height the sparkline is four glyphs
  // wide and reads as texture, while it costs a column that Day — the figure
  // people actually scan for — was competing with.
  { key: "trend", label: "Trend", align: "left", sortable: false, defaultVisible: false },
  { key: "qty", label: "Qty", align: "right", sortable: true, defaultVisible: true },
  { key: "price", label: "Price", align: "right", sortable: true, defaultVisible: true },
  { key: "day", label: "Day", align: "right", sortable: true, defaultVisible: true },
  { key: "dayValue", label: "Day $", align: "right", sortable: true, defaultVisible: false },
  { key: "costBasis", label: "Cost basis", align: "right", sortable: true, defaultVisible: false },
  { key: "avgCost", label: "Avg cost", align: "right", sortable: true, defaultVisible: false },
  { key: "value", label: "Value", align: "right", sortable: true, defaultVisible: true },
  { key: "weight", label: "% of total", align: "right", sortable: true, defaultVisible: true },
  { key: "pnl", label: "P&L", align: "right", sortable: true, defaultVisible: true },
];

// v2: Trend dropped from the defaults. Bumping the key re-seeds saved layouts
// once rather than leaving every existing user on the old column set forever.
const COLS_STORAGE_KEY = "budgetr.holdings.columns.v2";

function defaultVisibleColumns(): ColumnKey[] {
  return COLUMNS.filter((c) => c.defaultVisible).map((c) => c.key);
}

/**
 * Per-user column visibility, persisted to localStorage. Initial render uses the
 * defaults (so SSR and first paint match); the saved set is applied after mount.
 */
function useColumnPrefs() {
  const [visible, setVisible] = useState<ColumnKey[]>(defaultVisibleColumns);
  const loaded = useRef(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(COLS_STORAGE_KEY);
      if (raw) {
        const valid = new Set(COLUMNS.map((c) => c.key));
        const saved = (JSON.parse(raw) as ColumnKey[]).filter((k) => valid.has(k));
        // Deferred to an effect on purpose: SSR/first paint use the defaults so
        // hydration matches, then the saved set is applied once on the client.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setVisible(saved);
      }
    } catch {
      /* corrupt or unavailable storage — keep defaults */
    }
    loaded.current = true;
  }, []);

  useEffect(() => {
    if (!loaded.current) return;
    try {
      localStorage.setItem(COLS_STORAGE_KEY, JSON.stringify(visible));
    } catch {
      /* ignore */
    }
  }, [visible]);

  const toggle = (key: ColumnKey) =>
    setVisible((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    );
  const reset = () => setVisible(defaultVisibleColumns());

  return { visible, toggle, reset };
}

/** A row in the holdings table: a single holding, or a grouped option underlying. */
type HoldingsView = "sheet" | "table";

const VIEW_STORAGE_KEY = "budgetr.holdings.view.v1";

/**
 * Sheet or table. The sheet is the default — it answers "what do I own, in what
 * proportion" without being read end to end — but the table's eleven columns are
 * the right tool for reconciling against a brokerage statement, so it stays one
 * click away and remembers which you prefer.
 */
function useHoldingsView(): [HoldingsView, (v: HoldingsView) => void] {
  const [view, setView] = useState<HoldingsView>("sheet");
  const loaded = useRef(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(VIEW_STORAGE_KEY);
      if (saved === "sheet" || saved === "table") {
        // Deferred to an effect: SSR and first paint use the default so
        // hydration matches, then the saved choice is applied once.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setView(saved);
      }
    } catch {
      /* corrupt or unavailable storage — keep the default */
    }
    loaded.current = true;
  }, []);

  useEffect(() => {
    if (!loaded.current) return;
    try {
      localStorage.setItem(VIEW_STORAGE_KEY, view);
    } catch {
      /* ignore */
    }
  }, [view]);

  return [view, setView];
}

type RowItem =
  | { kind: "holding"; h: HoldingRow; name: string; m: RowMetrics }
  | { kind: "options"; underlying: string; legs: HoldingRow[]; name: string; m: RowMetrics };

function PortfolioInner({
  holdings,
  histories,
  portfolioSeries,
  portfolioReturnSeries,
  benchmarks,
  comparison,
  transactions,
  knownSectors,
}: {
  holdings: HoldingRow[];
  histories: Record<string, PricePoint[]>;
  portfolioSeries: { date: string; value: number }[];
  portfolioReturnSeries: { date: string; value: number }[];
  benchmarks: Partial<Record<BenchmarkKey, YahooPricePoint[]>>;
  comparison: ComparisonRow[];
  transactions: InvestmentTxnRow[];
  knownSectors: string[];
}) {
  const { quotes, status } = useLivePrices();
  const tradingDesk = useContext(TradingDeskContext);
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [sortKey, setSortKey] = useState<SortKey>("value");
  const [sortDir, setSortDir] = useState<"desc" | "asc">("desc");
  const [showBreakdown, setShowBreakdown] = useState(false);
  // Optimistic sector edits, keyed by sectorKey so a change to one ticker's
  // sector lights up every position of that ticker instantly (the server action
  // persists in the background and a refresh reconciles).
  const [sectorEdits, setSectorEdits] = useState<Record<string, string | null>>({});
  /** Un-folds the sub-1% tail. Off by default; the money is never hidden, only the rows. */
  const [showAll, setShowAll] = useState(false);
  const { visible: visibleCols, toggle: toggleColumn, reset: resetColumns } = useColumnPrefs();
  const [view, setView] = useHoldingsView();
  const orderedCols = useMemo(
    () => COLUMNS.filter((c) => visibleCols.includes(c.key)),
    [visibleCols],
  );

  const sectorOf = (h: HoldingRow): string | null =>
    h.sectorKey in sectorEdits ? sectorEdits[h.sectorKey] : h.sector ?? null;

  function setSector(sectorKey: string, sector: string | null) {
    setSectorEdits((prev) => ({ ...prev, [sectorKey]: sector }));
    startTransition(async () => {
      await setHoldingSector(sectorKey, sector ?? "");
      router.refresh();
    });
  }

  const sectorColor = useMemo(
    () => sectorColorMap(holdings.map(sectorOf)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [holdings, sectorEdits],
  );

  // Suggestions for the sector editor: known sectors from the DB plus any added
  // optimistically this session, deduped.
  const sectorOptions = useMemo(
    () =>
      Array.from(
        new Set([
          ...knownSectors,
          ...holdings.map(sectorOf).filter((s): s is string => Boolean(s)),
        ]),
      ).sort(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [knownSectors, holdings, sectorEdits],
  );

  // Group investment transactions by ticker for each holding's expanded panel.
  const txnsByTicker = useMemo(() => {
    const map: Record<string, InvestmentTxnRow[]> = {};
    for (const t of transactions) {
      if (!t.ticker) continue;
      const sym = t.ticker.toUpperCase();
      (map[sym] ??= []).push(t);
    }
    return map;
  }, [transactions]);

  // Whole-portfolio market value — the denominator for each row's "% of total".
  const total = useMemo(
    () => holdings.reduce((s, h) => s + effectiveValue(h, quotes), 0),
    [holdings, quotes],
  );

  // Every option (OCC) leg across all holdings — drives the analytics panel.
  const optionLegs = useMemo(
    () => holdings.filter((h) => parseOccSymbol(h.ticker) != null),
    [holdings],
  );

  // Build the render list: regular holdings stay as single rows; option legs are
  // folded into one collapsible group per underlying. Both carry the same
  // normalized metrics and are sorted together by the chosen column, with rows
  // missing that metric sinking to the bottom in both directions.
  const items = useMemo(() => {
    const singles = mergeCashRows(holdings.filter((h) => !parseOccSymbol(h.ticker)), quotes);
    const optionLegs = holdings.filter((h) => parseOccSymbol(h.ticker) != null);

    const byUnderlying = new Map<string, HoldingRow[]>();
    for (const h of optionLegs) {
      const u = parseOccSymbol(h.ticker)!.underlying;
      const arr = byUnderlying.get(u);
      if (arr) arr.push(h);
      else byUnderlying.set(u, [h]);
    }

    const result: RowItem[] = [
      ...singles.map((h) => ({
        kind: "holding" as const,
        h,
        name: (h.ticker ?? h.securityName ?? "").toUpperCase(),
        m: holdingMetrics(h, quotes, total),
      })),
      ...[...byUnderlying.entries()].map(([underlying, legs]) => ({
        kind: "options" as const,
        underlying,
        legs,
        name: underlying.toUpperCase(),
        m: optionMetrics(legs, quotes, total),
      })),
    ];

    const dir = sortDir === "desc" ? -1 : 1;
    return result.sort((a, b) => {
      if (sortKey === "name") {
        return a.name.localeCompare(b.name) * (sortDir === "asc" ? 1 : -1);
      }
      // A short-dominant spread has negative value. Ranking it against long
      // positions files a −$1,538 liability below $2.27 of dust, so rows sort on
      // magnitude and the sign is carried by the row's own liability label.
      const av = metricForSort(a, sortKey);
      const bv = metricForSort(b, sortKey);
      if (av === bv) return 0;
      if (av === Number.NEGATIVE_INFINITY) return 1;
      if (bv === Number.NEGATIVE_INFINITY) return -1;
      return (av - bv) * dir;
    });
  }, [holdings, quotes, sortKey, sortDir, total]);

  /**
   * The table's real shape: one section per kind of thing, each with its own
   * subtotal, plus a single fold for the long tail of sub-1% positions.
   *
   * Grouping is what makes the columns honest. `Qty · Price · Day · P&L` fits an
   * equity; it does not fit brokerage cash or a two-leg spread, and a flat list
   * forced all three through the same header.
   */
  const groups = useMemo(() => {
    const kindOf = (it: RowItem): HoldingKind =>
      it.kind === "options" ? "option" : classifyHolding(it.h);

    const tail: RowItem[] = [];
    const byKind = new Map<HoldingKind, RowItem[]>();

    for (const it of items) {
      const kind = kindOf(it);
      // Options never fold: a near-worthless leg is exactly the row you need to
      // see, and its small weight is the reason it would have been hidden.
      const foldable = !showAll && kind !== "option" && Math.abs(it.m.weight) < TAIL_WEIGHT_PCT;
      if (foldable) {
        tail.push(it);
        continue;
      }
      const arr = byKind.get(kind);
      if (arr) arr.push(it);
      else byKind.set(kind, [it]);
    }

    const sections = KIND_ORDER.filter((k) => byKind.has(k)).map((kind) => {
      const rows = byKind.get(kind)!;
      return {
        kind,
        label: KIND_LABEL[kind],
        rows,
        value: rows.reduce((a, r) => a + r.m.value, 0),
        weight: rows.reduce((a, r) => a + r.m.weight, 0),
        pnl: rows.some((r) => r.m.pnl != null)
          ? rows.reduce((a, r) => a + (r.m.pnl ?? 0), 0)
          : null,
      };
    });

    return {
      sections,
      tail,
      tailValue: tail.reduce((a, r) => a + r.m.value, 0),
      tailWeight: tail.reduce((a, r) => a + r.m.weight, 0),
    };
  }, [items, showAll]);

  // Bands are measured against the largest position, not against 100% — a book
  // whose biggest holding is 8% would otherwise render as forty identical stubs.
  const maxWeight = useMemo(
    () => items.reduce((mx, it) => Math.max(mx, Math.abs(it.m.weight)), 0),
    [items],
  );

  // The two things a list of forty rows cannot say at a glance: how concentrated
  // the book is, and what actually moved it today.
  const concentration = useMemo(() => {
    const weights = items.map((it) => Math.abs(it.m.weight)).sort((a, b) => b - a);
    const n = Math.min(5, weights.length);
    return {
      n,
      count: weights.length,
      share: weights.slice(0, n).reduce((a, b) => a + b, 0),
    };
  }, [items]);

  const topMover = useMemo(() => {
    let best: { name: string; change: number; currency: string } | null = null;
    for (const it of items) {
      const change = it.m.dayValue;
      if (change == null) continue;
      if (!best || Math.abs(change) > Math.abs(best.change)) {
        best = {
          name:
            it.kind === "holding"
              ? it.h.ticker ?? cleanSecurityName(it.h.securityName) ?? "—"
              : it.underlying,
          change,
          currency: it.m.currency,
        };
      }
    }
    // A sub-dollar "mover" is noise dressed as a finding.
    return best && Math.abs(best.change) >= 1 ? best : null;
  }, [items]);

  function toggleSort(key: SortKey) {
    if (key === sortKey) setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  // Unrealized gain only spans holdings with a known cost basis — otherwise a
  // position's whole value would masquerade as gain. This keeps the headline in
  // lockstep with the sum of the per-row P&L (which is "—" for no-basis rows).
  const costed = holdings.filter((h) => h.costBasis != null);
  const totalCost = costed.reduce((s, h) => s + (h.costBasis ?? 0), 0);
  const costedValue = costed.reduce((s, h) => s + effectiveValue(h, quotes), 0);
  const gain = costedValue - totalCost;
  const gainPct = totalCost !== 0 ? (gain / totalCost) * 100 : 0;
  const uncostedValue = total - costedValue;
  const dayPriced = holdings
    .map((h) => ({ value: effectiveValue(h, quotes), change: dayChangeValue(h, quotes) }))
    .filter((row): row is { value: number; change: number } => row.change != null);
  const dayChange = dayPriced.reduce((sum, row) => sum + row.change, 0);
  const priorDayValue = dayPriced.reduce((sum, row) => sum + row.value - row.change, 0);
  const dayChangePctTotal = priorDayValue !== 0 ? (dayChange / priorDayValue) * 100 : 0;
  const dayCoverage = total !== 0
    ? (dayPriced.reduce((sum, row) => sum + Math.abs(row.value), 0) / Math.abs(total)) * 100
    : 0;

  // How much of the "portfolio" is money rather than an investment. On the
  // account this was built against that's $22.8k across three CUR:USD balances
  // and a sweep fund — a twelfth of the headline, invested in nothing.
  const cashValue = useMemo(
    () => holdings.filter(isCashLike).reduce((s, h) => s + effectiveValue(h, quotes), 0),
    [holdings, quotes],
  );

  const standing = useMemo(() => computeStanding(comparison), [comparison]);

  return (
    <div className="space-y-7">
      <div id="value" className="scroll-mt-28 space-y-6">
        {/* One line: the figure and what it did today on the left, the figures
            that qualify it on the right. Whether the book is *working* — the
            time-weighted return against the index — is the Return figure here
            and the sentence over the benchmark table below. */}
        <HeroLine
          hero={
            <Hero
              eyebrow={`Market value · ${holdings.length} ${holdings.length === 1 ? "position" : "positions"}`}
              figure={formatCurrency(total)}
              verdict={
                /* Never render a computed zero as a measurement. Before quotes
                   land every holding's day change is null, which would sum to a
                   confident "+$0.00" — indistinguishable from a flat market. */
                dayPriced.length === 0 ? (
                  <span className="text-[var(--muted)]">
                    Pricing {holdings.length} {holdings.length === 1 ? "position" : "positions"}…
                  </span>
                ) : (
                  <>
                    {dayChange >= 0 ? "Up" : "Down"}{" "}
                    <Mark tone={dayChange >= 0 ? "jade" : "coral"}>
                      {formatCurrency(Math.abs(dayChange))}
                    </Mark>{" "}
                    today, {Math.abs(dayChangePctTotal).toFixed(2)}%.{" "}
                    <span
                      className="cursor-help text-[var(--muted)]"
                      title={
                        "Day change is computed only from holdings with a live intraday quote " +
                        "(equities/ETFs via Finnhub, crypto via CoinGecko). Cash, options, mutual " +
                        "funds, and untracked symbols are excluded, so this share is below 100%."
                      }
                    >
                      {Math.min(dayCoverage, 100).toFixed(0)}% of value has a live quote.
                    </span>
                  </>
                )
              }
            />
          }
        >
          <SideFigure
            label="Unrealized gain"
            tone={gain >= 0 ? "jade" : "coral"}
            value={`${signedCurrency(gain)} · ${signedPct(gainPct)}`}
            sub={
              <button
                type="button"
                onClick={() => setShowBreakdown(true)}
                className="text-[var(--brass)] underline-offset-2 transition-colors hover:text-[var(--paper)] hover:underline"
              >
                View breakdown →
              </button>
            }
          />
          <SideFigure
            label="Cost basis"
            value={formatCurrency(totalCost)}
            sub={
              uncostedValue > 0.005
                ? `${formatCurrency(uncostedValue)} has no basis`
                : "All positions costed"
            }
          />
          {standing.state === "unknown" ? (
            <SideFigure label="Return" tone="muted" value="—" sub={standing.reason} />
          ) : (
            <SideFigure
              label={`Return · ${standing.windowLabel.toLowerCase()}`}
              tone={standing.state === "behind" ? "coral" : "jade"}
              value={`${standing.returnPct! >= 0 ? "+" : "−"}${Math.abs(standing.returnPct!).toFixed(1)}% time-weighted`}
              sub={standingHeadline(standing)}
            />
          )}
          <SideFigure
            label="Cash"
            value={formatCurrency(cashValue)}
            sub={cashValue > 0.005 ? "of market value" : "all of it invested"}
          />
        </HeroLine>

        {/* The no-basis caveat silently qualifies two headline numbers, so it
            gets said out loud rather than living in fine print. */}
        {uncostedValue > 0.005 && (
          <p className="border-l-2 border-[var(--brass-dim)] pl-3 text-xs text-[var(--brass)]">
            {formatCurrency(uncostedValue)} of value has no cost basis. Unrealized gain and
            yield-on-cost are computed over the remaining {formatCurrency(costedValue)} — not the
            whole portfolio.
          </p>
        )}

        <ValueHistory
          data={portfolioSeries}
          portfolioReturnSeries={portfolioReturnSeries}
          kind="portfolio"
          benchmarks={benchmarks}
          caption="Portfolio value, reconstructed from your trades"
        />
      </div>

      {showBreakdown && (
        <GainBreakdownModal
          holdings={holdings}
          quotes={quotes}
          gain={gain}
          totalCost={totalCost}
          uncostedValue={uncostedValue}
          onClose={() => setShowBreakdown(false)}
        />
      )}

      <section id="holdings" aria-label="Holdings" className="scroll-mt-28 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
          {/* What the rows themselves can't tell you: the shape of the book. */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--muted)]">
            <StatusBadge status={status} />
            {concentration.count > 0 && (
              <p>
                {concentration.count > 6 ? (
                  <>
                    Top {concentration.n} of {concentration.count} positions hold{" "}
                    <span className="mono text-[var(--paper)]">
                      {concentration.share.toFixed(0)}%
                    </span>{" "}
                    of the book.
                  </>
                ) : (
                  <>
                    {concentration.count} {concentration.count === 1 ? "position" : "positions"}.
                  </>
                )}
                {topMover && (
                  <>
                    {" "}
                    <span className="mono text-[var(--paper)]">{topMover.name}</span> moved it most
                    today,{" "}
                    <span className={`mono ${signedColor(topMover.change)}`}>
                      {fmtSigned(topMover.change, topMover.currency)}
                    </span>
                    .
                  </>
                )}
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            {/* Value, weight and today sort from the column heads; the sheet's
                other sorts (P&L, name) have no column, so they stay explicit. */}
            {view === "sheet" && (
              <SheetSort sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
            )}
            <ViewToggle view={view} onChange={setView} />
            {/* Column controls drive the table only; the sheet ignores them. */}
            {view === "table" && (
              <span className="hidden md:inline-flex">
                <ColumnsMenu visible={visibleCols} onToggle={toggleColumn} onReset={resetColumns} />
              </span>
            )}
          </div>
        </div>
        {view === "sheet" ? (
          <HoldingsSheet
            sections={groups.sections}
            tail={groups.tail}
            tailValue={groups.tailValue}
            tailWeight={groups.tailWeight}
            showAll={showAll}
            onShowAll={setShowAll}
            currency={holdings[0]?.currency ?? "USD"}
            count={items.length}
            total={total}
            dayChange={dayPriced.length > 0 ? dayChange : null}
            dayPct={dayPriced.length > 0 ? dayChangePctTotal : null}
            sortKey={sortKey}
            sortDir={sortDir}
            onSort={toggleSort}
            ctx={{
              maxWeight,
              histories,
              txnsByTicker,
              quotes,
              sectorOf,
              sectorOptions,
              setSector,
              sectorColor,
            }}
            empty={
              holdings.length === 0
                ? "No holdings yet. Connect a brokerage account and hit Sync."
                : null
            }
          />
        ) : (
          <>
          <SectionHead title="Holdings" count={items.length} />
          {/* Mobile: a compact card per position (the wide table can't fit a phone). */}
          <ul className="divide-y divide-line/60 md:hidden">
            {items.map((it) =>
              it.kind === "holding" ? (
                <HoldingCardMobile key={it.h.id} h={it.h} m={it.m} />
              ) : (
                <OptionGroupCardMobile key={`optc:${it.underlying}`} underlying={it.underlying} legs={it.legs} m={it.m} />
              ),
            )}
            {holdings.length === 0 && (
              <li className="px-4 py-10 text-center text-sm text-[var(--muted)]">
                No holdings yet. Connect a brokerage account and hit Sync.
              </li>
            )}
          </ul>
          <div className="hidden overflow-x-auto md:block">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-line text-left">
                <th className="w-8" aria-hidden />
                <HeaderCell
                  label="Security"
                  align="left"
                  sortable
                  active={sortKey === "name"}
                  dir={sortDir}
                  onClick={() => toggleSort("name")}
                />
                {orderedCols.map((c) => (
                  <HeaderCell
                    key={c.key}
                    label={c.label}
                    align={c.align}
                    sortable={c.sortable}
                    active={c.sortable && sortKey === c.key}
                    dir={sortDir}
                    onClick={c.sortable ? () => toggleSort(c.key as SortKey) : undefined}
                  />
                ))}
              </tr>
            </thead>
            <tbody>
              {groups.sections.map((section) => (
                <Fragment key={section.kind}>
                  <GroupHeaderRow
                    section={section}
                    span={orderedCols.length + 2}
                    currency={holdings[0]?.currency ?? "USD"}
                  />
                  {section.rows.map((it) =>
                    it.kind === "holding" ? (
                      <HoldingRowView
                        key={it.h.id}
                        h={it.h}
                        m={it.m}
                        columns={orderedCols}
                        history={it.h.ticker ? histories[it.h.ticker.toUpperCase()] : undefined}
                        txns={it.h.ticker ? txnsByTicker[it.h.ticker.toUpperCase()] ?? [] : []}
                        sector={sectorOf(it.h)}
                        sectorOptions={sectorOptions}
                        onSetSector={(name) => setSector(it.h.sectorKey, name)}
                        sectorColor={sectorColor}
                      />
                    ) : (
                      <OptionGroupRow
                        key={`opt:${it.underlying}`}
                        underlying={it.underlying}
                        legs={it.legs}
                        m={it.m}
                        columns={orderedCols}
                        quotes={quotes}
                      />
                    ),
                  )}
                </Fragment>
              ))}

              {/* The long tail, folded. The money is counted in the line — only
                  the rows are hidden, and one click brings them back. */}
              {groups.tail.length > 0 && (
                <tr className="border-b border-line/60 last:border-0">
                  <td colSpan={orderedCols.length + 2} className="px-3 py-2.5">
                    <button
                      onClick={() => setShowAll(true)}
                      className="flex w-full items-center gap-3 text-left text-xs text-[var(--muted)] transition-colors hover:text-[var(--paper)]"
                    >
                      <ChevronDown size={13} className="text-[var(--muted)]" />
                      <span>
                        {groups.tail.length} positions under {TAIL_WEIGHT_PCT}% each
                      </span>
                      <span className="mono ml-auto text-[var(--muted)]">
                        {formatMoney(groups.tailValue, holdings[0]?.currency ?? "USD")} ·{" "}
                        {groups.tailWeight.toFixed(1)}%
                      </span>
                      <span className="text-[var(--brass)]">Show</span>
                    </button>
                  </td>
                </tr>
              )}
              {showAll && (
                <tr className="border-b border-line/60 last:border-0">
                  <td colSpan={orderedCols.length + 2} className="px-3 py-2">
                    <button
                      onClick={() => setShowAll(false)}
                      className="text-xs text-[var(--muted)] transition-colors hover:text-[var(--paper)]"
                    >
                      Fold small positions again
                    </button>
                  </td>
                </tr>
              )}
              {holdings.length === 0 && (
                <tr>
                  <td
                    colSpan={orderedCols.length + 2}
                    className="px-6 py-10 text-center text-[var(--muted)]"
                  >
                    No holdings yet. Connect a brokerage account and hit Sync.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          </div>
          </>
        )}
        <RuledFooter
          className={view === "sheet" ? "border-t-0" : undefined}
          note={view === "sheet" ? "Weight bars are scaled to the largest holding." : null}
        >
          <Link href="/investments/import" className={pill}>
            Import trades
          </Link>
          <AddManualHoldingButton />
        </RuledFooter>
      </section>

      <BenchmarkComparison comparison={comparison} standing={standing} />

      {/* With the desk off the legs are just holdings — they're already in the
          table above, and there's no desk for a summary to point at. */}
      {tradingDesk && optionLegs.length > 0 && (
        <div id="options" className="scroll-mt-28">
          <OptionsSummaryCard legs={optionLegs} quotes={quotes} />
        </div>
      )}
    </div>
  );
}

/**
 * What the Portfolio desk says about options now: the three numbers that matter
 * and a door to the desk that owns the subject.
 *
 * This replaces an entire options desk rendered inline — expiration calendar,
 * per-structure payoff cards, a live Greeks table, and the full CBOE chain for
 * every underlying held. Hundreds of rows and three multi-megabyte chain fetches
 * (MU's is 7.3 MB, over Next's data-cache ceiling, so it was re-fetched on every
 * single render) sat below the fold on a page most visits never scroll to the
 * end of — for positions worth 0.1% of the portfolio. All of it already exists,
 * unchanged, at /investments/options.
 */
function OptionsSummaryCard({
  legs,
  quotes,
}: {
  legs: HoldingRow[];
  quotes: Record<string, LiveQuote>;
}) {
  const currency = legs[0]?.currency ?? "USD";
  const value = legs.reduce((a, h) => a + effectiveValue(h, quotes), 0);
  const costed = legs.filter((h) => h.costBasis != null);
  const pnl = costed.length
    ? costed.reduce((a, h) => a + (effectiveValue(h, quotes) - (h.costBasis ?? 0)), 0)
    : null;

  const structures = new Set(
    legs.map((h) => {
      const p = parseOccSymbol(h.ticker)!;
      return `${p.underlying}:${p.expiry}`;
    }),
  );

  const dtes = legs
    .map((h) => daysToExpiry(parseOccSymbol(h.ticker)!.expiry))
    .filter((d) => Number.isFinite(d));
  const soonest = dtes.length ? Math.min(...dtes) : null;
  const expiringSoon = soonest != null ? dtes.filter((d) => d === soonest).length : 0;
  const urgent = soonest != null && soonest <= 7;

  return (
    <section className="space-y-4">
      <SectionHead
        title="Options"
        action={
          <span className="text-xs text-[var(--muted)]">
            {structures.size} {structures.size === 1 ? "structure" : "structures"} · {legs.length}{" "}
            {legs.length === 1 ? "leg" : "legs"}
          </span>
        }
      />

      {urgent && (
        <Verdict>
          <span className="text-[var(--coral)]">
            {expiringSoon} {expiringSoon === 1 ? "leg expires" : "legs expire"} in{" "}
            {soonest === 0 ? "under a day" : `${soonest} ${soonest === 1 ? "day" : "days"}`}.
          </span>{" "}
          <span className="text-[var(--muted)]">Check them before the close.</span>
        </Verdict>
      )}

      <StatStrip className="border-t-0 pt-0">
        <Stat
          label="Net value"
          value={formatMoney(value, currency)}
          sub={
            value < 0 ? (
              <span className="text-[var(--coral)]">net short — a liability</span>
            ) : undefined
          }
        />
        <Stat
          label="Open P&L"
          tone={pnl == null ? "muted" : pnl >= 0 ? "jade" : "coral"}
          value={
            pnl == null ? "—" : `${pnl >= 0 ? "+" : "−"}${formatMoney(Math.abs(pnl), currency)}`
          }
        />
        <Stat
          label="Next expiry"
          tone={urgent ? "coral" : "default"}
          value={soonest == null ? "—" : soonest < 0 ? "expired" : `${soonest}d`}
        />
      </StatStrip>

      <Link href="/investments/options" className={pill}>
        Open the options desk
        <ArrowUpRight size={14} />
      </Link>
    </section>
  );
}

/**
 * A section heading inside the holdings table: what these rows are, how many,
 * and what they add up to.
 *
 * The subtotal is the point. "Funds & ETFs · $90,676 · 49.9%" is a fact about
 * the portfolio that a flat list of 41 rows never states, and it's the one most
 * people are actually scanning for.
 */
function GroupHeaderRow({
  section,
  span,
  currency,
}: {
  section: {
    kind: HoldingKind;
    label: string;
    rows: unknown[];
    value: number;
    weight: number;
    pnl: number | null;
  };
  span: number;
  currency: string;
}) {
  const n = section.rows.length;
  return (
    <tr className="bg-[var(--panel-2)]/60">
      <td colSpan={span} className="px-3 py-2">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="eyebrow">{section.label}</span>
          <span className="text-[11px] text-[var(--muted)]">
            {n} {section.kind === "option" ? (n === 1 ? "structure" : "structures") : n === 1 ? "position" : "positions"}
          </span>
          <span className="mono ml-auto text-xs text-[var(--muted)]">
            {formatMoney(section.value, currency)} · {section.weight.toFixed(1)}%
            {section.pnl != null && (
              <span className={section.pnl >= 0 ? " text-[var(--jade)]" : " text-[var(--coral)]"}>
                {" · "}
                {section.pnl >= 0 ? "+" : "−"}
                {formatMoney(Math.abs(section.pnl), currency)}
              </span>
            )}
            {/* Cash is in the total but it isn't a bet — say so once, here,
                rather than letting it pad the "invested" figure silently. */}
            {section.kind === "cash" && (
              <span className="text-[var(--muted)]"> · not invested</span>
            )}
          </span>
        </div>
      </td>
    </tr>
  );
}

/** A holding row plus, when expanded, its full price-history + trades panel. */
function HoldingRowView({
  h,
  m,
  columns,
  history,
  txns,
  sector,
  sectorOptions,
  onSetSector,
  sectorColor,
}: {
  h: HoldingRow;
  m: RowMetrics;
  columns: ColumnDef[];
  history?: PricePoint[];
  txns: InvestmentTxnRow[];
  sector: string | null;
  sectorOptions: string[];
  onSetSector: (sector: string | null) => void;
  sectorColor: Record<string, string>;
}) {
  const [expanded, setExpanded] = useState(false);
  const currency = m.currency;
  const canExpand = Boolean(h.ticker);

  return (
    <>
      <tr className="group border-b border-line/60 last:border-0 transition-colors hover:bg-[var(--panel-2)]">
        <td className="w-8 pl-2">
          {canExpand && (
            <button
              onClick={() => setExpanded((v) => !v)}
              aria-expanded={expanded}
              aria-label={expanded ? `Collapse ${h.ticker}` : `Expand ${h.ticker}`}
              className="grid h-6 w-6 place-items-center rounded text-[var(--muted)] transition hover:text-[var(--paper)]"
            >
              <ChevronDown
                size={14}
                className={`transition-transform ${expanded ? "rotate-180" : ""}`}
              />
            </button>
          )}
        </td>
        <td className="py-3.5 pr-3 pl-1">
          <div className="flex flex-col gap-1">
            <span className="inline-flex items-center gap-2.5">
              <span className="mono font-semibold tracking-tight text-[var(--brass)]">{h.ticker ?? "—"}</span>
              <span
                className="max-w-[240px] truncate text-[var(--muted)]"
                title={h.securityName ?? undefined}
              >
                {cleanSecurityName(h.securityName)}
              </span>
              {/* Quiet row actions — revealed on hover so 45 rows don't shout. */}
              <HoldingDeskLinks h={h} />
              {h.manual && (
                <span className="rounded border border-line px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-[var(--muted)]">
                  {h.securityType ?? "manual"}
                </span>
              )}
              {h.hasOverride && <AdjustedBadge />}
              <HoldingEditButtons h={h} />
            </span>
            <SectorEditor
              sector={sector}
              options={sectorOptions}
              color={sector ? sectorColor[sector] : undefined}
              onSave={onSetSector}
            />
          </div>
        </td>
        <MetricCells columns={columns} m={m} history={history} />
      </tr>
      {expanded && canExpand && (
        <tr className="border-b border-line/60 bg-[var(--panel-2)]/40">
          <td colSpan={columns.length + 2} className="px-4 py-5 sm:px-6">
            <TickerHistoryPanel
              ticker={h.ticker as string}
              history={history ?? []}
              txns={txns}
              currency={currency}
            />
          </td>
        </tr>
      )}
    </>
  );
}

/**
 * A holding's links into the Trading desk: Chain and Vol for an equity or ETF,
 * Fundamentals for any plain ticker. The table row and the sheet row used to
 * each hand-write these; both render this now. Nothing renders with the desk
 * off — every route it points at is gated behind the setting.
 */
function DeskLinks({
  ticker,
  optionable,
  chainOnly = false,
}: {
  ticker: string | null;
  optionable: boolean;
  /** Option groups: the underlying's chain is the only link that makes sense. */
  chainOnly?: boolean;
}) {
  const desk = useContext(TradingDeskContext);
  if (!desk || !ticker) return null;
  const sym = encodeURIComponent(ticker);
  const links = [
    ...(optionable
      ? [
          { href: `/investments/options/chain?ticker=${sym}`, label: "Chain", title: `Option chain for ${ticker}` },
          ...(chainOnly
            ? []
            : [{ href: `/investments/options/chain?ticker=${sym}&mode=vol`, label: "Vol", title: `Fixed-strike vol for ${ticker}` }]),
        ]
      : []),
    ...(!chainOnly && !parseOccSymbol(ticker)
      ? [{ href: `/fundamentals?ticker=${sym}`, label: "Fundamentals", title: `Fundamentals for ${ticker}` }]
      : []),
  ];
  return (
    <>
      {links.map((l) => (
        <Link
          key={l.label}
          href={l.href}
          title={l.title}
          className="inline-flex items-center gap-0.5 text-[11px] text-[var(--muted)] transition-colors hover:text-[var(--brass)]"
        >
          {l.label}
          <ArrowUpRight size={10} />
        </Link>
      ))}
    </>
  );
}

/** The table row's hover strip; the sheet row folds DeskLinks into its own. */
function HoldingDeskLinks({ h }: { h: HoldingRow }) {
  const desk = useContext(TradingDeskContext);
  if (!desk || !h.ticker) return null;
  return (
    <span className="hidden items-center gap-2.5 opacity-0 transition-opacity duration-150 group-hover:opacity-100 md:inline-flex">
      <DeskLinks ticker={h.ticker} optionable={isOptionable(h)} />
    </span>
  );
}

function AdjustedBadge() {
  return (
    <span
      title="Cost basis manually corrected"
      className="shrink-0 rounded border border-[var(--brass-dim)] px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-[var(--brass)]"
    >
      adj
    </span>
  );
}

/** Edit/remove for a manual holding, or the cost-basis correction for a Plaid one. */
function HoldingEditButtons({ h }: { h: HoldingRow }) {
  const name = h.securityName ?? h.ticker ?? "holding";
  if (!h.manual) {
    return (
      <EditCostBasisButton
        holdingId={h.id}
        name={name}
        quantity={h.quantity}
        plaidCostBasis={h.plaidCostBasis ?? null}
        overrideTotal={h.overrideTotal ?? null}
        overrideUnit={h.overrideUnit ?? null}
        overrideAsOf={h.overrideAsOf ?? null}
        hasOverride={Boolean(h.hasOverride)}
      />
    );
  }
  return (
    <span className="inline-flex items-center">
      <EditManualHoldingButton
        id={h.id}
        name={name}
        isTickered={Boolean(h.ticker)}
        quantity={h.quantity}
        costBasis={h.costBasis}
        value={h.value}
        fromWallet={h.fromWallet}
      />
      {/* A wallet row would be re-created by the next sync, so it's hidden (a
          persisted rule) rather than deleted. */}
      {h.fromWallet ? (
        <HideWalletTokenButton id={h.id} name={name} />
      ) : (
        <DeleteManualHoldingButton id={h.id} name={name} />
      )}
    </span>
  );
}

/** Shared "options →" chip used by the mobile holding cards. */
function OptionsChip({ ticker }: { ticker: string }) {
  if (!useContext(TradingDeskContext)) return null;
  return (
    <Link
      href={`/investments/options/chain?ticker=${encodeURIComponent(ticker)}`}
      title={`Option chain for ${ticker}`}
      className="inline-flex items-center gap-0.5 rounded border border-line px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-[var(--muted)] transition-colors hover:border-[var(--brass-dim)] hover:text-[var(--brass)]"
    >
      options
      <ArrowUpRight size={10} />
    </Link>
  );
}

const signedColor = (n: number | null) =>
  n == null ? "text-[var(--muted)]" : n >= 0 ? "text-[var(--jade)]" : "text-[var(--coral)]";
const fmtPct = (n: number | null) => (n == null ? "—" : `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`);
const fmtSigned = (n: number | null, currency: string) =>
  n == null ? "—" : `${n >= 0 ? "+" : "−"}${formatMoney(Math.abs(n), currency)}`;

/** Metric row shared by the mobile cards: right value, colored day %, and a summary line. */
function MobileCardBody({ m }: { m: RowMetrics }) {
  return (
    <>
      {/* Allocation bar — mirrors the companion app's ranked-positions look. */}
      <div className="mt-2.5 h-[3px] overflow-hidden rounded-full bg-[var(--line)]">
        <span
          className="block h-full rounded-full bg-[var(--brass)]"
          style={{ width: `${Math.max(2, Math.min(100, m.weight))}%` }}
        />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--muted)]">
        {m.qty != null && (
          <span>
            Qty <span className="mono text-[var(--paper)]/80">{m.qty.toLocaleString()}</span>
          </span>
        )}
        <span>
          P&amp;L <span className={`mono ${signedColor(m.pnl)}`}>{fmtSigned(m.pnl, m.currency)}</span>
        </span>
        <span className="mono">{m.weight.toFixed(1)}% of portfolio</span>
      </div>
    </>
  );
}

/** Compact card for one holding — the mobile stand-in for the wide table row. */
function HoldingCardMobile({ h, m }: { h: HoldingRow; m: RowMetrics }) {
  return (
    <li className="px-4 py-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="mono font-semibold tracking-tight text-[var(--brass)]">{h.ticker ?? "—"}</span>
            {isOptionable(h) && <OptionsChip ticker={h.ticker as string} />}
          </div>
          {h.securityName && (
            <p className="mt-0.5 truncate text-xs text-[var(--muted)]">
              {cleanSecurityName(h.securityName)}
            </p>
          )}
        </div>
        <div className="shrink-0 text-right">
          <p className="mono text-[var(--paper)]">{formatMoney(m.value, m.currency)}</p>
          <p className={`mono text-xs ${signedColor(m.day)}`}>{fmtPct(m.day)}</p>
        </div>
      </div>
      <MobileCardBody m={m} />
    </li>
  );
}

/** Compact card for a grouped option position (the mobile stand-in for OptionGroupRow). */
function OptionGroupCardMobile({
  underlying,
  legs,
  m,
}: {
  underlying: string;
  legs: HoldingRow[];
  m: RowMetrics;
}) {
  return (
    <li className="px-4 py-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="mono font-semibold tracking-tight text-[var(--brass)]">{underlying}</span>
            <OptionsChip ticker={underlying} />
          </div>
          <p className="mt-0.5 text-xs text-[var(--muted)]">
            {legs.length} {legs.length === 1 ? "leg" : "legs"}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="mono text-[var(--paper)]">{formatMoney(m.value, m.currency)}</p>
          <p className={`mono text-xs ${signedColor(m.day)}`}>{fmtPct(m.day)}</p>
        </div>
      </div>
      <MobileCardBody m={m} />
    </li>
  );
}

/** Per-ticker price chart (with trade markers) + its investment-transaction log. */
function TickerHistoryPanel({
  ticker,
  history,
  txns,
  currency,
}: {
  ticker: string;
  history: PricePoint[];
  txns: InvestmentTxnRow[];
  currency: string;
}) {
  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-[var(--radius)] border border-line bg-[var(--panel)]">
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <span className="eyebrow">{ticker} · price history · 12 mo</span>
          <span className="flex items-center gap-3 text-xs text-[var(--muted)]">
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-[var(--jade)]" /> Buy
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-[var(--coral)]" /> Sell
            </span>
          </span>
        </div>
        <div className="px-2 py-4 sm:px-4">
          <TickerPriceChart
            data={history}
            trades={txns.map((t) => ({
              date: t.date,
              quantity: t.quantity,
              price: t.price,
              type: t.type,
            }))}
          />
        </div>
      </div>

      {txns.length > 0 ? (
        <div className="overflow-hidden rounded-[var(--radius)] border border-line bg-[var(--panel)]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left">
                {["Date", "Activity", "Qty", "Price", "Amount"].map((h, i) => (
                  <th
                    key={h}
                    className={`px-5 py-2.5 eyebrow font-medium ${i >= 2 ? "text-right" : ""}`}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {txns.map((t) => (
                <tr key={t.id} className="border-b border-line/60 last:border-0">
                  <td className="mono px-5 py-2.5 text-[var(--muted)]">{t.date}</td>
                  <td className="px-5 py-2.5 capitalize">{t.subtype ?? t.type ?? t.name}</td>
                  <td className="mono px-5 py-2.5 text-right text-[var(--muted)]">
                    {t.quantity != null ? t.quantity.toLocaleString() : "—"}
                  </td>
                  <td className="mono px-5 py-2.5 text-right">
                    {t.price != null ? formatMoney(t.price, t.currency ?? currency) : "—"}
                  </td>
                  <td className="mono px-5 py-2.5 text-right">
                    {t.amount != null ? formatMoney(t.amount, t.currency ?? currency) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="px-1 text-sm text-[var(--muted)]">
          No recorded transactions for {ticker} in the last 2 years.
        </p>
      )}
    </div>
  );
}

/** Price cell that briefly flashes green/red when the live price ticks. */
/**
 * One collapsible row consolidating every option contract on a single underlying.
 * The parent shows the aggregate value/P&L and a summary (the structure name when
 * there's just one, e.g. "Bull call spread"); expanding reveals each recognized
 * structure and its individual legs.
 */
function OptionGroupRow({
  underlying,
  legs,
  m,
  columns,
  quotes,
}: {
  underlying: string;
  legs: HoldingRow[];
  m: RowMetrics;
  columns: ColumnDef[];
  quotes: Record<string, LiveQuote>;
}) {
  const [expanded, setExpanded] = useState(false);

  const parsed = legs.map((h) => ({ h, p: parseOccSymbol(h.ticker)! }));
  const structures = classifyOptionLegs(
    parsed.map(({ h, p }) => ({ parsed: p, quantity: h.quantity, costBasis: h.costBasis })),
  );
  const currency = m.currency;

  const underlyingPrice =
    quotes[underlying.toUpperCase()]?.price ?? null;

  // Soonest expiry across this underlying's legs drives the group's DTE chip.
  const soonestDte = Math.min(...parsed.map(({ p }) => daysToExpiry(p.expiry)));
  const groupRisk = riskLevel(soonestDte);
  // Any leg carrying an assignment / expiry-worthless flag surfaces on the row.
  const flags = new Set(
    parsed
      .map(({ h, p }) => optionRiskFlag(p, h.quantity, underlyingPrice, daysToExpiry(p.expiry)))
      .filter((f): f is "assignment" | "expiry" => f != null),
  );

  const summary =
    structures.length === 1
      ? structures[0].label
      : `${structures.length} structures · ${legs.length} legs`;

  return (
    <>
      <tr
        className="group cursor-pointer border-b border-line/60 last:border-0 transition-colors hover:bg-[var(--panel-2)]"
        onClick={() => setExpanded((v) => !v)}
      >
        <td className="w-8 pl-2">
          <span className="grid h-6 w-6 place-items-center rounded text-[var(--muted)] transition group-hover:text-[var(--paper)]">
            <ChevronDown size={14} className={`transition-transform ${expanded ? "rotate-180" : ""}`} />
          </span>
        </td>
        <td className="py-3.5 pr-3 pl-1">
          <span className="inline-flex flex-wrap items-center gap-2.5">
            <span className="mono font-semibold tracking-tight text-[var(--brass)]">{underlying}</span>
            <span className="text-[var(--muted)]">{summary}</span>
            {/* A short-dominant spread is worth negative money: closing it costs
                cash. Calling that "small" — which is what an unlabelled −$1,538
                in a Value column reads as — is the opposite of the truth. */}
            {m.value < -0.005 && (
              <span
                title="Net short: this position is a liability, not an asset"
                className="mono rounded bg-[var(--coral)]/15 px-1.5 py-0.5 text-[10px] text-[var(--coral)]"
              >
                liability
              </span>
            )}
            <span
              onClick={(e) => e.stopPropagation()}
              className="hidden items-center opacity-0 transition-opacity duration-150 group-hover:opacity-100 md:inline-flex"
            >
              <DeskLinks ticker={underlying} optionable chainOnly />
            </span>
            {Number.isFinite(soonestDte) && (
              <span
                className={`mono rounded px-1.5 py-0.5 text-[10px] ${
                  groupRisk === "expired" || groupRisk === "high"
                    ? "bg-[var(--coral)]/15 text-[var(--coral)]"
                    : groupRisk === "medium"
                      ? "bg-[var(--brass)]/15 text-[var(--brass)]"
                      : "text-[var(--muted)]"
                }`}
                title={`${soonestDte} days to soonest expiry`}
              >
                {expiryBucket(soonestDte)}
              </span>
            )}
            {[...flags].map((f) => (
              <span
                key={f}
                className="inline-flex items-center gap-1 rounded bg-[var(--coral)]/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-[var(--coral)]"
              >
                {f === "assignment" ? "Assign risk" : "Worthless risk"}
              </span>
            ))}
          </span>
        </td>
        <MetricCells columns={columns} m={m} />
      </tr>

      {expanded && (
        <tr className="border-b border-line/60 bg-[var(--panel-2)]/40">
          <td colSpan={columns.length + 2} className="px-4 py-4 sm:px-6">
            <OptionStructuresPanel legs={legs} quotes={quotes} currency={currency} />
          </td>
        </tr>
      )}
    </>
  );
}

/**
 * The legs of one underlying, grouped into recognised structures — each with its
 * economics, payoff curve, and per-leg detail. Shared by the table row and the
 * position sheet, which both expand into exactly this.
 */
function OptionStructuresPanel({
  legs,
  quotes,
  currency,
}: {
  legs: HoldingRow[];
  quotes: Record<string, LiveQuote>;
  currency: string;
}) {
  const parsed = legs.map((h) => ({ h, p: parseOccSymbol(h.ticker)! }));
  const structures = classifyOptionLegs(
    parsed.map(({ h, p }) => ({ parsed: p, quantity: h.quantity, costBasis: h.costBasis })),
  );
  const underlyingPrice = quotes[parsed[0]?.p.underlying.toUpperCase() ?? ""]?.price ?? null;

  return (
<div className="space-y-3">
      {structures.map((st, i) => {
        const stLegs = st.legIndexes.map((idx) => parsed[idx]);
        const stValue = stLegs.reduce((s, { h }) => s + effectiveValue(h, quotes), 0);
        const stCosted = stLegs.filter(({ h }) => h.costBasis != null);
        const stPnl = stCosted.length
          ? stCosted.reduce((s, { h }) => s + (effectiveValue(h, quotes) - (h.costBasis ?? 0)), 0)
          : null;
        return (
          <div key={i} className="rounded-lg border border-line/60 bg-[var(--panel)]/40 p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium">{st.label}</p>
                <p className="text-xs text-[var(--muted)]">{st.detail}</p>
              </div>
              <div className="shrink-0 text-right">
                <p className="mono text-sm">{formatMoney(stValue, currency)}</p>
                {stPnl != null && (
                  <p
                    className={`mono text-xs ${stPnl >= 0 ? "text-[var(--jade)]" : "text-[var(--coral)]"}`}
                  >
                    {stPnl >= 0 ? "+" : "−"}
                    {formatMoney(Math.abs(stPnl), currency)}
                  </p>
                )}
              </div>
            </div>
            {/* The options desk's signature payoff curve, right where the
                position lives — economics chips + expiry P&L diagram. */}
            {st.payoffLegs && st.payoffLegs.length > 0 && (
              <div className="mt-3 border-t border-line/60 pt-3">
                <div className="mb-2 flex flex-wrap gap-x-5 gap-y-1 text-xs">
                  <span className="text-[var(--muted)]">
                    Max profit{" "}
                    <span className="mono text-[var(--jade)]">
                      {st.maxProfitUnbounded
                        ? "Unlimited"
                        : st.maxProfit != null
                          ? formatMoney(st.maxProfit, currency)
                          : "—"}
                    </span>
                  </span>
                  <span className="text-[var(--muted)]">
                    Max loss{" "}
                    <span className="mono text-[var(--coral)]">
                      {st.maxLossUnbounded
                        ? "Unlimited"
                        : st.maxLoss != null
                          ? formatMoney(st.maxLoss, currency)
                          : "—"}
                    </span>
                  </span>
                  {(st.breakevens?.length ?? 0) > 0 && (
                    <span className="text-[var(--muted)]">
                      Breakeven{" "}
                      <span className="mono text-[var(--paper)]">
                        {st.breakevens!.map((b) => formatStrike(b)).join(" · ")}
                      </span>
                    </span>
                  )}
                </div>
                <PayoffDiagram
                  legs={st.payoffLegs}
                  currentPrice={underlyingPrice}
                  breakevens={st.breakevens}
                  className="w-full"
                />
              </div>
            )}
            <ul className="mt-2 space-y-1 border-t border-line/60 pt-2">
              {stLegs.map(({ h, p }) => {
                const long = (h.quantity ?? 0) >= 0;
                return (
                  <li key={h.id} className="flex items-center justify-between gap-3 text-xs">
                    <span className="flex min-w-0 items-center gap-2 text-[var(--muted)]">
                      <span
                        className={`mono shrink-0 ${long ? "text-[var(--jade)]" : "text-[var(--coral)]"}`}
                      >
                        {long ? "+" : "−"}
                        {Math.abs(h.quantity ?? 0)}
                      </span>
                      <span className="truncate">
                        {formatStrike(p.strike)} {p.right} · {formatOptionExpiry(p.expiry)}
                      </span>
                    </span>
                    <span className="mono shrink-0 text-[var(--paper)]">
                      {formatMoney(effectiveValue(h, quotes), currency)}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

/* ───────────────────────────────────────────────────────────────────────────
   The position sheet — the default Holdings view.

   A portfolio isn't a list, it's a distribution: the top handful of positions
   are usually most of the money and the rest is dust. The table rendered a
   $184k position and a $2.27 one at identical weight — eleven figures a row,
   every one the same size — so it read as texture and answered "what do I
   own?" only if you were willing to read all of it.

   Here each position is a band whose fill is its share of the book, measured
   against the largest position, so concentration is legible before a single
   figure is. The band is always brass: colour stays reserved for numbers that
   carry a sign, so a red day never makes a position look bigger than it is.
   Three type sizes, total — ticker and value lead, everything else recedes.
   ─────────────────────────────────────────────────────────────────────────── */

type SheetCtx = {
  maxWeight: number;
  histories: Record<string, PricePoint[]>;
  txnsByTicker: Record<string, InvestmentTxnRow[]>;
  quotes: Record<string, LiveQuote>;
  sectorOf: (h: HoldingRow) => string | null;
  sectorOptions: string[];
  setSector: (sectorKey: string, sector: string | null) => void;
  sectorColor: Record<string, string>;
};

/** Fill width for one row's band, as a percent of the widest position. */
function bandWidth(weight: number, maxWeight: number): number {
  if (!Number.isFinite(weight) || maxWeight <= 0) return 0;
  return Math.max(1.5, Math.min(100, (Math.abs(weight) / maxWeight) * 100));
}

/**
 * The sheet's column template. Phones get identity + value; from md up it is the
 * full ruled table — identity, weight bar, weight, value, today $, today %.
 */
const SHEET_GRID =
  "grid grid-cols-[1.25rem_minmax(0,1fr)_auto] items-center gap-x-3 md:grid-cols-[1.25rem_minmax(220px,1.5fr)_minmax(110px,1.3fr)_3.25rem_8.5rem_7rem_4.75rem] md:gap-x-5";

/** One position: identity, a bar scaled to the largest holding, worth, and today. */
function SheetRow({
  bar,
  weight,
  expanded,
  onToggle,
  toggleLabel,
  identity,
  meta,
  m,
  panel,
}: {
  bar: number;
  weight: number;
  expanded: boolean;
  onToggle?: () => void;
  toggleLabel: string;
  identity: React.ReactNode;
  meta: React.ReactNode;
  m: RowMetrics;
  panel?: React.ReactNode;
}) {
  return (
    <li className="border-b border-line">
      <div className={`group min-h-[58px] py-2.5 ${SHEET_GRID}`}>
        <div>
          {onToggle && (
            <button
              onClick={onToggle}
              aria-expanded={expanded}
              aria-label={toggleLabel}
              className="grid h-6 w-6 place-items-center rounded text-[var(--muted)] transition hover:text-[var(--paper)]"
            >
              <ChevronDown
                size={14}
                className={`transition-transform ${expanded ? "rotate-180" : ""}`}
              />
            </button>
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-1">
          {identity}
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-[var(--muted)]">
            {meta}
          </div>
        </div>

        <Bar pct={bar} className="hidden md:block" />
        <span className="mono hidden text-xs text-[var(--muted)] md:block">
          {weight.toFixed(1)}%
        </span>
        <div className="text-right">
          <SheetValue m={m} />
        </div>
        <span className={`mono hidden text-right md:block ${signedColor(m.dayValue)}`}>
          {fmtSigned(m.dayValue, m.currency)}
        </span>
        <span className={`mono hidden text-right md:block ${signedColor(m.day)}`}>
          {fmtPct(m.day)}
        </span>
      </div>

      {expanded && panel}
    </li>
  );
}

/** What a position is worth, and what it has made — the row's terminal figure. */
function SheetValue({ m }: { m: RowMetrics }) {
  return (
    <>
      <p className="mono tabular text-[var(--paper)]">
        {formatMoney(m.value, m.currency)}
      </p>
      {m.pnl != null ? (
        <p className={`mono text-[11px] ${signedColor(m.pnl)}`}>
          {fmtSigned(m.pnl, m.currency)}
          {m.pnlPct != null && (
            <span className="opacity-70"> · {m.pnlPct >= 0 ? "+" : "−"}
              {Math.abs(m.pnlPct).toFixed(1)}%
            </span>
          )}
        </p>
      ) : (
        <p className="text-[11px] text-[var(--muted)]">no cost basis</p>
      )}
    </>
  );
}

/** Day change on the meta line, where phones read it (the Day column is sm+). */
function SheetDayInline({ m }: { m: RowMetrics }) {
  if (m.day == null) return null;
  return (
    <span className={`mono md:hidden ${signedColor(m.day)}`}>{fmtPct(m.day)} today</span>
  );
}

function SheetStat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="eyebrow">{label}</p>
      <p className="mono mt-1 text-sm text-[var(--paper)]">{children}</p>
    </div>
  );
}

function SheetHoldingRow({ h, m, ctx }: { h: HoldingRow; m: RowMetrics; ctx: SheetCtx }) {
  const [expanded, setExpanded] = useState(false);
  const canExpand = Boolean(h.ticker);
  const sector = ctx.sectorOf(h);
  const history = h.ticker ? ctx.histories[h.ticker.toUpperCase()] : undefined;

  return (
    <SheetRow
      bar={bandWidth(m.weight, ctx.maxWeight)}
      weight={m.weight}
      m={m}
      expanded={expanded}
      onToggle={canExpand ? () => setExpanded((v) => !v) : undefined}
      toggleLabel={expanded ? `Collapse ${h.ticker}` : `Expand ${h.ticker}`}
      identity={
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="mono min-w-12 shrink-0 font-medium text-[var(--paper)]">
            {h.ticker ?? "—"}
          </span>
          <span
            className="truncate text-[13px] text-[var(--muted)]"
            title={h.securityName ?? undefined}
          >
            {cleanSecurityName(h.securityName)}
          </span>
          {h.manual && (
            <span className="shrink-0 rounded border border-line px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-[var(--muted)]">
              {h.securityType ?? "manual"}
            </span>
          )}
          {h.hasOverride && <AdjustedBadge />}
          {/* Quiet row actions — revealed on hover so 40 rows don't shout. */}
          <span className="hidden items-center gap-2.5 opacity-0 transition-opacity duration-150 group-hover:opacity-100 focus-within:opacity-100 md:inline-flex">
            <DeskLinks ticker={h.ticker} optionable={isOptionable(h)} />
            <HoldingEditButtons h={h} />
          </span>
        </div>
      }
      meta={
        <>
          <span className="mono md:hidden">{m.weight.toFixed(1)}%</span>
          {m.qty != null && (
            <span className="mono">
              {m.qty.toLocaleString()}
              {m.price != null && ` @ ${formatMoney(m.price, m.currency)}`}
            </span>
          )}
          {m.account && <span className="truncate">{m.account}</span>}
          <SheetDayInline m={m} />
          <SectorEditor
            sector={sector}
            options={ctx.sectorOptions}
            color={sector ? ctx.sectorColor[sector] : undefined}
            onSave={(name) => ctx.setSector(h.sectorKey, name)}
          />
        </>
      }
      panel={
        canExpand && (
          <div className="relative border-t border-line/60 bg-[var(--panel-2)]/40 px-4 py-5 sm:px-6">
            {/* The figures the sheet drops from the row, kept one click away
                rather than spent on every row's width. */}
            <div className="mb-5 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
              <SheetStat label="Cost basis">
                {m.costBasis != null ? formatMoney(m.costBasis, m.currency) : "—"}
              </SheetStat>
              <SheetStat label="Avg cost">
                {m.avgCost != null ? formatMoney(m.avgCost, m.currency) : "—"}
              </SheetStat>
              <SheetStat label="Day">
                <span className={signedColor(m.dayValue)}>
                  {m.dayValue != null ? fmtSigned(m.dayValue, m.currency) : "—"}
                </span>
              </SheetStat>
              <SheetStat label="Share of book">{m.weight.toFixed(2)}%</SheetStat>
            </div>
            <TickerHistoryPanel
              ticker={h.ticker as string}
              history={history ?? []}
              txns={h.ticker ? ctx.txnsByTicker[h.ticker.toUpperCase()] ?? [] : []}
              currency={m.currency}
            />
          </div>
        )
      }
    />
  );
}

function SheetOptionRow({
  underlying,
  legs,
  m,
  ctx,
}: {
  underlying: string;
  legs: HoldingRow[];
  m: RowMetrics;
  ctx: SheetCtx;
}) {
  const [expanded, setExpanded] = useState(false);

  const parsed = legs.map((h) => ({ h, p: parseOccSymbol(h.ticker)! }));
  const structures = classifyOptionLegs(
    parsed.map(({ h, p }) => ({ parsed: p, quantity: h.quantity, costBasis: h.costBasis })),
  );
  const underlyingPrice = ctx.quotes[underlying.toUpperCase()]?.price ?? null;
  const soonestDte = Math.min(...parsed.map(({ p }) => daysToExpiry(p.expiry)));
  const groupRisk = riskLevel(soonestDte);
  const flags = new Set(
    parsed
      .map(({ h, p }) => optionRiskFlag(p, h.quantity, underlyingPrice, daysToExpiry(p.expiry)))
      .filter((f): f is "assignment" | "expiry" => f != null),
  );
  const summary =
    structures.length === 1
      ? structures[0].label
      : `${structures.length} structures · ${legs.length} legs`;

  return (
    <SheetRow
      bar={bandWidth(m.weight, ctx.maxWeight)}
      weight={m.weight}
      m={m}
      expanded={expanded}
      onToggle={() => setExpanded((v) => !v)}
      toggleLabel={expanded ? `Collapse ${underlying} options` : `Expand ${underlying} options`}
      identity={
        <div className="flex min-w-0 flex-wrap items-center gap-2.5">
          <span className="mono min-w-12 shrink-0 font-medium text-[var(--paper)]">
            {underlying}
          </span>
          <span className="truncate text-[13px] text-[var(--muted)]">{summary}</span>
          {/* A short-dominant spread is worth negative money: closing it costs
              cash. Calling that "small" — which is what an unlabelled −$1,538
              reads as — is the opposite of the truth. */}
          {m.value < -0.005 && (
            <span
              title="Net short: this position is a liability, not an asset"
              className="mono shrink-0 rounded bg-[var(--coral)]/15 px-1.5 py-0.5 text-[10px] text-[var(--coral)]"
            >
              liability
            </span>
          )}
          {[...flags].map((f) => (
            <span
              key={f}
              className="shrink-0 rounded bg-[var(--coral)]/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-[var(--coral)]"
            >
              {f === "assignment" ? "Assign risk" : "Worthless risk"}
            </span>
          ))}
          <span className="hidden items-center opacity-0 transition-opacity duration-150 focus-within:opacity-100 group-hover:opacity-100 md:inline-flex">
            <DeskLinks ticker={underlying} optionable chainOnly />
          </span>
        </div>
      }
      meta={
        <>
          <span className="mono md:hidden">{m.weight.toFixed(1)}%</span>
          {Number.isFinite(soonestDte) && (
            <span
              className={`mono ${
                groupRisk === "expired" || groupRisk === "high"
                  ? "text-[var(--coral)]"
                  : groupRisk === "medium"
                    ? "text-[var(--brass)]"
                    : ""
              }`}
              title={`${soonestDte} days to soonest expiry`}
            >
              {expiryBucket(soonestDte)}
            </span>
          )}
          <span className="mono">
            {legs.length} {legs.length === 1 ? "leg" : "legs"}
          </span>
          {m.account && <span className="truncate">{m.account}</span>}
        </>
      }
      panel={
        <div className="relative border-t border-line/60 bg-[var(--panel-2)]/40 px-4 py-5 sm:px-6">
          <OptionStructuresPanel legs={legs} quotes={ctx.quotes} currency={m.currency} />
        </div>
      }
    />
  );
}

/** One kind of thing — stocks, ETFs, crypto, options, cash — and its subtotal. */
function SheetSection({
  section,
  currency,
  ctx,
}: {
  section: {
    kind: HoldingKind;
    label: string;
    rows: RowItem[];
    value: number;
    weight: number;
    pnl: number | null;
  };
  currency: string;
  ctx: SheetCtx;
}) {
  const n = section.rows.length;
  return (
    <section>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-line pb-2 pt-5">
        <span className="eyebrow">{section.label}</span>
        <span className="text-[11px] text-[var(--muted)]">
          {n}{" "}
          {section.kind === "option"
            ? n === 1
              ? "structure"
              : "structures"
            : n === 1
              ? "position"
              : "positions"}
        </span>
        <span className="mono ml-auto text-xs text-[var(--muted)]">
          {formatMoney(section.value, currency)} · {section.weight.toFixed(1)}%
          {section.pnl != null && (
            <span className={section.pnl >= 0 ? " text-[var(--jade)]" : " text-[var(--coral)]"}>
              {" · "}
              {section.pnl >= 0 ? "+" : "−"}
              {formatMoney(Math.abs(section.pnl), currency)}
            </span>
          )}
          {/* Cash is in the total but it isn't a bet — say so once, here,
              rather than letting it pad the "invested" figure silently. */}
          {section.kind === "cash" && <span className="text-[var(--muted)]"> · not invested</span>}
        </span>
      </div>
      <ul>
        {section.rows.map((it) =>
          it.kind === "holding" ? (
            <SheetHoldingRow key={it.h.id} h={it.h} m={it.m} ctx={ctx} />
          ) : (
            <SheetOptionRow
              key={`opt:${it.underlying}`}
              underlying={it.underlying}
              legs={it.legs}
              m={it.m}
              ctx={ctx}
            />
          ),
        )}
      </ul>
    </section>
  );
}

/** Sheet or table, remembered per browser. */
function ViewToggle({
  view,
  onChange,
}: {
  view: HoldingsView;
  onChange: (v: HoldingsView) => void;
}) {
  return (
    <Segmented
      label="Holdings view"
      value={view}
      onChange={onChange}
      options={[
        { value: "sheet", label: "Sheet" },
        { value: "table", label: "Table" },
      ]}
    />
  );
}

/** Sort control for the sheet, which has no column headers to click. */
function SheetSort({
  sortKey,
  sortDir,
  onSort,
}: {
  sortKey: SortKey;
  sortDir: "desc" | "asc";
  onSort: (key: SortKey) => void;
}) {
  const OPTIONS: { key: SortKey; label: string }[] = [
    { key: "value", label: "Value" },
    { key: "weight", label: "Weight" },
    { key: "day", label: "Day" },
    { key: "pnl", label: "P&L" },
    { key: "name", label: "Name" },
  ];
  return (
    <span className="inline-flex items-center gap-1">
      <select
        value={sortKey}
        onChange={(e) => onSort(e.target.value as SortKey)}
        aria-label="Sort positions by"
        className="rounded-lg border border-line bg-[var(--ink)] px-2 py-1 text-xs text-[var(--muted)] outline-none transition hover:text-[var(--paper)] focus:border-[var(--brass-dim)]"
      >
        {OPTIONS.map((o) => (
          <option key={o.key} value={o.key}>
            {o.label}
          </option>
        ))}
      </select>
      <button
        onClick={() => onSort(sortKey)}
        aria-label={sortDir === "desc" ? "Sort ascending" : "Sort descending"}
        title={sortDir === "desc" ? "Largest first" : "Smallest first"}
        className="grid h-6 w-6 place-items-center rounded text-[var(--muted)] transition hover:text-[var(--paper)]"
      >
        <ChevronDown size={13} className={sortDir === "asc" ? "rotate-180" : ""} />
      </button>
    </span>
  );
}

/**
 * The whole sheet: every section, then the folded tail of sub-1% positions.
 * Responsive by construction — it's a list, not a table — so it serves phones
 * and desktops from one markup instead of a card view shadowing a table view.
 */
function HoldingsSheet({
  sections,
  tail,
  tailValue,
  tailWeight,
  showAll,
  onShowAll,
  currency,
  count,
  total,
  dayChange,
  dayPct,
  sortKey,
  sortDir,
  onSort,
  ctx,
  empty,
}: {
  sections: {
    kind: HoldingKind;
    label: string;
    rows: RowItem[];
    value: number;
    weight: number;
    pnl: number | null;
  }[];
  tail: RowItem[];
  tailValue: number;
  tailWeight: number;
  showAll: boolean;
  onShowAll: (v: boolean) => void;
  currency: string;
  /** Rows in the book (option legs count once per underlying). */
  count: number;
  total: number;
  /** Null until at least one position has a live quote. */
  dayChange: number | null;
  dayPct: number | null;
  sortKey: SortKey;
  sortDir: "desc" | "asc";
  onSort: (key: SortKey) => void;
  ctx: SheetCtx;
  empty: string | null;
}) {
  const head = (key: SortKey, label: string, cls: string) => (
    <button
      type="button"
      onClick={() => onSort(key)}
      aria-label={`Sort by ${label === "%" ? "today's percent change" : label.toLowerCase()}`}
      className={`${cls} transition-colors hover:text-[var(--paper)] ${
        sortKey === key ? "text-[var(--paper)]" : ""
      }`}
    >
      {label}
      {sortKey === key && <span aria-hidden> {sortDir === "desc" ? "↓" : "↑"}</span>}
    </button>
  );

  return (
    <div className="overflow-x-auto">
      <div className="md:min-w-[780px]">
        <div
          className={`${SHEET_GRID} !items-end border-b border-[var(--line-strong)] pb-2.5 text-xs text-[var(--muted)]`}
        >
          <h2 className="col-span-2 font-display text-lg tracking-tight text-[var(--paper)]">
            Holdings
            <span className="mono ml-2 text-xs font-normal text-[var(--muted)]">{count}</span>
          </h2>
          {head("weight", "Weight", "hidden text-left md:block")}
          <span className="hidden md:block" />
          {head("value", "Value", "text-right")}
          {head("dayValue", "Today", "hidden text-right md:block")}
          {head("day", "%", "hidden text-right md:block")}
        </div>

        {empty ? (
          <p className="border-b border-line py-10 text-center text-sm text-[var(--muted)]">
            {empty}
          </p>
        ) : (
          <>
            {sections.map((section) => (
              <SheetSection key={section.kind} section={section} currency={currency} ctx={ctx} />
            ))}

            {/* The long tail, folded. The money is counted in the line — only the
                rows are hidden, and one click brings them back. */}
            {tail.length > 0 && (
              <button
                onClick={() => onShowAll(true)}
                className="flex min-h-[52px] w-full items-center gap-3 border-b border-line text-left text-xs text-[var(--muted)] transition-colors hover:text-[var(--paper)]"
              >
                <ChevronDown size={13} />
                <span>
                  {tail.length} positions under {TAIL_WEIGHT_PCT}% each
                </span>
                <span className="mono ml-auto">
                  {formatMoney(tailValue, currency)} · {tailWeight.toFixed(1)}%
                </span>
                <span className="text-[var(--brass)]">Show</span>
              </button>
            )}
            {showAll && (
              <button
                onClick={() => onShowAll(false)}
                className="min-h-11 w-full border-b border-line text-left text-xs text-[var(--muted)] transition-colors hover:text-[var(--paper)]"
              >
                Fold small positions again
              </button>
            )}

            <div className={`${SHEET_GRID} mono min-h-14`}>
              <span className="col-span-2 font-sans text-[var(--muted)]">Total</span>
              <span className="hidden md:block" />
              <span className="hidden md:block" />
              <span className="text-right">{formatMoney(total, currency)}</span>
              <span className={`hidden text-right md:block ${signedColor(dayChange)}`}>
                {fmtSigned(dayChange, currency)}
              </span>
              <span className={`hidden text-right md:block ${signedColor(dayPct)}`}>
                {fmtPct(dayPct)}
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function PriceCell({ price, currency }: { price: number; currency: string }) {
  const prev = useRef<number | null>(null);
  const [flash, setFlash] = useState<"up" | "down" | null>(null);

  useEffect(() => {
    const last = prev.current;
    if (last != null && price !== last) {
      setFlash(price > last ? "up" : "down");
      const t = setTimeout(() => setFlash(null), 700);
      prev.current = price;
      return () => clearTimeout(t);
    }
    prev.current = price;
  }, [price]);

  const color =
    flash === "up"
      ? "text-[var(--jade)]"
      : flash === "down"
        ? "text-[var(--coral)]"
        : "text-[var(--muted)]";

  return (
    <td
      className={`mono px-3 py-3.5 text-right transition-colors duration-200 ${color}`}
    >
      {formatMoney(price, currency)}
    </td>
  );
}

/**
 * Per-holding reconciliation of the headline unrealized gain. Lists each
 * position's value, cost basis, and P&L so the total is auditable, and calls out
 * holdings with no cost basis (in market value but excluded from gain).
 */
function GainBreakdownModal({
  holdings,
  quotes,
  gain,
  totalCost,
  uncostedValue,
  onClose,
}: {
  holdings: HoldingRow[];
  quotes: Record<string, LiveQuote>;
  gain: number;
  totalCost: number;
  uncostedValue: number;
  onClose: () => void;
}) {
  const rows = [...holdings]
    .map((h) => ({
      h,
      value: effectiveValue(h, quotes),
      cost: h.costBasis,
      pnl: effectivePnl(h, quotes),
    }))
    .sort((a, b) => (b.pnl ?? Number.NEGATIVE_INFINITY) - (a.pnl ?? Number.NEGATIVE_INFINITY));

  const gainPositive = gain >= 0;

  return (
    <Dialog
      onClose={onClose}
      label="Unrealized gain breakdown"
      size="2xl"
      className="flex max-h-[85vh] flex-col"
    >
      <DialogHeader
        title="Unrealized gain breakdown"
        description={<>Per-holding P&amp;L (current value − cost basis)</>}
        onClose={onClose}
      />

      <DialogBody className="p-0">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-[var(--panel)]">
            <tr className="border-b border-line text-left">
              {["Holding", "Value", "Cost basis", "P&L", "%"].map((h, i) => (
                <th
                  key={h}
                  className={`px-5 py-2.5 eyebrow font-medium ${i >= 1 ? "text-right" : ""}`}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ h, value, cost, pnl }) => {
              const pct = pnl != null && cost ? (pnl / cost) * 100 : null;
              const pos = (pnl ?? 0) >= 0;
              const color = pos ? "text-[var(--jade)]" : "text-[var(--coral)]";
              return (
                <tr key={h.id} className="border-b border-line/60 last:border-0">
                  <td className="px-5 py-2.5">
                    <span className="font-medium text-[var(--brass)]">{h.ticker ?? "—"}</span>
                    <span className="ml-2 text-[var(--muted)]">{cleanSecurityName(h.securityName)}</span>
                  </td>
                  <td className="mono px-5 py-2.5 text-right">
                    {formatMoney(value, h.currency)}
                  </td>
                  <td className="mono px-5 py-2.5 text-right text-[var(--muted)]">
                    {cost != null ? formatMoney(cost, h.currency) : "—"}
                  </td>
                  <td className={`mono px-5 py-2.5 text-right ${pnl != null ? color : "text-[var(--muted)]"}`}>
                    {pnl != null
                      ? `${pos ? "+" : "−"}${formatMoney(Math.abs(pnl), h.currency)}`
                      : "—"}
                  </td>
                  <td className={`mono px-5 py-2.5 text-right ${pct != null ? color : "text-[var(--muted)]"}`}>
                    {pct != null ? `${pos ? "+" : "−"}${Math.abs(pct).toFixed(1)}%` : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </DialogBody>

      <div className="shrink-0 border-t border-line px-5 py-4 text-sm">
        <div className="flex items-center justify-between">
          <span className="text-[var(--muted)]">Total cost basis</span>
          <span className="mono">{formatCurrency(totalCost)}</span>
        </div>
        <div className="mt-1.5 flex items-center justify-between">
          <span className="text-[var(--muted)]">Unrealized gain</span>
          <span className={`mono ${gainPositive ? "text-[var(--jade)]" : "text-[var(--coral)]"}`}>
            {gainPositive ? "+" : "−"}
            {formatCurrency(Math.abs(gain))}
          </span>
        </div>
        {uncostedValue > 0.005 && (
          <p className="mt-3 border-t border-line/60 pt-3 text-xs text-[var(--muted)]">
            {formatCurrency(uncostedValue)} sits in holdings without a cost basis — counted in
            market value but excluded from unrealized gain (no basis to compare against). Add a
            cost basis to include them.
          </p>
        )}
      </div>
    </Dialog>
  );
}

/**
 * Inline sector pill + editor for a holding. Collapsed it shows the assigned
 * sector (or a dashed "+ sector" prompt); clicking reveals a small text input
 * with a datalist of existing sectors so you can reuse or coin a new one. An
 * empty value clears the assignment. Edits propagate by sectorKey, so changing
 * one ticker's sector updates every position of that ticker at once.
 */
function SectorEditor({
  sector,
  options,
  color,
  onSave,
}: {
  sector: string | null;
  options: string[];
  color?: string;
  onSave: (sector: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [val, setVal] = useState(sector ?? "");
  const inputRef = useRef<HTMLInputElement>(null);
  const skip = useRef(false);
  const listId = useId();

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  function commit() {
    setOpen(false);
    if (skip.current) {
      skip.current = false;
      return;
    }
    const next = val.trim() || null;
    if (next !== (sector ?? null)) onSave(next);
  }

  if (open) {
    return (
      <span className="inline-flex w-fit items-center">
        <input
          ref={inputRef}
          list={listId}
          value={val}
          onChange={(e) => setVal(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") inputRef.current?.blur();
            else if (e.key === "Escape") {
              skip.current = true;
              inputRef.current?.blur();
            }
          }}
          placeholder="Sector…"
          className="w-36 rounded-md border border-line bg-[var(--panel-2)] px-2 py-0.5 text-[11px] text-[var(--paper)] outline-none focus:border-[var(--brass-dim)]"
        />
        <datalist id={listId}>
          {options.map((o) => (
            <option key={o} value={o} />
          ))}
        </datalist>
      </span>
    );
  }

  if (sector) {
    return (
      <button
        type="button"
        onClick={() => {
          setVal(sector);
          setOpen(true);
        }}
        className="group/sec inline-flex w-fit items-center gap-1.5 rounded-full border border-line px-2 py-0.5 text-[11px] text-[var(--muted)] transition hover:text-[var(--paper)]"
      >
        <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: color }} />
        {sector}
        <Pencil size={9} className="opacity-0 transition group-hover/sec:opacity-60" />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => {
        setVal("");
        setOpen(true);
      }}
      className="inline-flex w-fit items-center gap-1 rounded-full border border-dashed border-line px-2 py-0.5 text-[11px] text-[var(--muted)] transition hover:text-[var(--muted)]"
    >
      <Tag size={9} /> sector
    </button>
  );
}


/**
 * Compact out/under-performance table: one row per time window comparing the
 * portfolio's return to SPY and QQQ, with the delta colored jade when the
 * portfolio outperformed and coral when it lagged. Hidden until there's at
 * least one window's worth of comparison data.
 */
function BenchmarkComparison({
  comparison,
  standing,
}: {
  comparison: ComparisonRow[];
  standing: ReturnType<typeof computeStanding>;
}) {
  if (comparison.length === 0) return null;

  const pct = (v: number | null) =>
    v == null ? "—" : `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(1)}%`;

  /**
   * The gap between two percentages is measured in percentage POINTS. Printing
   * it as "−25.7%" invites reading it as a 25.7% loss, which is a different and
   * much scarier number than "25.7 points behind the index".
   */
  const points = (v: number | null) =>
    v == null ? "—" : `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(1)} pts`;

  const benchmark = standing.benchmark;
  const gapFor = (r: ComparisonRow) => (benchmark === "SPY" ? r.deltaVsSpy : r.deltaVsQqq);

  return (
    <section className="space-y-4">
      <SectionHead
        title="Return vs benchmarks"
        action={<span className="text-xs text-[var(--muted)]">deposits excluded</span>}
      />

      {/* The table already contained this sentence; it just never said it. */}
      {standing.state !== "unknown" && (
        <div>
          <Verdict>
            <span
              className={
                standing.state === "behind" ? "text-[var(--coral)]" : "text-[var(--jade)]"
              }
            >
              {standing.behindEverywhere
                ? `Behind ${benchmark} in every window.`
                : `${standingHeadline(standing)} over ${standing.windowLabel.toLowerCase()}.`}
            </span>{" "}
            <span className="text-[var(--muted)]">
              {standing.behindEverywhere
                ? `The gap widens the further back you look — a year out it is ${Math.abs(standing.gapPoints!).toFixed(1)} points.`
                : "Measured against the index over the same days."}
            </span>
          </Verdict>
          <p className="mt-1.5 text-xs text-[var(--muted)]">
            Your deposits are removed before comparing, so this measures the picks, not the
            paycheque.
          </p>
        </div>
      )}

      <div className={ruled.scroll}>
        <table className={`${ruled.table} min-w-[520px]`}>
          <thead>
            <tr className={ruled.headRow}>
              {["Window", "You", "SPY", "QQQ", `Gap vs ${benchmark}`].map((h, i) => (
                <th key={h} className={`${ruled.th} ${i >= 1 ? "text-right" : ""}`}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {comparison.map((r) => {
              const pColor =
                r.portfolioPct == null
                  ? "text-[var(--muted)]"
                  : r.portfolioPct >= 0
                    ? "text-[var(--jade)]"
                    : "text-[var(--coral)]";
              const gap = gapFor(r);
              // The window the page leads with is marked, so the headline and the
              // table visibly agree rather than making you find the row.
              const lead = r.window === standing.window;
              return (
                <tr key={r.window} className={`${ruled.row} last:border-0`}>
                  <td
                    className={`${ruled.td} ${lead ? "text-[var(--paper)]" : "text-[var(--muted)]"}`}
                  >
                    {WINDOW_LABEL[r.window]}
                    {lead && <span className="ml-2 text-xs text-[var(--brass)]">headline</span>}
                  </td>
                  <td className={`${ruled.td} ${ruled.num} ${pColor}`}>{pct(r.portfolioPct)}</td>
                  <td className={`${ruled.td} ${ruled.num} text-[var(--muted)]`}>{pct(r.spyPct)}</td>
                  <td className={`${ruled.td} ${ruled.num} text-[var(--muted)]`}>{pct(r.qqqPct)}</td>
                  <td
                    className={`${ruled.td} ${ruled.num} ${
                      gap == null
                        ? "text-[var(--muted)]"
                        : gap >= 0
                          ? "text-[var(--jade)]"
                          : "text-[var(--coral)]"
                    } ${lead ? "font-semibold" : ""}`}
                  >
                    {points(gap)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** Column header. Sortable headers show a ↓/↑/↕ glyph and drive the holdings sort. */
function HeaderCell({
  label,
  align,
  sortable,
  active = false,
  dir,
  onClick,
}: {
  label: string;
  align: "left" | "right";
  sortable: boolean;
  active?: boolean;
  dir: "asc" | "desc";
  onClick?: () => void;
}) {
  const alignCls = align === "right" ? "text-right" : "text-left";
  if (!sortable || !onClick) {
    return <th className={`px-3 py-3.5 eyebrow font-medium ${alignCls}`}>{label}</th>;
  }
  return (
    <th className={`px-3 py-3.5 eyebrow font-medium ${alignCls}`}>
      <button
        onClick={onClick}
        className={`inline-flex items-center gap-1 transition-colors hover:text-[var(--paper)] ${
          active ? "text-[var(--paper)]" : ""
        } ${align === "right" ? "flex-row-reverse" : ""}`}
      >
        {label}
        <span className={active ? "text-[var(--brass)]" : "text-[var(--muted)]"}>
          {active ? (dir === "desc" ? "↓" : "↑") : "↕"}
        </span>
      </button>
    </th>
  );
}

/**
 * Renders the toggleable metric cells for one row, in the user's column order.
 * The same renderer serves single holdings and option groups: option groups pass
 * `null` for the columns that don't apply (price, day, …) and get an em dash.
 */
function MetricCells({
  columns,
  m,
  history,
}: {
  columns: ColumnDef[];
  m: RowMetrics;
  history?: PricePoint[];
}) {
  const numRight = "mono px-3 py-3.5 text-right";
  const dash = (key: string) => (
    <td key={key} className={`${numRight} text-[var(--muted)]`}>
      —
    </td>
  );
  return (
    <>
      {columns.map((c) => {
        switch (c.key) {
          case "account":
            return (
              <td key={c.key} className="px-3 py-3.5 text-[var(--muted)]">
                {m.account ?? "—"}
              </td>
            );
          case "trend":
            return (
              <td key={c.key} className="px-3 py-2">
                {history && history.length > 1 ? (
                  <Sparkline data={history} />
                ) : (
                  <span className="text-[var(--muted)]">—</span>
                )}
              </td>
            );
          case "qty":
            return (
              <td key={c.key} className={`${numRight} text-[var(--muted)]`}>
                {m.qty != null ? m.qty.toLocaleString() : "—"}
              </td>
            );
          case "price":
            return m.price != null ? (
              <PriceCell key={c.key} price={m.price} currency={m.currency} />
            ) : (
              dash(c.key)
            );
          case "day":
            return <DayCell key={c.key} pct={m.day} />;
          case "dayValue":
            return <SignedCurrencyCell key={c.key} amount={m.dayValue} currency={m.currency} />;
          case "costBasis":
            return (
              <td key={c.key} className={`${numRight} text-[var(--muted)]`}>
                {m.costBasis != null ? formatMoney(m.costBasis, m.currency) : "—"}
              </td>
            );
          case "avgCost":
            return (
              <td key={c.key} className={`${numRight} text-[var(--muted)]`}>
                {m.avgCost != null ? formatMoney(m.avgCost, m.currency) : "—"}
              </td>
            );
          case "value":
            return (
              <td key={c.key} className={numRight}>
                {formatMoney(m.value, m.currency)}
              </td>
            );
          case "weight":
            return <WeightCell key={c.key} pct={m.weight} />;
          case "pnl":
            return <PnlCell key={c.key} pnl={m.pnl} pct={m.pnlPct} currency={m.currency} />;
        }
      })}
    </>
  );
}

/** Signed currency cell (green/red), or a dash when there's no value. */
function SignedCurrencyCell({ amount, currency }: { amount: number | null; currency: string }) {
  if (amount == null) {
    return <td className="mono px-3 py-3.5 text-right text-[var(--muted)]">—</td>;
  }
  const positive = amount >= 0;
  const color = positive ? "text-[var(--jade)]" : "text-[var(--coral)]";
  return (
    <td className={`mono px-3 py-3.5 text-right ${color}`}>
      {positive ? "+" : "−"}
      {formatMoney(Math.abs(amount), currency)}
    </td>
  );
}

/** Share-of-portfolio cell: a thin proportion bar plus the percent. */
function WeightCell({ pct }: { pct: number }) {
  const w = Math.max(0, Math.min(100, pct));
  return (
    <td className="mono px-3 py-3.5 text-right">
      <span className="inline-flex items-center justify-end gap-2.5">
        <span className="hidden h-[3px] w-14 overflow-hidden rounded-full bg-[var(--line)] sm:inline-block">
          <span
            className="block h-full rounded-full bg-[var(--brass)]"
            style={{ width: `${Math.max(2, w)}%` }}
          />
        </span>
        <span className="min-w-[3.25rem] text-[var(--paper)]">{pct.toFixed(1)}%</span>
      </span>
    </td>
  );
}

/** Popover to toggle which metric columns are shown; choice persists per browser. */
function ColumnsMenu({
  visible,
  onToggle,
  onReset,
}: {
  visible: ColumnKey[];
  onToggle: (key: ColumnKey) => void;
  onReset: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="true"
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-xs text-[var(--muted)] transition hover:text-[var(--paper)]"
      >
        <SlidersHorizontal size={12} />
        Columns
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-2 w-52 overflow-hidden rounded-[var(--radius)] border border-line bg-[var(--panel)] shadow-[var(--elev-3)]">
          <div className="flex items-center justify-between border-b border-line px-3 py-2">
            <span className="eyebrow">Columns</span>
            <button
              onClick={onReset}
              className="text-[10px] uppercase tracking-wide text-[var(--muted)] transition hover:text-[var(--brass)]"
            >
              Reset
            </button>
          </div>
          <ul className="max-h-72 overflow-y-auto py-1">
            {COLUMNS.map((c) => {
              const on = visible.includes(c.key);
              return (
                <li key={c.key}>
                  <button
                    onClick={() => onToggle(c.key)}
                    role="menuitemcheckbox"
                    aria-checked={on}
                    className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-xs text-[var(--muted)] transition hover:bg-[var(--panel-2)] hover:text-[var(--paper)]"
                  >
                    <span
                      className={`grid h-3.5 w-3.5 shrink-0 place-items-center rounded border ${
                        on
                          ? "border-[var(--brass-dim)] bg-[var(--brass-dim)] text-[var(--ink)]"
                          : "border-line"
                      }`}
                    >
                      {on && <Check size={10} strokeWidth={3} />}
                    </span>
                    {c.label}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

/** Unrealized P&L cell: signed value + percent, dash when there's no cost basis. */
function PnlCell({
  pnl,
  pct,
  currency,
}: {
  pnl: number | null;
  pct: number | null;
  currency: string;
}) {
  if (pnl == null) {
    return <td className="mono px-3 py-3.5 text-right text-[var(--muted)]">—</td>;
  }
  const positive = pnl >= 0;
  const color = positive ? "text-[var(--jade)]" : "text-[var(--coral)]";
  return (
    <td className={`mono px-3 py-3.5 text-right ${color}`}>
      <div>
        {positive ? "+" : "−"}
        {formatMoney(Math.abs(pnl), currency)}
      </div>
      {pct != null && (
        <div className="text-xs opacity-80">
          {positive ? "+" : "−"}
          {Math.abs(pct).toFixed(2)}%
        </div>
      )}
    </td>
  );
}

/** Day-change cell: green/red signed percent, or a dash when we have no quote. */
function DayCell({ pct }: { pct: number | null }) {
  if (pct == null) {
    return <td className="mono px-3 py-3.5 text-right text-[var(--muted)]">—</td>;
  }
  const positive = pct >= 0;
  const color = positive ? "text-[var(--jade)]" : "text-[var(--coral)]";
  return (
    <td className={`mono px-3 py-3.5 text-right ${color}`}>
      {positive ? "+" : "−"}
      {Math.abs(pct).toFixed(2)}%
    </td>
  );
}

function StatusBadge({ status }: { status: LiveStatus }) {
  if (status === "idle") return null;

  const config: Record<
    Exclude<LiveStatus, "idle">,
    { label: string; dot: string; text: string }
  > = {
    live: { label: "Live", dot: "bg-[var(--jade)]", text: "text-[var(--jade)]" },
    connecting: {
      label: "Connecting…",
      dot: "bg-[var(--brass)]",
      text: "text-[var(--muted)]",
    },
    disabled: {
      label: "Set FINNHUB_API_KEY for live prices",
      dot: "bg-[var(--muted)]",
      text: "text-[var(--muted)]",
    },
    error: {
      label: "Live prices unavailable",
      dot: "bg-[var(--coral)]",
      text: "text-[var(--coral)]",
    },
  };

  const c = config[status];
  return (
    <span className={`flex items-center gap-1.5 text-xs ${c.text}`}>
      <span
        className={`inline-block h-1.5 w-1.5 rounded-full ${c.dot} ${status === "live" ? "animate-pulse" : ""}`}
      />
      {c.label}
    </span>
  );
}

/** "+$1,204.10" / "−$88.00" — same sign convention the tiles used; privacy mode masks the whole figure. */
function signedCurrency(value: number): string {
  return `${value >= 0 ? "+" : ""}${formatCurrency(value)}`;
}

function signedPct(pct: number): string {
  return `${pct >= 0 ? "+" : "−"}${Math.abs(pct).toFixed(2)}%`;
}
