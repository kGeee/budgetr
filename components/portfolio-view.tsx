"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { PortfolioChart, Sparkline } from "@/components/charts";
import { formatCurrency } from "@/lib/utils";
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
};

type PricePoint = { date: string; close: number };

export function PortfolioView({
  holdings,
  histories = {},
  portfolioSeries = [],
}: {
  holdings: HoldingRow[];
  histories?: Record<string, PricePoint[]>;
  portfolioSeries?: { date: string; value: number }[];
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

function PortfolioInner({
  holdings,
  histories,
  portfolioSeries,
}: {
  holdings: HoldingRow[];
  histories: Record<string, PricePoint[]>;
  portfolioSeries: { date: string; value: number }[];
}) {
  const { quotes, status } = useLivePrices();

  const total = holdings.reduce((s, h) => s + effectiveValue(h, quotes), 0);
  const totalCost = holdings.reduce((s, h) => s + (h.costBasis ?? 0), 0);
  const gain = total - totalCost;
  const gainPct = totalCost !== 0 ? (gain / totalCost) * 100 : 0;

  return (
    <div className="space-y-7">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat label="Market value" value={total} big />
        <Stat label="Cost basis" value={totalCost} />
        <Stat label="Unrealized gain" value={gain} signed pct={gainPct} />
      </div>

      <Card className="p-0">
        <div className="flex items-center justify-between border-b border-line px-6 py-4">
          <span className="eyebrow">Portfolio value · 12 mo</span>
          <span className="text-xs text-[var(--faint)]">
            today&apos;s holdings at historical closes
          </span>
        </div>
        <div className="px-3 py-5 sm:px-5">
          <PortfolioChart data={portfolioSeries} />
        </div>
      </Card>

      <Card className="overflow-hidden p-0">
        <div className="flex items-center justify-between border-b border-line px-6 py-4">
          <div className="flex items-center gap-3">
            <span className="eyebrow">Holdings</span>
            <StatusBadge status={status} />
          </div>
          <span className="text-xs text-[var(--muted)]">
            {holdings.length} {holdings.length === 1 ? "position" : "positions"}
          </span>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left">
              {["Security", "Account", "Trend", "Qty", "Price", "Day", "Value"].map((h, i) => (
                <th
                  key={h}
                  className={`px-6 py-3.5 eyebrow font-medium ${i >= 3 ? "text-right" : ""}`}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {holdings.map((h) => {
              const price = effectivePrice(h, quotes);
              const value = effectiveValue(h, quotes);
              const dayPct = dayChangePct(h, quotes);
              const currency = h.currency ?? "USD";
              const history = h.ticker ? histories[h.ticker.toUpperCase()] : undefined;
              return (
                <tr
                  key={h.id}
                  className="border-b border-line/60 last:border-0 transition-colors hover:bg-[var(--panel-2)]"
                >
                  <td className="px-6 py-3.5">
                    <span className="font-medium text-[var(--brass)]">{h.ticker ?? "—"}</span>
                    <span className="ml-2 text-[var(--muted)]">{h.securityName}</span>
                  </td>
                  <td className="px-6 py-3.5 text-[var(--muted)]">{h.accountName}</td>
                  <td className="px-6 py-2">
                    {history && history.length > 1 ? (
                      <Sparkline data={history} />
                    ) : (
                      <span className="text-[var(--faint)]">—</span>
                    )}
                  </td>
                  <td className="mono px-6 py-3.5 text-right text-[var(--muted)]">
                    {h.quantity?.toLocaleString()}
                  </td>
                  <PriceCell price={price ?? 0} currency={currency} />
                  <DayCell pct={dayPct} />
                  <td className="mono px-6 py-3.5 text-right">
                    {formatCurrency(value, currency)}
                  </td>
                </tr>
              );
            })}
            {holdings.length === 0 && (
              <tr>
                <td colSpan={7} className="px-6 py-10 text-center text-[var(--muted)]">
                  No holdings yet. Connect a brokerage account and hit Sync.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
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
      className={`mono px-6 py-3.5 text-right transition-colors duration-200 ${color}`}
    >
      {formatCurrency(price, currency)}
    </td>
  );
}

/** Day-change cell: green/red signed percent, or a dash when we have no quote. */
function DayCell({ pct }: { pct: number | null }) {
  if (pct == null) {
    return <td className="mono px-6 py-3.5 text-right text-[var(--faint)]">—</td>;
  }
  const positive = pct >= 0;
  const color = positive ? "text-[var(--jade)]" : "text-[var(--coral)]";
  return (
    <td className={`mono px-6 py-3.5 text-right ${color}`}>
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
}: {
  label: string;
  value: number;
  big?: boolean;
  signed?: boolean;
  pct?: number;
}) {
  const positive = value >= 0;
  const color = signed ? (positive ? "text-[var(--jade)]" : "text-[var(--coral)]") : "";
  return (
    <Card>
      <p className="eyebrow">{label}</p>
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
    </Card>
  );
}
