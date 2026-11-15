"use client";

/**
 * Risk analysis on the Investments › Allocation tab — portfolio risk +
 * per-holding technicals/fundamentals for calmer, more structured decisions.
 * The risk/return scatter (beside Sector exposure), then a sortable per-holding
 * signals table and the correlation matrix of the biggest positions. Portfolio
 * KPIs (beta, concentration) are in the tab's hero line. All data is prepared server-side in
 * lib/analysis-data.ts; this only visualizes it.
 */

import { useMemo, useState } from "react";
import { CartesianGrid, LabelList, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis, Cell } from "recharts";
import type { TooltipProps } from "recharts";
import { AlertTriangle } from "lucide-react";
import { ruled } from "@/components/portfolio/ruled";
import { useChartTheme } from "@/lib/chart-theme";
import { formatCurrency } from "@/lib/utils";
import type { AnalysisData, HoldingAnalytics } from "@/lib/analysis-data";

const money = (n: number) => formatCurrency(n, "USD", { maximumFractionDigits: 0 });
const pct = (n: number | null, d = 1) => (n == null ? "—" : `${n >= 0 ? "" : "−"}${Math.abs(n).toFixed(d)}%`);
const num = (n: number | null, d = 2) => (n == null ? "—" : n.toFixed(d));

function compactCap(n: number | null): string {
  if (n == null) return "—";
  if (n >= 1e12) return `$${(n / 1e12).toFixed(1)}T`;
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(0)}M`;
  return money(n);
}

type SortKey = "value" | "weightPct" | "rsi" | "realizedVol" | "beta" | "mom3m" | "peTtm" | "ivRank" | "return1y";

/**
 * Risk vs. return: one bubble per holding, 1-year return against realized
 * volatility, sized by weight. Sits beside Sector exposure on the tab.
 */
export function RiskReturn({ data }: { data: AnalysisData }) {
  const t = useChartTheme();

  // Clamp to a readable window so one meme-stock outlier (100%+ vol, 200%+
  // return) doesn't compress everything else into the corner. Raw values still
  // show in the tooltip; clamped points sit on the edge.
  const X_MAX = 80;
  const Y_MIN = -60;
  const Y_MAX = 120;
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  // Naming forty bubbles makes soup; the largest positions carry their ticker
  // and the rest answer on hover.
  const labelled = new Set(
    [...data.holdings]
      .sort((a, b) => b.weightPct - a.weightPct)
      .slice(0, 8)
      .map((h) => h.ticker),
  );
  const scatter = data.holdings
    .filter((h) => h.realizedVol != null && h.return1y != null)
    .map((h) => ({
      ticker: h.ticker,
      label: labelled.has(h.ticker) ? h.ticker : "",
      x: clamp(h.realizedVol!, 0, X_MAX),
      y: clamp(h.return1y!, Y_MIN, Y_MAX),
      z: h.weightPct,
      rawX: h.realizedVol!,
      rawY: h.return1y!,
    }));

  return (
    <section aria-label="Risk versus return" className="flex min-w-0 flex-col gap-3">
      <SectionIntro
        title="Risk vs. return"
        note="1-year return against realized volatility; bubble size = weight."
      />
      {scatter.length === 0 ? (
        <p className="py-8 text-sm text-[var(--muted)]">
          No equity holdings with a year of prices to plot yet.
        </p>
      ) : (
        <ResponsiveContainer width="100%" height={260}>
          <ScatterChart margin={{ top: 14, right: 12, bottom: 20, left: 4 }}>
            <CartesianGrid stroke={t.grid} vertical={false} />
            <XAxis type="number" dataKey="x" name="Volatility" unit="%" domain={[0, X_MAX]} tick={t.tick} label={{ value: "Volatility", position: "insideBottom", offset: -8, fill: t.muted, fontSize: 11 }} />
            <YAxis type="number" dataKey="y" name="Return" unit="%" domain={[Y_MIN, Y_MAX]} tick={t.tick} />
            <ZAxis type="number" dataKey="z" range={[40, 400]} />
            <Tooltip cursor={{ strokeDasharray: "3 3", stroke: t.grid }} content={<ScatterTip />} />
            <Scatter data={scatter} isAnimationActive={false}>
              {scatter.map((d) => (
                <Cell key={d.ticker} fill={d.y >= 0 ? t.jade : t.coral} fillOpacity={0.25} stroke={d.y >= 0 ? t.jade : t.coral} strokeWidth={1.5} />
              ))}
              <LabelList dataKey="label" position="top" fill={t.muted} fontSize={10} />
            </Scatter>
          </ScatterChart>
        </ResponsiveContainer>
      )}
    </section>
  );
}

/**
 * Per-holding signals, then the correlation matrix of the biggest positions.
 * All data is prepared server-side in lib/analysis-data.ts; this only draws it.
 */
export function RiskSignals({ data }: { data: AnalysisData }) {
  const [sort, setSort] = useState<SortKey>("value");

  const rows = useMemo(() => {
    const val = (h: HoldingAnalytics) => {
      const v = h[sort];
      return typeof v === "number" ? v : -Infinity;
    };
    return [...data.holdings].sort((a, b) => val(b) - val(a));
  }, [data.holdings, sort]);

  if (data.holdings.length === 0) {
    return (
      <p className="border-t border-line pt-4 text-sm text-[var(--muted)]">
        No equity holdings to analyze yet. Connect a brokerage or add holdings, then this fills in.
      </p>
    );
  }

  return (
    <div className="space-y-9">
      <section aria-label="Position signals" className="space-y-3">
        {!data.fundamentalsAvailable && (
          <p className="flex items-center gap-2 text-xs text-[var(--muted)]">
            <AlertTriangle size={13} className="text-[var(--brass)]" />
            No Finnhub key configured — sector, valuation, and margin columns are unavailable. Technicals, beta, and IV rank still work.
          </p>
        )}
        <div className={ruled.scroll}>
          <table className={`${ruled.table} min-w-[940px]`}>
            <thead>
              <tr className={`${ruled.headRow} align-bottom`}>
                <th className="pb-2.5 pr-5 text-left font-normal">
                  <h2 className="font-display text-lg font-semibold tracking-tight text-[var(--paper)]">
                    Signals
                    <span className="mono ml-2 text-xs font-normal text-[var(--muted)]">{rows.length}</span>
                  </h2>
                </th>
                <Th sortKey="weightPct" sort={sort} setSort={setSort} align="right">Weight</Th>
                <Th align="left">Trend · above SMA</Th>
                <Th sortKey="rsi" sort={sort} setSort={setSort} align="right">RSI</Th>
                <Th sortKey="realizedVol" sort={sort} setSort={setSort} align="right">Vol</Th>
                <Th sortKey="beta" sort={sort} setSort={setSort} align="right">β</Th>
                <Th sortKey="mom3m" sort={sort} setSort={setSort} align="right">3m</Th>
                <Th sortKey="return1y" sort={sort} setSort={setSort} align="right">1y</Th>
                <Th sortKey="ivRank" sort={sort} setSort={setSort} align="right">IV rk</Th>
                <Th sortKey="peTtm" sort={sort} setSort={setSort} align="right">P/E</Th>
                <Th align="right">Margin</Th>
                <Th align="right">Earnings</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((h) => (
                <tr key={h.ticker} className={`${ruled.row} mono text-[13px]`}>
                  <td className={ruled.td}>
                    <span className="font-medium text-[var(--paper)]">{h.ticker}</span>
                    <span className="ml-2.5 font-sans text-xs text-[var(--muted)]">{h.sector ?? compactCap(h.marketCap)}</span>
                  </td>
                  <Td>{h.weightPct.toFixed(1)}%</Td>
                  <td className={ruled.td}>
                    <div className="flex gap-1.5">
                      <TrendBadge on={h.aboveSma50} label="50" />
                      <TrendBadge on={h.aboveSma200} label="200" />
                    </div>
                  </td>
                  <Td className={h.rsi != null && h.rsi > 70 ? "text-[var(--coral)]" : h.rsi != null && h.rsi < 30 ? "text-[var(--jade)]" : ""}>{h.rsi != null ? h.rsi.toFixed(0) : "—"}</Td>
                  <Td>{h.realizedVol != null ? `${h.realizedVol.toFixed(0)}%` : "—"}</Td>
                  <Td>{num(h.beta, 2)}</Td>
                  <Td className={signColor(h.mom3m)}>{pct(h.mom3m, 0)}</Td>
                  <Td className={signColor(h.return1y)}>{pct(h.return1y, 0)}</Td>
                  <Td>{h.ivRank != null ? h.ivRank.toFixed(0) : "—"}</Td>
                  <Td>{h.peTtm != null ? h.peTtm.toFixed(1) : "—"}</Td>
                  <Td>{h.netMargin != null ? `${h.netMargin.toFixed(0)}%` : "—"}</Td>
                  <Td className="text-[var(--muted)]">{h.nextEarnings ?? "—"}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-[var(--muted)]">
          RSI above 70 is flagged coral, below 30 jade. Trend chips read ↑ when price is above the 50- or 200-day average. Click a column to sort by it.
        </p>
      </section>

      {data.correlation.tickers.length > 1 && (
        <section aria-label="Correlation" className="flex flex-col gap-3">
          <SectionIntro
            title="Correlation — top positions"
            note="1-year daily-return correlation. Warm = moves together (concentrated risk), cool = diversifying."
          />
          <CorrelationHeatmap tickers={data.correlation.tickers} matrix={data.correlation.matrix} />
        </section>
      )}

      <p className="text-xs text-[var(--muted)]">
        Technicals from 1y daily bars; fundamentals via Finnhub; IV rank from your option-snapshot history (fills in as tickers are scanned/visited). Estimates only, not advice.
      </p>
    </div>
  );
}

/** A section title over a strong rule with its one-line explanation. */
function SectionIntro({ title, note }: { title: string; note: string }) {
  return (
    <div className="border-b border-[var(--line-strong)] pb-2.5">
      <h2 className="font-display text-lg tracking-tight">{title}</h2>
      <p className="mt-0.5 text-xs text-[var(--muted)]">{note}</p>
    </div>
  );
}

function ScatterTip(props: TooltipProps<number, string>) {
  const active = (props as { active?: boolean }).active;
  const payload = (props as { payload?: Array<{ payload?: { ticker: string; rawX: number; rawY: number; z: number } }> }).payload;
  if (!active || !payload?.length) return null;
  const p = payload[0]?.payload;
  if (!p) return null;
  return (
    <div className="rounded-md border border-[var(--line-strong)] bg-[var(--chart-tooltip-bg)] px-2.5 py-1.5 text-xs">
      <div className="font-medium text-[var(--paper)]">{p.ticker}</div>
      <div className="text-[var(--muted)]">
        {pct(p.rawY, 1)} 1y · {p.rawX.toFixed(0)}% vol · {p.z.toFixed(1)}% wt
      </div>
    </div>
  );
}

function CorrelationHeatmap({ tickers, matrix }: { tickers: string[]; matrix: (number | null)[][] }) {
  // ≥ 0.5 warms toward coral (the pair moves together), below that cools toward
  // blue (it diversifies). The diagonal is a position against itself — no fact.
  const cell = (v: number | null, diagonal: boolean): string => {
    if (v == null || diagonal) return "var(--panel-2)";
    const alpha = v >= 0.5 ? (v - 0.4) * 0.8 : (0.6 - v) * 0.6;
    const pctAlpha = Math.round(Math.max(0.06, Math.min(0.9, alpha)) * 100);
    return `color-mix(in srgb, var(${v >= 0.5 ? "--coral" : "--blue"}) ${pctAlpha}%, transparent)`;
  };
  const n = tickers.length;
  return (
    <div className={ruled.scroll}>
      <div
        role="table"
        aria-label="Correlation matrix"
        className="mono grid gap-[3px] text-xs"
        style={{
          gridTemplateColumns: `repeat(${n + 1}, minmax(0, 1fr))`,
          minWidth: `${(n + 1) * 68}px`,
          maxWidth: `${(n + 1) * 104}px`,
        }}
      >
        <div role="row" className="contents">
          <span role="columnheader" />
          {tickers.map((t) => (
            <span key={t} role="columnheader" className="flex min-h-10 items-center justify-center text-[var(--muted)]">
              {t}
            </span>
          ))}
        </div>
        {matrix.map((row, i) => (
          <div key={tickers[i]} role="row" className="contents">
            <span role="rowheader" className="flex min-h-10 items-center justify-center text-[var(--muted)]">
              {tickers[i]}
            </span>
            {row.map((v, j) => (
              <span
                key={j}
                role="cell"
                className="flex min-h-10 items-center justify-center rounded-md text-[var(--paper)]"
                style={{ background: cell(v, i === j) }}
                title={`${tickers[i]}·${tickers[j]}: ${v == null ? "—" : v.toFixed(2)}`}
              >
                {i === j || v == null ? "—" : v.toFixed(2)}
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function signColor(n: number | null): string {
  if (n == null) return "";
  return n >= 0 ? "text-[var(--jade)]" : "text-[var(--coral)]";
}

function TrendBadge({ on, label }: { on: boolean | null; label: string }) {
  const tone =
    on == null
      ? "border-line text-[var(--muted)]"
      : on
        ? "border-[var(--jade)] text-[var(--jade)]"
        : "border-[var(--coral)] text-[var(--coral)]";
  return (
    <span className={`whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] ${tone}`}>
      {on == null ? "" : on ? "↑ " : "↓ "}
      {label}
    </span>
  );
}

function Th({ children, sortKey, sort, setSort, align = "left" }: { children: React.ReactNode; sortKey?: SortKey; sort?: SortKey; setSort?: (k: SortKey) => void; align?: "left" | "right" }) {
  const active = sortKey && sort === sortKey;
  return (
    <th
      onClick={sortKey && setSort ? () => setSort(sortKey) : undefined}
      aria-sort={active ? "descending" : undefined}
      className={`${ruled.th} ${align === "right" ? "text-right" : "text-left"} ${sortKey ? "cursor-pointer hover:text-[var(--paper)]" : ""} ${active ? "!text-[var(--brass)]" : ""}`}
    >
      {children}
      {active ? " ↓" : ""}
    </th>
  );
}

function Td({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <td className={`${ruled.td} ${ruled.num} ${className}`}>{children}</td>;
}
