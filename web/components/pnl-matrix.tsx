"use client";

/**
 * P/L heatmap — the signature OptionStrat grid. Columns are dates from today to
 * expiry, rows are underlying prices (high at top); each cell is the position's
 * Black-Scholes P&L, coloured jade (profit) → coral (loss) by magnitude. A `mode`
 * switches the readout between dollars and return-on-capital %. Hovering a cell
 * shows an exact readout above the grid. Pure CSS grid, theme-aware, scrollable.
 */

import { useMemo, useState } from "react";
import { formatStrike } from "@/lib/options";
import type { PnlMatrix as PnlMatrixData } from "@/lib/strategy-value";

export type MatrixMode = "pnl" | "pct";

function money(n: number, currency: string): string {
  const s = n < 0 ? "−" : "";
  const abs = Math.abs(n);
  const sym = currency === "USD" ? "$" : "";
  if (abs >= 1000) return `${s}${sym}${(abs / 1000).toFixed(abs >= 10000 ? 0 : 1)}k`;
  return `${s}${sym}${abs.toFixed(0)}`;
}

function pct(pnl: number, capital: number): string {
  if (!(capital > 0)) return "—";
  const r = (pnl / capital) * 100;
  const s = r < 0 ? "−" : "+";
  return `${s}${Math.abs(r).toFixed(0)}%`;
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
  mode = "pnl",
  capital = 0,
}: {
  matrix: PnlMatrixData;
  dte: number;
  spot: number;
  breakevens?: number[];
  currency?: string;
  mode?: MatrixMode;
  capital?: number;
}) {
  const { prices, days, cells, maxAbs } = matrix;
  const [hover, setHover] = useState<{ i: number; j: number } | null>(null);

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

  const show = (pnl: number) => (mode === "pct" ? pct(pnl, capital) : money(pnl, currency));

  function cellStyle(pnl: number): React.CSSProperties {
    const t = maxAbs > 0 ? Math.min(1, Math.abs(pnl) / maxAbs) : 0;
    const tint = (6 + t * 62).toFixed(0); // 6%..68% keeps text legible
    const hue = pnl >= 0 ? "var(--jade)" : "var(--coral)";
    return { background: `color-mix(in srgb, ${hue} ${tint}%, transparent)` };
  }

  const cols = `44px repeat(${days.length}, minmax(38px, 1fr))`;
  const hoveredPnl = hover ? cells[hover.i][hover.j] : null;

  return (
    <div>
      {/* Hover readout — persistent line so the grid doesn't jump */}
      <div className="mb-2 h-4 text-[11px] text-[var(--muted)]">
        {hover ? (
          <span className="mono">
            {formatStrike(Number(prices[hover.i].toFixed(2)))} · {dayLabel(days[hover.j], dte)} ·{" "}
            <span className={hoveredPnl! >= 0 ? "text-[var(--jade)]" : "text-[var(--coral)]"}>
              {money(hoveredPnl!, currency)}
              {capital > 0 && <span className="text-[var(--faint)]"> · {pct(hoveredPnl!, capital)}</span>}
            </span>
          </span>
        ) : (
          <span className="text-[var(--faint)]">Hover a cell for its price, date &amp; P&amp;L</span>
        )}
      </div>

      <div className="overflow-x-auto">
        <div className="min-w-[440px]">
          <div className="grid gap-px" style={{ gridTemplateColumns: cols }} onMouseLeave={() => setHover(null)}>
            {prices
              .map((_, i) => i)
              .reverse()
              .map((i) => {
                const price = prices[i];
                const isSpot = i === spotRow;
                const isBe = beRows.has(i);
                return (
                  <div className="contents" key={i}>
                    <div
                      className={`flex items-center justify-end pr-1.5 font-mono text-[10px] tabular-nums ${
                        isSpot ? "font-semibold text-[var(--paper)]" : isBe ? "text-[var(--brass)]" : "text-[var(--muted)]"
                      }`}
                    >
                      {formatStrike(Number(price.toFixed(price < 25 ? 1 : 0)))}
                    </div>
                    {days.map((_, j) => {
                      const pnl = cells[i][j];
                      const isHover = hover?.i === i && hover?.j === j;
                      return (
                        <div
                          key={j}
                          onMouseEnter={() => setHover({ i, j })}
                          className={`grid h-6 cursor-crosshair place-items-center font-mono text-[9px] tabular-nums ${
                            pnl >= 0 ? "text-[var(--jade)]" : "text-[var(--coral)]"
                          } ${
                            isHover
                              ? "outline outline-2 -outline-offset-1 outline-[var(--paper)]"
                              : isSpot
                                ? "outline outline-1 -outline-offset-1 outline-[var(--paper)]/40"
                                : ""
                          }`}
                          style={cellStyle(pnl)}
                        >
                          {show(pnl)}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
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
    </div>
  );
}
