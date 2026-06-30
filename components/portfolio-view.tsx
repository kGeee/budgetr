"use client";

import { useEffect, useId, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronDown, Pencil, Tag, X } from "lucide-react";
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
  EditManualHoldingButton,
} from "@/components/manual-holding-dialog";
import { setHoldingSector } from "@/lib/actions";
import { formatCurrency } from "@/lib/utils";
import type { InvestmentTxnRow } from "@/lib/queries";

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
  /** Symbol-scoped key the sector assignment is stored under (see sectorKeyFor). */
  sectorKey: string;
  /** Currently assigned sector, or null when untagged. */
  sector?: string | null;
};

type PricePoint = { date: string; close: number };

export function PortfolioView({
  holdings,
  histories = {},
  portfolioSeries = [],
  transactions = [],
  knownSectors = [],
}: {
  holdings: HoldingRow[];
  histories?: Record<string, PricePoint[]>;
  portfolioSeries?: { date: string; value: number }[];
  transactions?: InvestmentTxnRow[];
  knownSectors?: string[];
}) {
  const symbols = useMemo(
    () => holdings.map((h) => h.ticker).filter((t): t is string => Boolean(t)),
    [holdings],
  );

  return (
    <LivePricesProvider symbols={symbols}>
      <PortfolioInner
        holdings={holdings}
        histories={histories}
        portfolioSeries={portfolioSeries}
        transactions={transactions}
        knownSectors={knownSectors}
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

type SortKey = "value" | "pnl";

function PortfolioInner({
  holdings,
  histories,
  portfolioSeries,
  transactions,
  knownSectors,
}: {
  holdings: HoldingRow[];
  histories: Record<string, PricePoint[]>;
  portfolioSeries: { date: string; value: number }[];
  transactions: InvestmentTxnRow[];
  knownSectors: string[];
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

  // Sort by the chosen metric. Holdings without P&L (no cost basis) sink to the
  // bottom regardless of direction.
  const sorted = useMemo(() => {
    const metric = (h: HoldingRow): number => {
      if (sortKey === "pnl") return effectivePnl(h, quotes) ?? Number.NEGATIVE_INFINITY;
      return effectiveValue(h, quotes);
    };
    const dir = sortDir === "desc" ? -1 : 1;
    return [...holdings].sort((a, b) => {
      const av = metric(a);
      const bv = metric(b);
      if (av === bv) return 0;
      // Keep no-P&L rows last in both directions.
      if (av === Number.NEGATIVE_INFINITY) return 1;
      if (bv === Number.NEGATIVE_INFINITY) return -1;
      return (av - bv) * dir;
    });
  }, [holdings, quotes, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (key === sortKey) setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  const total = holdings.reduce((s, h) => s + effectiveValue(h, quotes), 0);
  // Unrealized gain only spans holdings with a known cost basis — otherwise a
  // position's whole value would masquerade as gain. This keeps the headline in
  // lockstep with the sum of the per-row P&L (which is "—" for no-basis rows).
  const costed = holdings.filter((h) => h.costBasis != null);
  const totalCost = costed.reduce((s, h) => s + (h.costBasis ?? 0), 0);
  const costedValue = costed.reduce((s, h) => s + effectiveValue(h, quotes), 0);
  const gain = costedValue - totalCost;
  const gainPct = totalCost !== 0 ? (gain / totalCost) * 100 : 0;
  const uncostedValue = total - costedValue;

  // Holdings shown in the table, narrowed to the drilled-into sector if any.
  const visible = sectorFilter
    ? sorted.filter((h) => (sectorOf(h) ?? UNASSIGNED) === sectorFilter)
    : sorted;

  return (
    <div className="space-y-7">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat label="Market value" value={total} big />
        <Stat label="Cost basis" value={totalCost} />
        <Stat
          label="Unrealized gain"
          value={gain}
          signed
          pct={gainPct}
          hint="View breakdown"
          onClick={() => setShowBreakdown(true)}
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

      <SectorAllocation
        allocation={allocation}
        total={allocationTotal}
        activeSector={sectorFilter}
        onSelect={setSectorFilter}
      />

      <Card className="p-0">
        <div className="flex items-center justify-between border-b border-line px-6 py-4">
          <span className="eyebrow">Portfolio value</span>
          <span className="text-xs text-[var(--faint)]">reconstructed from your trades</span>
        </div>
        <div className="px-3 py-5 sm:px-5">
          <ValueHistory data={portfolioSeries} kind="portfolio" />
        </div>
      </Card>

      <Card className="overflow-hidden p-0">
        <div className="flex items-center justify-between border-b border-line px-6 py-4">
          <div className="flex items-center gap-3">
            <span className="eyebrow">Holdings</span>
            <StatusBadge status={status} />
          </div>
          <div className="flex items-center gap-4">
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
            <AddManualHoldingButton />
          </div>
        </div>
        <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="border-b border-line text-left">
              <th className="w-8" aria-hidden />
              {["Security", "Account", "Trend", "Qty", "Price", "Day"].map((h, i) => (
                <th
                  key={h}
                  className={`py-3.5 eyebrow font-medium ${i === 0 ? "pr-3" : "px-3"} ${i >= 3 ? "text-right" : ""}`}
                >
                  {h}
                </th>
              ))}
              <SortHeader
                label="Value"
                active={sortKey === "value"}
                dir={sortDir}
                onClick={() => toggleSort("value")}
              />
              <SortHeader
                label="P&L"
                active={sortKey === "pnl"}
                dir={sortDir}
                onClick={() => toggleSort("pnl")}
              />
            </tr>
          </thead>
          <tbody>
            {visible.map((h) => {
              const sym = h.ticker?.toUpperCase();
              return (
                <HoldingRowView
                  key={h.id}
                  h={h}
                  quotes={quotes}
                  history={sym ? histories[sym] : undefined}
                  txns={sym ? txnsByTicker[sym] ?? [] : []}
                  sector={sectorOf(h)}
                  sectorOptions={sectorOptions}
                  onSetSector={(name) => setSector(h.sectorKey, name)}
                  sectorColor={sectorColor}
                />
              );
            })}
            {holdings.length === 0 && (
              <tr>
                <td colSpan={9} className="px-6 py-10 text-center text-[var(--muted)]">
                  No holdings yet. Connect a brokerage account and hit Sync.
                </td>
              </tr>
            )}
            {holdings.length > 0 && visible.length === 0 && (
              <tr>
                <td colSpan={9} className="px-6 py-10 text-center text-[var(--muted)]">
                  No holdings in {sectorFilter}.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        </div>
      </Card>
    </div>
  );
}

/** A holding row plus, when expanded, its full price-history + trades panel. */
function HoldingRowView({
  h,
  quotes,
  history,
  txns,
  sector,
  sectorOptions,
  onSetSector,
  sectorColor,
}: {
  h: HoldingRow;
  quotes: Record<string, LiveQuote>;
  history?: PricePoint[];
  txns: InvestmentTxnRow[];
  sector: string | null;
  sectorOptions: string[];
  onSetSector: (sector: string | null) => void;
  sectorColor: Record<string, string>;
}) {
  const [expanded, setExpanded] = useState(false);
  const price = effectivePrice(h, quotes);
  const value = effectiveValue(h, quotes);
  const dayPct = dayChangePct(h, quotes);
  const pnl = effectivePnl(h, quotes);
  const pnlPct = pnl != null && h.costBasis ? (pnl / h.costBasis) * 100 : null;
  const currency = h.currency ?? "USD";
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
              <span className="text-[var(--muted)]">{h.securityName}</span>
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
                  />
                  <DeleteManualHoldingButton
                    id={h.id}
                    name={h.securityName ?? h.ticker ?? "holding"}
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
        <td className="px-3 py-3.5 text-[var(--muted)]">{h.accountName}</td>
        <td className="px-3 py-2">
          {history && history.length > 1 ? (
            <Sparkline data={history} />
          ) : (
            <span className="text-[var(--faint)]">—</span>
          )}
        </td>
        <td className="mono px-3 py-3.5 text-right text-[var(--muted)]">
          {h.quantity?.toLocaleString()}
        </td>
        <PriceCell price={price ?? 0} currency={currency} />
        <DayCell pct={dayPct} />
        <td className="mono px-3 py-3.5 text-right">{formatCurrency(value, currency)}</td>
        <PnlCell pnl={pnl} pct={pnlPct} currency={currency} />
      </tr>
      {expanded && canExpand && (
        <tr className="border-b border-line/60 bg-[var(--panel-2)]/40">
          <td colSpan={9} className="px-4 py-5 sm:px-6">
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
                    {t.price != null ? formatCurrency(t.price, t.currency ?? currency) : "—"}
                  </td>
                  <td className="mono px-5 py-2.5 text-right">
                    {t.amount != null ? formatCurrency(t.amount, t.currency ?? currency) : "—"}
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
      {formatCurrency(price, currency)}
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
                      <span className="ml-2 text-[var(--muted)]">{h.securityName}</span>
                    </td>
                    <td className="mono px-5 py-2.5 text-right">
                      {formatCurrency(value, h.currency ?? "USD")}
                    </td>
                    <td className="mono px-5 py-2.5 text-right text-[var(--muted)]">
                      {cost != null ? formatCurrency(cost, h.currency ?? "USD") : "—"}
                    </td>
                    <td className={`mono px-5 py-2.5 text-right ${pnl != null ? color : "text-[var(--faint)]"}`}>
                      {pnl != null
                        ? `${pos ? "+" : "−"}${formatCurrency(Math.abs(pnl), h.currency ?? "USD")}`
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

/** Clickable, right-aligned column header that drives the holdings sort. */
function SortHeader({
  label,
  active,
  dir,
  onClick,
}: {
  label: string;
  active: boolean;
  dir: "asc" | "desc";
  onClick: () => void;
}) {
  return (
    <th className="px-3 py-3.5 text-right eyebrow font-medium">
      <button
        onClick={onClick}
        className={`inline-flex items-center gap-1 transition-colors hover:text-[var(--paper)] ${
          active ? "text-[var(--paper)]" : ""
        }`}
      >
        {label}
        <span className={active ? "text-[var(--brass)]" : "text-[var(--faint)]"}>
          {active ? (dir === "desc" ? "↓" : "↑") : "↕"}
        </span>
      </button>
    </th>
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
        {formatCurrency(Math.abs(pnl), currency)}
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
  onClick,
}: {
  label: string;
  value: number;
  big?: boolean;
  signed?: boolean;
  pct?: number;
  hint?: string;
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
