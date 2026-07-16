"use client";

import { useEffect, useId, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowUpRight, Check, ChevronDown, Pencil, SlidersHorizontal, Tag, X } from "lucide-react";
import { Card } from "@/components/ui/card";
import {
  AllocationDonut,
  PIE_COLORS,
  SectorBarChart,
  Sparkline,
  TickerPriceChart,
  type SectorSlice,
} from "@/components/charts";
import { ValueHistory } from "@/components/value-history";
import {
  AddManualHoldingButton,
  DeleteManualHoldingButton,
  EditCostBasisButton,
  EditManualHoldingButton,
} from "@/components/manual-holding-dialog";
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
import { OptionsAnalytics } from "@/components/options-analytics";
import { AssetAllocation, type AllocRow } from "@/components/asset-allocation";
import { DividendPanel } from "@/components/dividend-panel";
import type { InvestmentTxnRow } from "@/lib/queries";
import type { DividendSummary } from "@/lib/dividends";
import type { DividendCalendarEntry, OptionQuote, PricePoint as YahooPricePoint } from "@/lib/yahoo";
import type { BenchmarkKey, ComparisonRow } from "@/lib/benchmark";

const UNASSIGNED = "Unassigned";
import {
  LivePricesProvider,
  useLivePrices,
  type LiveStatus,
  type LiveQuote,
} from "@/components/live-prices";

export type HoldingRow = {
  id: string;
  quantity: number | null;
  costBasis: number | null;
  price: number | null;
  value: number | null;
  closePrice: number | null;
  currency: string | null;
  ticker: string | null;
  securityName: string | null;
  securityType: string | null;
  accountName: string | null;
  /** True for user-entered off-Plaid holdings (crypto, fixed-value assets). */
  manual?: boolean;
  /** True when imported from a connected wallet (quantity is chain-synced). */
  fromWallet?: boolean;
  /** Symbol-scoped key the sector assignment is stored under (see sectorKeyFor). */
  sectorKey: string;
  /** Currently assigned sector, or null when untagged. */
  sector?: string | null;
  /** Brokerage-reported basis before any user correction (Plaid holdings). */
  plaidCostBasis?: number | null;
  /** Raw cost-basis override inputs, for the correction dialog (Plaid holdings). */
  overrideTotal?: number | null;
  overrideUnit?: number | null;
  overrideAsOf?: string | null;
  /** True when `costBasis` reflects a user correction rather than the brokerage figure. */
  hasOverride?: boolean;
};

type PricePoint = { date: string; close: number };

export function PortfolioView({
  holdings,
  histories = {},
  portfolioSeries = [],
  benchmarks = {},
  comparison = [],
  transactions = [],
  knownSectors = [],
  ivByOcc = {},
  underlyingPrices = {},
  chainByUnderlying = {},
  allocationTargets = {},
  assetClassOverrides = {},
  geographyOverrides = {},
  dividendSummary,
  dividendCalendar = [],
}: {
  holdings: HoldingRow[];
  histories?: Record<string, PricePoint[]>;
  portfolioSeries?: { date: string; value: number }[];
  /** SPY/QQQ daily closes for the value-chart overlay. */
  benchmarks?: Partial<Record<BenchmarkKey, YahooPricePoint[]>>;
  /** Per-window portfolio-vs-benchmark return comparison. */
  comparison?: ComparisonRow[];
  transactions?: InvestmentTxnRow[];
  knownSectors?: string[];
  /** Live implied volatility by OCC symbol (from the Yahoo option chains). */
  ivByOcc?: Record<string, number>;
  /** Underlying spot price by symbol (Yahoo chain quote fallback). */
  underlyingPrices?: Record<string, number>;
  /** Full option-chain quotes by underlying (Yahoo), for the chain browser. */
  chainByUnderlying?: Record<string, OptionQuote[]>;
  /** User-set target allocation percentages, keyed by dimension (see targetKeyFor). */
  allocationTargets?: Record<string, number>;
  /** Per-position asset-class overrides, keyed by sectorKey. */
  assetClassOverrides?: Record<string, string>;
  /** Per-position geography overrides, keyed by sectorKey. */
  geographyOverrides?: Record<string, string>;
  /** Derived dividend income stream (trailing/projected/yield-on-cost). */
  dividendSummary?: DividendSummary;
  /** Yahoo ex-dividend calendar for held tickers. */
  dividendCalendar?: DividendCalendarEntry[];
}) {
  // Exclude option (OCC-symbol) legs — Finnhub can't quote them, so skip the
  // wasted live-price subscriptions; they're valued from Plaid instead.
  const symbols = useMemo(
    () =>
      holdings
        .filter((h) => !parseOccSymbol(h.ticker))
        .map((h) => h.ticker)
        .filter((t): t is string => Boolean(t)),
    [holdings],
  );

  return (
    <LivePricesProvider symbols={symbols}>
      <PortfolioInner
        holdings={holdings}
        histories={histories}
        portfolioSeries={portfolioSeries}
        benchmarks={benchmarks}
        comparison={comparison}
        transactions={transactions}
        knownSectors={knownSectors}
        ivByOcc={ivByOcc}
        underlyingPrices={underlyingPrices}
        chainByUnderlying={chainByUnderlying}
        allocationTargets={allocationTargets}
        assetClassOverrides={assetClassOverrides}
        geographyOverrides={geographyOverrides}
        dividendSummary={dividendSummary}
        dividendCalendar={dividendCalendar}
      />
    </LivePricesProvider>
  );
}

