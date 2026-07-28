"use client";

/**
 * P/L heatmap — the signature OptionStrat grid. Columns are dates from today to
 * expiry, rows are underlying prices (high at top); each cell is the position's
 * Black-Scholes P&L, coloured jade (profit) → coral (loss) by magnitude. Lets you
 * see at a glance how the trade decays and where it turns green. Pure CSS grid,
 * theme-aware, horizontally scrollable on small screens.
 */

import { useMemo } from "react";
import { formatStrike } from "@/lib/options";
import type { PnlMatrix } from "@/lib/strategy-value";

function compact(n: number, currency: string): string {
  const s = n < 0 ? "−" : "";
  const abs = Math.abs(n);
  if (abs >= 1000) return `${s}${currency === "USD" ? "$" : ""}${(abs / 1000).toFixed(abs >= 10000 ? 0 : 1)}k`;
  return `${s}${currency === "USD" ? "$" : ""}${abs.toFixed(0)}`;
}

function dayLabel(d: number, dte: number): string {
  if (d <= 0) return "Now";
  if (d >= dte) return "Exp";
  return `${d}d`;
}

export function PnlMatrix({
  matrix,
  dte,
  spot,
  breakevens = [],
  currency = "USD",
}: {
  matrix: PnlMatrix;
  dte: number;
  spot: number;
  breakevens?: number[];
  currency?: string;
}) {
  const { prices, days, cells, maxAbs } = matrix;

  // Row index closest to spot, so we can flag "where price is now".
  const spotRow = useMemo(() => {
    let best = 0;
    for (let i = 1; i < prices.length; i++) {
      if (Math.abs(prices[i] - spot) < Math.abs(prices[best] - spot)) best = i;
    }
    return best;
  }, [prices, spot]);

  const beRows = useMemo(() => {
    const rows = new Set<number>();
    for (const be of breakevens) {
      let best = 0;
      for (let i = 1; i < prices.length; i++) {
        if (Math.abs(prices[i] - be) < Math.abs(prices[best] - be)) best = i;
      }
      rows.add(best);
    }
    return rows;
  }, [prices, breakevens]);

  function cellStyle(pnl: number): React.CSSProperties {
    const t = maxAbs > 0 ? Math.min(1, Math.abs(pnl) / maxAbs) : 0;
    const pct = (6 + t * 62).toFixed(0); // 6%..68% tint keeps text legible
    const hue = pnl >= 0 ? "var(--jade)" : "var(--coral)";
    return { background: `color-mix(in srgb, ${hue} ${pct}%, transparent)` };
  }

  const cols = `44px repeat(${days.length}, minmax(38px, 1fr))`;

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[440px]">
        {/* rows top→bottom = highest price first */}
        <div className="grid gap-px" style={{ gridTemplateColumns: cols }}>
          {prices
            .map((price, i) => i)
            .reverse()
            .map((i) => {
              const price = prices[i];
              const isSpot = i === spotRow;
              const isBe = beRows.has(i);
              return (
                <div className="contents" key={i}>
                  <div
                    className={`flex items-center justify-end pr-1.5 font-mono text-[10px] tabular-nums ${
                      isSpot ? "font-semibold text-[var(--paper)]" : "text-[var(--muted)]"
                    }`}
                  >
                    {formatStrike(Number(price.toFixed(price < 25 ? 1 : 0)))}
                  </div>
                  {days.map((d, j) => {
                    const pnl = cells[i][j];
                    return (
                      <div
                        key={j}
                        title={`${formatStrike(Number(price.toFixed(2)))} · ${dayLabel(d, dte)} · ${compact(pnl, currency)}`}
                        className={`grid h-6 place-items-center font-mono text-[9px] tabular-nums ${
                          pnl >= 0 ? "text-[var(--jade)]" : "text-[var(--coral)]"
                        } ${isSpot ? "outline outline-1 -outline-offset-1 outline-[var(--paper)]/50" : ""}`}
                        style={cellStyle(pnl)}
                      >
                        <span className={isBe ? "opacity-95" : "opacity-90"}>{compact(pnl, currency)}</span>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          {/* date axis */}
          <div />
          {days.map((d, j) => (
            <div
              key={j}
              className={`pt-1 text-center text-[9px] uppercase tracking-wide ${
                d >= dte ? "text-[var(--brass)]" : "text-[var(--faint)]"
              }`}
            >
              {dayLabel(d, dte)}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
