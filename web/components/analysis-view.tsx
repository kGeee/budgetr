"use client";

/**
 * Analysis desk — portfolio risk + per-holding technicals/fundamentals for
 * calmer, more structured decisions. Portfolio KPIs (beta, concentration) →
 * sector exposure → risk/return scatter → correlation heatmap of the biggest
 * positions → a sortable per-holding table. All data is prepared server-side in
 * lib/analysis-data.ts; this only visualizes it.
 */

import { useMemo, useState } from "react";
import { CartesianGrid, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis, Cell } from "recharts";
import type { TooltipProps } from "recharts";
import { AlertTriangle } from "lucide-react";
import { Card } from "@/components/ui/card";
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

export function AnalysisView({ data }: { data: AnalysisData }) {
  const t = useChartTheme();
  const [sort, setSort] = useState<SortKey>("value");

  const rows = useMemo(() => {
    const val = (h: HoldingAnalytics) => {
      const v = h[sort];
      return typeof v === "number" ? v : -Infinity;
    };
    return [...data.holdings].sort((a, b) => val(b) - val(a));
  }, [data.holdings, sort]);

  // Clamp to a readable window so one meme-stock outlier (100%+ vol, 200%+
  // return) doesn't compress everything else into the corner. Raw values still
  // show in the tooltip; clamped points sit on the edge.
  const X_MAX = 80;
  const Y_MIN = -60;
  const Y_MAX = 120;
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  const scatter = data.holdings
    .filter((h) => h.realizedVol != null && h.return1y != null)
    .map((h) => ({
      ticker: h.ticker,
      x: clamp(h.realizedVol!, 0, X_MAX),
      y: clamp(h.return1y!, Y_MIN, Y_MAX),
      z: h.weightPct,
      rawX: h.realizedVol!,
      rawY: h.return1y!,
    }));

  if (data.holdings.length === 0) {
    return (
      <Card className="p-10 text-center text-sm text-[var(--muted)]">
        No equity holdings to analyze yet. Connect a brokerage or add holdings, then this desk fills in.
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Portfolio KPIs */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Kpi label="Book value" value={money(data.portfolio.totalValue)} />
        <Kpi label="Portfolio β" value={num(data.portfolio.beta, 2)} sub="vs SPY" accent={data.portfolio.beta != null && data.portfolio.beta > 1.2 ? "coral" : undefined} />
        <Kpi label="Top position" value={pct(data.portfolio.topConcentrationPct, 0)} sub="of book" accent={data.portfolio.topConcentrationPct != null && data.portfolio.topConcentrationPct > 25 ? "coral" : undefined} />
        <Kpi label="Top 5" value={pct(data.portfolio.top5ConcentrationPct, 0)} sub="concentration" />
        <Kpi label="Positions" value={String(data.holdings.length)} sub={`${data.portfolio.sectors.length} sectors`} />
      </div>

      {!data.fundamentalsAvailable && (
        <p className="flex items-center gap-2 text-xs text-[var(--muted)]">
          <AlertTriangle size={13} className="text-[var(--brass)]" />
          No Finnhub key configured — sector, valuation, and margin columns are unavailable. Technicals, beta, and IV rank still work.
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Sector exposure */}
        <Card className="p-5">
          <h3 className="mb-4 text-sm font-medium text-[var(--paper)]">Sector exposure</h3>
          <div className="space-y-2.5">
            {data.portfolio.sectors.slice(0, 8).map((s) => (
              <div key={s.sector}>
                <div className="flex justify-between text-xs">
                  <span className="text-[var(--muted)]">{s.sector}</span>
                  <span className="tabular-nums text-[var(--paper)]">{s.pct.toFixed(0)}%</span>
                </div>
                <div className="mt-1 h-1.5 rounded-full bg-[var(--panel-2)]">
                  <div className="h-full rounded-full bg-[var(--brass)]" style={{ width: `${Math.min(100, s.pct)}%` }} />
                </div>
              </div>
            ))}
          </div>
        </Card>

        {/* Risk / return scatter */}
        <Card className="p-5">
          <h3 className="mb-1 text-sm font-medium text-[var(--paper)]">Risk vs. return</h3>
          <p className="mb-3 text-xs text-[var(--muted)]">1-year return against realized volatility; bubble size = weight.</p>
          <ResponsiveContainer width="100%" height={240}>
            <ScatterChart margin={{ top: 8, right: 12, bottom: 20, left: 4 }}>
              <CartesianGrid stroke={t.grid} strokeDasharray="3 3" />
              <XAxis type="number" dataKey="x" name="Volatility" unit="%" domain={[0, X_MAX]} tick={t.tick} label={{ value: "Volatility", position: "insideBottom", offset: -8, fill: t.muted, fontSize: 11 }} />
              <YAxis type="number" dataKey="y" name="Return" unit="%" domain={[Y_MIN, Y_MAX]} tick={t.tick} />
              <ZAxis type="number" dataKey="z" range={[40, 400]} />
              <Tooltip cursor={{ strokeDasharray: "3 3", stroke: t.grid }} content={<ScatterTip />} />
              <Scatter data={scatter} isAnimationActive={false}>
                {scatter.map((d) => (
                  <Cell key={d.ticker} fill={d.y >= 0 ? t.jade : t.coral} fillOpacity={0.75} stroke={t.dotStroke} />
                ))}
              </Scatter>
            </ScatterChart>
          </ResponsiveContainer>
        </Card>
      </div>

      {/* Correlation heatmap */}
      {data.correlation.tickers.length > 1 && (
        <Card className="p-5">
          <h3 className="mb-1 text-sm font-medium text-[var(--paper)]">Correlation — top positions</h3>
          <p className="mb-4 text-xs text-[var(--muted)]">1-year daily-return correlation. Warm = moves together (concentrated risk), cool = diversifying.</p>
          <CorrelationHeatmap tickers={data.correlation.tickers} matrix={data.correlation.matrix} jade={t.jade} coral={t.coral} />
        </Card>
      )}

      {/* Holdings table */}
      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[920px] text-sm">
            <thead>
              <tr className="border-b border-line text-[11px] uppercase tracking-wide text-[var(--muted)]">
                <Th>Ticker</Th>
                <Th sortKey="weightPct" sort={sort} setSort={setSort} align="right">Wt</Th>
                <Th align="left">Trend</Th>
                <Th sortKey="rsi" sort={sort} setSort={setSort} align="right">RSI</Th>
                <Th sortKey="realizedVol" sort={sort} setSort={setSort} align="right">Vol</Th>
                <Th sortKey="beta" sort={sort} setSort={setSort} align="right">β</Th>
                <Th sortKey="mom3m" sort={sort} setSort={setSort} align="right">3m</Th>
                <Th sortKey="return1y" sort={sort} setSort={setSort} align="right">1y</Th>
                <Th sortKey="peTtm" sort={sort} setSort={setSort} align="right">P/E</Th>
                <Th align="right">Margin</Th>
                <Th sortKey="ivRank" sort={sort} setSort={setSort} align="right">IV rk</Th>
                <Th align="right">Earnings</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((h) => (
                <tr key={h.ticker} className="border-b border-line/60 hover:bg-[var(--panel-2)]/40">
                  <td className="px-4 py-3">
                    <div className="font-medium text-[var(--paper)]">{h.ticker}</div>
                    <div className="text-xs text-[var(--muted)]">{h.sector ?? compactCap(h.marketCap)}</div>
                  </td>
                  <Td>{h.weightPct.toFixed(1)}%</Td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1">
                      <TrendBadge on={h.aboveSma50} label="50" />
                      <TrendBadge on={h.aboveSma200} label="200" />
                    </div>
                  </td>
                  <Td className={h.rsi != null && h.rsi > 70 ? "text-[var(--coral)]" : h.rsi != null && h.rsi < 30 ? "text-[var(--jade)]" : ""}>{h.rsi != null ? h.rsi.toFixed(0) : "—"}</Td>
                  <Td>{h.realizedVol != null ? `${h.realizedVol.toFixed(0)}%` : "—"}</Td>
                  <Td>{num(h.beta, 2)}</Td>
                  <Td className={signColor(h.mom3m)}>{pct(h.mom3m, 0)}</Td>
                  <Td className={signColor(h.return1y)}>{pct(h.return1y, 0)}</Td>
                  <Td>{h.peTtm != null ? h.peTtm.toFixed(1) : "—"}</Td>
                  <Td>{h.netMargin != null ? `${h.netMargin.toFixed(0)}%` : "—"}</Td>
                  <Td>{h.ivRank != null ? h.ivRank.toFixed(0) : "—"}</Td>
                  <Td className="text-xs">{h.nextEarnings ?? "—"}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <p className="text-xs text-[var(--muted)]">
        Technicals from 1y daily bars; fundamentals via Finnhub; IV rank from your option-snapshot history (fills in as tickers are scanned/visited). Estimates only, not advice.
      </p>
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

function CorrelationHeatmap({ tickers, matrix, jade, coral }: { tickers: string[]; matrix: (number | null)[][]; jade: string; coral: string }) {
  const cell = (v: number | null): string => {
    if (v == null) return "var(--panel-2)";
    // −1 → jade (diversifying), +1 → coral (concentrated). Blend by opacity.
    const base = v >= 0 ? coral : jade;
    const op = Math.min(0.85, Math.abs(v) * 0.85 + 0.08);
    return hexA(base, op);
  };
  return (
    <div className="overflow-x-auto">
      <table className="border-separate border-spacing-1 text-[11px]">
        <thead>
          <tr>
            <th />
            {tickers.map((t) => (
              <th key={t} className="px-1 pb-1 text-center font-medium text-[var(--muted)]">{t}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {matrix.map((row, i) => (
            <tr key={tickers[i]}>
              <td className="pr-2 text-right font-medium text-[var(--muted)]">{tickers[i]}</td>
              {row.map((v, j) => (
                <td key={j} className="h-8 w-10 rounded text-center tabular-nums text-[var(--ink)]" style={{ background: cell(v) }} title={`${tickers[i]}·${tickers[j]}: ${v == null ? "—" : v.toFixed(2)}`}>
                  {v == null ? "" : v.toFixed(1)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** #rrggbb + alpha (0–1) → rgba() string. */
function hexA(hex: string, a: number): string {
  const h = hex.replace("#", "");
  if (h.length !== 6) return hex;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

function signColor(n: number | null): string {
  if (n == null) return "";
  return n >= 0 ? "text-[var(--jade)]" : "text-[var(--coral)]";
}

function TrendBadge({ on, label }: { on: boolean | null; label: string }) {
  if (on == null) return <span className="rounded bg-[var(--panel-2)] px-1 py-0.5 text-[10px] text-[var(--muted)]">{label}</span>;
  return (
    <span className={`rounded px-1 py-0.5 text-[10px] font-medium ${on ? "bg-[var(--jade)]/12 text-[var(--jade)]" : "bg-[var(--coral)]/12 text-[var(--coral)]"}`}>
      {on ? "▲" : "▼"}
      {label}
    </span>
  );
}

function Kpi({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: "coral" }) {
  return (
    <Card className="p-4">
      <div className="text-[11px] uppercase tracking-wide text-[var(--muted)]">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${accent === "coral" ? "text-[var(--coral)]" : "text-[var(--paper)]"}`}>{value}</div>
      {sub && <div className="mt-0.5 truncate text-xs text-[var(--muted)]">{sub}</div>}
    </Card>
  );
}

function Th({ children, sortKey, sort, setSort, align = "left" }: { children: React.ReactNode; sortKey?: SortKey; sort?: SortKey; setSort?: (k: SortKey) => void; align?: "left" | "right" }) {
  const active = sortKey && sort === sortKey;
  return (
    <th
      onClick={sortKey && setSort ? () => setSort(sortKey) : undefined}
      className={`px-4 py-2.5 font-medium ${align === "right" ? "text-right" : "text-left"} ${sortKey ? "cursor-pointer hover:text-[var(--paper)]" : ""} ${active ? "text-[var(--brass)]" : ""}`}
    >
      {children}
      {active ? " ↓" : ""}
    </th>
  );
}

function Td({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-4 py-3 text-right tabular-nums text-[var(--paper)] ${className}`}>{children}</td>;
}