/**
 * Effective price for a holding, in priority order:
 *   live Finnhub quote → Plaid institution price → security close price.
 * The closePrice fallback matters for instruments Finnhub can't quote and Plaid
 * leaves without an institution price (e.g. some mutual funds), which would
 * otherwise render as $0.00.
 */
function effectivePrice(h: HoldingRow, quotes: Record<string, LiveQuote>): number | null {
  const q = h.ticker ? quotes[h.ticker.toUpperCase()] : undefined;
  if (q?.price != null) return q.price;
  return h.price ?? h.closePrice ?? null;
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

function effectiveValue(h: HoldingRow, quotes: Record<string, LiveQuote>): number {
  const price = effectivePrice(h, quotes);
  if (price != null && h.quantity != null) return price * h.quantity;
  return h.value ?? 0;
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
  { key: "trend", label: "Trend", align: "left", sortable: false, defaultVisible: true },
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

const COLS_STORAGE_KEY = "budgetr.holdings.columns.v1";

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
type RowItem =
  | { kind: "holding"; h: HoldingRow; name: string; m: RowMetrics }
  | { kind: "options"; underlying: string; legs: HoldingRow[]; name: string; m: RowMetrics };

function PortfolioInner({
  holdings,
  histories,
  portfolioSeries,
  benchmarks,
  comparison,
  transactions,
  knownSectors,
  ivByOcc,
  underlyingPrices,
  chainByUnderlying,
  allocationTargets,
  assetClassOverrides,
  geographyOverrides,
  dividendSummary,
  dividendCalendar,
}: {
  holdings: HoldingRow[];
  histories: Record<string, PricePoint[]>;
  portfolioSeries: { date: string; value: number }[];
  benchmarks: Partial<Record<BenchmarkKey, YahooPricePoint[]>>;
  comparison: ComparisonRow[];
  transactions: InvestmentTxnRow[];
  knownSectors: string[];
  ivByOcc: Record<string, number>;
  underlyingPrices: Record<string, number>;
  chainByUnderlying: Record<string, OptionQuote[]>;
  allocationTargets: Record<string, number>;
  assetClassOverrides: Record<string, string>;
  geographyOverrides: Record<string, string>;
  dividendSummary?: DividendSummary;
  dividendCalendar?: DividendCalendarEntry[];
}) {
  const { quotes, status } = useLivePrices();
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [sortKey, setSortKey] = useState<SortKey>("value");
  const [sortDir, setSortDir] = useState<"desc" | "asc">("desc");
  const [showBreakdown, setShowBreakdown] = useState(false);
  // Optimistic sector edits, keyed by sectorKey so a change to one ticker's
  // sector lights up every position of that ticker instantly (the server action
  // persists in the background and a refresh reconciles).
  const [sectorEdits, setSectorEdits] = useState<Record<string, string | null>>({});
  const [sectorFilter, setSectorFilter] = useState<string | null>(null);
  const { visible: visibleCols, toggle: toggleColumn, reset: resetColumns } = useColumnPrefs();
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

  // Stable color per sector: index by alphabetical name so a sector keeps its
  // hue as live prices reorder it by value. Unassigned is always muted gray.
  const sectorColor = useMemo(() => {
    const names = Array.from(
      new Set(holdings.map((h) => sectorOf(h) ?? UNASSIGNED).filter((s) => s !== UNASSIGNED)),
    ).sort();
    const map: Record<string, string> = { [UNASSIGNED]: "#8b948c" };
    names.forEach((n, i) => (map[n] = PIE_COLORS[i % PIE_COLORS.length]));
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holdings, sectorEdits]);

  // Allocation by sector, recomputed on every live-price tick and sector edit.
  const allocation = useMemo<SectorSlice[]>(() => {
    const agg = new Map<string, { value: number; count: number }>();
    for (const h of holdings) {
      const s = sectorOf(h) ?? UNASSIGNED;
      const cur = agg.get(s) ?? { value: 0, count: 0 };
      cur.value += effectiveValue(h, quotes);
      cur.count += 1;
      agg.set(s, cur);
    }
    return Array.from(agg.entries())
      .map(([sector, { value, count }]) => ({
        sector,
        value,
        count,
        color: sectorColor[sector] ?? "#8b948c",
      }))
      .sort((a, b) => b.value - a.value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holdings, quotes, sectorEdits, sectorColor]);

  const allocationTotal = allocation.reduce((s, d) => s + d.value, 0);
  // Suggestions for the sector editor: known sectors from the DB plus any added
  // optimistically this session, deduped.
  const sectorOptions = useMemo(
    () => Array.from(new Set([...knownSectors, ...allocation.map((a) => a.sector)]))
      .filter((s) => s !== UNASSIGNED)
      .sort(),
    [knownSectors, allocation],
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

  // Holdings shown in the table, narrowed to the drilled-into sector if any.
  const visible = useMemo(
    () =>
      sectorFilter
        ? holdings.filter((h) => (sectorOf(h) ?? UNASSIGNED) === sectorFilter)
        : holdings,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [holdings, sectorFilter, sectorEdits],
  );

  // Whole-portfolio market value — the denominator for each row's "% of total".
  const total = useMemo(
    () => holdings.reduce((s, h) => s + effectiveValue(h, quotes), 0),
    [holdings, quotes],
  );

  // Live-valued rows for the asset-allocation / targets panel, recomputed on each
  // price tick and sector edit (sector drives the sector-target drift).
  const allocRows = useMemo<AllocRow[]>(
    () =>
      holdings.map((h) => ({
        id: h.id,
        ticker: h.ticker,
        securityType: h.securityType,
        securityName: h.securityName,
        sectorKey: h.sectorKey,
        sector: sectorOf(h),
        value: effectiveValue(h, quotes),
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [holdings, quotes, sectorEdits],
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
    const singles = visible.filter((h) => !parseOccSymbol(h.ticker));
    const optionLegs = visible.filter((h) => parseOccSymbol(h.ticker) != null);

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
      const av = a.m[sortKey] ?? Number.NEGATIVE_INFINITY;
      const bv = b.m[sortKey] ?? Number.NEGATIVE_INFINITY;
      if (av === bv) return 0;
      if (av === Number.NEGATIVE_INFINITY) return 1;
      if (bv === Number.NEGATIVE_INFINITY) return -1;
      return (av - bv) * dir;
    });
  }, [visible, quotes, sortKey, sortDir, total]);

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

  return (
    <div className="space-y-7">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Market value" value={total} big />
        <Stat
          label="Day change"
          value={dayChange}
          signed
          pct={dayChangePctTotal}
          detail={`${Math.min(dayCoverage, 100).toFixed(0)}% of value has a live quote`}
          detailTitle={
            "Day change is computed only from holdings with a live intraday quote " +
            "(equities/ETFs via Finnhub, crypto via CoinGecko). Cash, options, mutual " +
            "funds, and untracked symbols are excluded, so this share is below 100%."
          }
        />
        <Stat
          label="Unrealized gain"
          value={gain}
          signed
          pct={gainPct}
          hint="View breakdown"
          onClick={() => setShowBreakdown(true)}
        />
        <Stat
          label="Cost basis"
          value={totalCost}
          detail={
            uncostedValue > 0.005
              ? `${formatCurrency(uncostedValue)} has no basis`
              : "All positions costed"
          }
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

      <Card className="p-0">
        <div className="flex items-center justify-between border-b border-line px-6 py-4">
          <span className="eyebrow">Portfolio value</span>
          <span className="text-xs text-[var(--faint)]">reconstructed from your trades</span>
        </div>
        <div className="px-3 py-5 sm:px-5">
          <ValueHistory data={portfolioSeries} kind="portfolio" benchmarks={benchmarks} />
        </div>
      </Card>

      <BenchmarkComparison comparison={comparison} />

      <AssetAllocation
        rows={allocRows}
        total={total}
        targets={allocationTargets}
        assetClassOverrides={assetClassOverrides}
        geographyOverrides={geographyOverrides}
        knownSectors={sectorOptions}
      />

      <SectorAllocation
        allocation={allocation}
        total={allocationTotal}
        activeSector={sectorFilter}
        onSelect={setSectorFilter}
      />

      <Card className="overflow-hidden p-0">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-line px-4 py-4 sm:px-6">
          <div className="flex items-center gap-3">
            <span className="eyebrow">Holdings</span>
            <StatusBadge status={status} />
          </div>
          <div className="flex items-center gap-3 sm:gap-4">
            {sectorFilter ? (
              <button
                onClick={() => setSectorFilter(null)}
                className="inline-flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-xs text-[var(--muted)] transition hover:text-[var(--paper)]"
              >
                <Tag size={11} />
                {sectorFilter}
                <span className="text-[var(--faint)]">·</span>
                {visible.length}
                <X size={11} />
              </button>
            ) : (
              <span className="text-xs text-[var(--muted)]">
                {holdings.length} {holdings.length === 1 ? "position" : "positions"}
              </span>
            )}
            {/* Column controls drive the table only; the mobile card view ignores them. */}
            <span className="hidden md:inline-flex">
              <ColumnsMenu visible={visibleCols} onToggle={toggleColumn} onReset={resetColumns} />
            </span>
            <AddManualHoldingButton />
          </div>
        </div>
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
            {items.map((it) =>
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
                  underlyingPrices={underlyingPrices}
                />
              ),
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
            {holdings.length > 0 && visible.length === 0 && (
              <tr>
                <td
                  colSpan={orderedCols.length + 2}
                  className="px-6 py-10 text-center text-[var(--muted)]"
                >
                  No holdings in {sectorFilter}.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        </div>
      </Card>

      {optionLegs.length > 0 && (
        <OptionsAnalytics
          legs={optionLegs}
          quotes={quotes}
          ivByOcc={ivByOcc}
          underlyingPrices={underlyingPrices}
          chainByUnderlying={chainByUnderlying}
          currency={optionLegs[0]?.currency ?? "USD"}
        />
      )}

      {dividendSummary && dividendSummary.payments.length > 0 && (
        <DividendPanel summary={dividendSummary} calendar={dividendCalendar} />
      )}
    </div>
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
              className="grid h-6 w-6 place-items-center rounded text-[var(--faint)] transition hover:text-[var(--paper)]"
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
            <span className="inline-flex items-center gap-2">
              <span className="font-medium text-[var(--brass)]">{h.ticker ?? "—"}</span>
              {isOptionable(h) && (
                <Link
                  href={`/investments/options/${encodeURIComponent(h.ticker as string)}`}
                  title={`Options desk for ${h.ticker}`}
                  className="inline-flex items-center gap-0.5 rounded border border-line px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-[var(--muted)] transition-colors hover:border-[var(--brass-dim)] hover:text-[var(--brass)]"
                >
                  Options
                  <ArrowUpRight size={10} />
                </Link>
              )}
              <span
                className="max-w-[240px] truncate text-[var(--muted)]"
                title={h.securityName ?? undefined}
              >
                {cleanSecurityName(h.securityName)}
              </span>
              {h.manual && (
                <span className="rounded border border-line px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-[var(--faint)]">
                  {h.securityType ?? "manual"}
                </span>
              )}
              {h.manual && (
                <span className="inline-flex items-center">
                  <EditManualHoldingButton
                    id={h.id}
                    name={h.securityName ?? h.ticker ?? "holding"}
                    isTickered={Boolean(h.ticker)}
                    quantity={h.quantity}
                    costBasis={h.costBasis}
                    value={h.value}
                    fromWallet={h.fromWallet}
                  />
                  {/* Wallet holdings are removed by disconnecting the wallet
                      (Accounts page), not per-row, so no delete here. */}
                  {!h.fromWallet && (
                    <DeleteManualHoldingButton
                      id={h.id}
                      name={h.securityName ?? h.ticker ?? "holding"}
                    />
                  )}
                </span>
              )}
              {!h.manual && (
                <span className="inline-flex items-center gap-1.5">
                  {h.hasOverride && (
                    <span
                      title="Cost basis manually corrected"
                      className="rounded border border-[var(--brass-dim)] px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-[var(--brass)]"
                    >
                      adj
                    </span>
                  )}
                  <EditCostBasisButton
                    holdingId={h.id}
                    name={h.securityName ?? h.ticker ?? "holding"}
                    quantity={h.quantity}
                    plaidCostBasis={h.plaidCostBasis ?? null}
                    overrideTotal={h.overrideTotal ?? null}
                    overrideUnit={h.overrideUnit ?? null}
                    overrideAsOf={h.overrideAsOf ?? null}
                    hasOverride={Boolean(h.hasOverride)}
                  />
                </span>
              )}
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

/** Shared "options →" chip used by the mobile holding cards. */
function OptionsChip({ ticker }: { ticker: string }) {
  return (
    <Link
      href={`/investments/options/${encodeURIComponent(ticker)}`}
      title={`Options desk for ${ticker}`}
      className="inline-flex items-center gap-0.5 rounded border border-line px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-[var(--muted)] transition-colors hover:border-[var(--brass-dim)] hover:text-[var(--brass)]"
    >
      options
      <ArrowUpRight size={10} />
    </Link>
  );
}

const signedColor = (n: number | null) =>
  n == null ? "text-[var(--faint)]" : n >= 0 ? "text-[var(--jade)]" : "text-[var(--coral)]";
const fmtPct = (n: number | null) => (n == null ? "—" : `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`);
const fmtSigned = (n: number | null, currency: string) =>
  n == null ? "—" : `${n >= 0 ? "+" : "−"}${formatMoney(Math.abs(n), currency)}`;

/** Metric row shared by the mobile cards: right value, colored day %, and a summary line. */
function MobileCardBody({ m }: { m: RowMetrics }) {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--muted)]">
      {m.qty != null && (
        <span>
          Qty <span className="mono text-[var(--paper)]/80">{m.qty.toLocaleString()}</span>
        </span>
      )}
      <span>
        P&amp;L <span className={`mono ${signedColor(m.pnl)}`}>{fmtSigned(m.pnl, m.currency)}</span>
      </span>
      <span className="mono">{m.weight.toFixed(1)}%</span>
    </div>
  );
}

/** Compact card for one holding — the mobile stand-in for the wide table row. */
function HoldingCardMobile({ h, m }: { h: HoldingRow; m: RowMetrics }) {
  return (
    <li className="px-4 py-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-[var(--brass)]">{h.ticker ?? "—"}</span>
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
            <span className="font-medium text-[var(--brass)]">{underlying}</span>
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
  underlyingPrices,
}: {
  underlying: string;
  legs: HoldingRow[];
  m: RowMetrics;
  columns: ColumnDef[];
  quotes: Record<string, LiveQuote>;
  underlyingPrices: Record<string, number>;
}) {
  const [expanded, setExpanded] = useState(false);

  const parsed = legs.map((h) => ({ h, p: parseOccSymbol(h.ticker)! }));
  const structures = classifyOptionLegs(
    parsed.map(({ h, p }) => ({ parsed: p, quantity: h.quantity, costBasis: h.costBasis })),
  );
  const currency = m.currency;

  const underlyingPrice =
    quotes[underlying.toUpperCase()]?.price ?? underlyingPrices[underlying] ?? null;

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
          <span className="grid h-6 w-6 place-items-center rounded text-[var(--faint)] transition group-hover:text-[var(--paper)]">
            <ChevronDown size={14} className={`transition-transform ${expanded ? "rotate-180" : ""}`} />
          </span>
        </td>
        <td className="py-3.5 pr-3 pl-1">
          <span className="inline-flex flex-wrap items-center gap-2">
            <span className="font-medium text-[var(--brass)]">{underlying}</span>
            <Link
              href={`/investments/options/${encodeURIComponent(underlying)}`}
              onClick={(e) => e.stopPropagation()}
              title={`Options desk for ${underlying}`}
              className="inline-flex items-center gap-0.5 rounded border border-line px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-[var(--muted)] transition-colors hover:border-[var(--brass-dim)] hover:text-[var(--brass)]"
            >
              options
              <ArrowUpRight size={10} />
            </Link>
            <span className="text-[var(--muted)]">{summary}</span>
            {Number.isFinite(soonestDte) && (
              <span
                className={`mono rounded px-1.5 py-0.5 text-[10px] ${
                  groupRisk === "expired" || groupRisk === "high"
                    ? "bg-[var(--coral)]/15 text-[var(--coral)]"
                    : groupRisk === "medium"
                      ? "bg-[var(--brass)]/15 text-[var(--brass)]"
                      : "text-[var(--faint)]"
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
          </td>
        </tr>
      )}
    </>
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
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-[var(--radius)] border border-line bg-[var(--panel)] shadow-[var(--elev-3)]">
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <div>
            <p className="text-sm font-medium">Unrealized gain breakdown</p>
            <p className="mt-0.5 text-xs text-[var(--muted)]">
              Per-holding P&amp;L (current value − cost basis)
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1 text-[var(--faint)] transition hover:text-[var(--paper)]"
          >
            <X size={16} />
          </button>
        </div>

        <div className="overflow-y-auto">
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
                    <td className={`mono px-5 py-2.5 text-right ${pnl != null ? color : "text-[var(--faint)]"}`}>
                      {pnl != null
                        ? `${pos ? "+" : "−"}${formatMoney(Math.abs(pnl), h.currency)}`
                        : "—"}
                    </td>
                    <td className={`mono px-5 py-2.5 text-right ${pct != null ? color : "text-[var(--faint)]"}`}>
                      {pct != null ? `${pos ? "+" : "−"}${Math.abs(pct).toFixed(1)}%` : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="border-t border-line px-5 py-4 text-sm">
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
      </div>
    </div>
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
      className="inline-flex w-fit items-center gap-1 rounded-full border border-dashed border-line px-2 py-0.5 text-[11px] text-[var(--faint)] transition hover:text-[var(--muted)]"
    >
      <Tag size={9} /> sector
    </button>
  );
}

/**
 * Allocation-by-sector panel: a labelled donut, a value-ranked bar chart, and a
 * breakdown table (value, % of portfolio, # holdings). Selecting any sector in
 * any of the three drives the shared drill-down filter on the holdings table.
 * All three recompute live from the same `allocation` (prices + sector edits).
 */
function SectorAllocation({
  allocation,
  total,
  activeSector,
  onSelect,
}: {
  allocation: SectorSlice[];
  total: number;
  activeSector: string | null;
  onSelect: (sector: string | null) => void;
}) {
  if (allocation.length === 0) return null;

  return (
    <Card className="p-0">
      <div className="flex items-center justify-between border-b border-line px-6 py-4">
        <span className="eyebrow">Allocation by sector</span>
        {activeSector && (
          <button
            onClick={() => onSelect(null)}
            className="inline-flex items-center gap-1 text-xs text-[var(--muted)] transition hover:text-[var(--paper)]"
          >
            <Check size={11} /> {activeSector} <X size={11} />
          </button>
        )}
      </div>
      <div className="grid gap-8 px-6 py-6 lg:grid-cols-2">
        <AllocationDonut
          data={allocation}
          total={total}
          activeSector={activeSector}
          onSelect={onSelect}
        />
        <div className="min-w-0">
          <p className="eyebrow mb-3">Ranked by value</p>
          <SectorBarChart data={allocation} activeSector={activeSector} onSelect={onSelect} />
        </div>
      </div>
      <div className="overflow-x-auto border-t border-line">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left">
              {["Sector", "Value", "% of portfolio", "Holdings"].map((h, i) => (
                <th
                  key={h}
                  className={`px-6 py-2.5 eyebrow font-medium ${i >= 1 ? "text-right" : ""}`}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {allocation.map((d) => {
              const pct = total ? (d.value / total) * 100 : 0;
              const active = d.sector === activeSector;
              return (
                <tr
                  key={d.sector}
                  onClick={() => onSelect(active ? null : d.sector)}
                  className={`cursor-pointer border-b border-line/60 last:border-0 transition-colors hover:bg-[var(--panel-2)] ${
                    active ? "bg-[var(--panel-2)]" : ""
                  }`}
                >
                  <td className="px-6 py-2.5">
                    <span className="inline-flex items-center gap-2.5">
                      <span
                        className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
                        style={{ background: d.color }}
                      />
                      <span className={active ? "text-[var(--paper)]" : "text-[var(--muted)]"}>
                        {d.sector}
                      </span>
                    </span>
                  </td>
                  <td className="mono px-6 py-2.5 text-right">{formatCurrency(d.value)}</td>
                  <td className="mono px-6 py-2.5 text-right text-[var(--muted)]">
                    {pct.toFixed(1)}%
                  </td>
                  <td className="mono px-6 py-2.5 text-right text-[var(--muted)]">{d.count}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/**
 * Compact out/under-performance table: one row per time window comparing the
 * portfolio's return to SPY and QQQ, with the delta colored jade when the
 * portfolio outperformed and coral when it lagged. Hidden until there's at
 * least one window's worth of comparison data.
 */
function BenchmarkComparison({ comparison }: { comparison: ComparisonRow[] }) {
  if (comparison.length === 0) return null;

  const pct = (v: number | null) =>
    v == null ? "—" : `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(1)}%`;

  const WINDOW_LABEL: Record<ComparisonRow["window"], string> = {
    "1M": "1 month",
    "3M": "3 months",
    "6M": "6 months",
    "1Y": "1 year",
    YTD: "Year to date",
  };

  return (
    <Card className="p-0">
      <div className="flex items-center justify-between border-b border-line px-6 py-4">
        <span className="eyebrow">Return vs benchmarks</span>
        <span className="text-xs text-[var(--faint)]">portfolio return vs SPY &amp; QQQ</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] text-sm">
          <thead>
            <tr className="border-b border-line text-left">
              {["Window", "Portfolio", "SPY", "QQQ", "Δ vs SPY", "Δ vs QQQ"].map((h, i) => (
                <th
                  key={h}
                  className={`px-6 py-2.5 eyebrow font-medium ${i >= 1 ? "text-right" : ""}`}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {comparison.map((r) => {
              const pColor =
                r.portfolioPct == null
                  ? "text-[var(--faint)]"
                  : r.portfolioPct >= 0
                    ? "text-[var(--jade)]"
                    : "text-[var(--coral)]";
              const delta = (v: number | null) => (
                <td
                  className={`mono px-6 py-2.5 text-right ${
                    v == null
                      ? "text-[var(--faint)]"
                      : v >= 0
                        ? "text-[var(--jade)]"
                        : "text-[var(--coral)]"
                  }`}
                >
                  {pct(v)}
                </td>
              );
              return (
                <tr key={r.window} className="border-b border-line/60 last:border-0">
                  <td className="px-6 py-2.5 text-[var(--muted)]">{WINDOW_LABEL[r.window]}</td>
                  <td className={`mono px-6 py-2.5 text-right ${pColor}`}>{pct(r.portfolioPct)}</td>
                  <td className="mono px-6 py-2.5 text-right text-[var(--muted)]">{pct(r.spyPct)}</td>
                  <td className="mono px-6 py-2.5 text-right text-[var(--muted)]">{pct(r.qqqPct)}</td>
                  {delta(r.deltaVsSpy)}
                  {delta(r.deltaVsQqq)}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
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
        <span className={active ? "text-[var(--brass)]" : "text-[var(--faint)]"}>
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
    <td key={key} className={`${numRight} text-[var(--faint)]`}>
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
                  <span className="text-[var(--faint)]">—</span>
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
    return <td className="mono px-3 py-3.5 text-right text-[var(--faint)]">—</td>;
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
    <td className="mono px-3 py-3.5 text-right text-[var(--muted)]">
      <span className="inline-flex items-center justify-end gap-2">
        <span className="hidden h-1 w-10 overflow-hidden rounded-full bg-[var(--line)] sm:inline-block">
          <span
            className="block h-full rounded-full bg-[var(--brass-dim)]"
            style={{ width: `${w}%` }}
          />
        </span>
        {pct.toFixed(1)}%
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
              className="text-[10px] uppercase tracking-wide text-[var(--faint)] transition hover:text-[var(--brass)]"
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
    return <td className="mono px-3 py-3.5 text-right text-[var(--faint)]">—</td>;
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
    return <td className="mono px-3 py-3.5 text-right text-[var(--faint)]">—</td>;
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

function Stat({
  label,
  value,
  big,
  signed,
  pct,
  hint,
  detail,
  detailTitle,
  onClick,
}: {
  label: string;
  value: number;
  big?: boolean;
  signed?: boolean;
  pct?: number;
  hint?: string;
  detail?: string;
  detailTitle?: string;
  onClick?: () => void;
}) {
  const positive = value >= 0;
  const color = signed ? (positive ? "text-[var(--jade)]" : "text-[var(--coral)]") : "";
  const body = (
    <>
      <div className="flex items-center justify-between">
        <p className="eyebrow">{label}</p>
        {hint && onClick && (
          <span className="text-[10px] text-[var(--faint)] transition-colors group-hover:text-[var(--brass)]">
            {hint} →
          </span>
        )}
      </div>
      <p className={`mt-2 font-display tabular ${big ? "text-4xl" : "text-3xl"} ${color}`}>
        {signed && positive ? "+" : ""}
        {formatCurrency(value)}
      </p>
      {signed && pct !== undefined && (
        <p className={`mono mt-1 text-sm ${color}`}>
          {positive ? "+" : "−"}
          {Math.abs(pct).toFixed(2)}%
        </p>
      )}
      {detail && (
        <p
          className={`mt-1 text-xs text-[var(--muted)]${detailTitle ? " cursor-help" : ""}`}
          title={detailTitle}
        >
          {detail}
        </p>
      )}
    </>
  );

  if (onClick) {
    return (
      <Card
        interactive
        role="button"
        tabIndex={0}
        onClick={onClick}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onClick();
          }
        }}
        className="group text-left hover:bg-[var(--panel-2)] focus:outline-none focus:ring-1 focus:ring-[var(--brass-dim)]"
      >
        {body}
      </Card>
    );
  }
  return <Card>{body}</Card>;
}
