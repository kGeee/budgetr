"use client";

/**
 * Chain › Vol — the volatility desk for one symbol, on the canvas.
 *
 * FIXED-STRIKE VOL (your own tape): IV pinned to strikes while spot moves.
 *  - the CHART: selected strikes' IV through time. Click grid rows to add or
 *    remove strikes.
 *  - the GRID: strikes × capture days, each cell IV with its day-over-day
 *    change in vol points (coral = richened, jade = cheapened). This is the
 *    sheet that answers "did the surface actually reprice, or did spot just
 *    slide along the skew?"
 * History accumulates one column per day the options desk (or this page) is
 * opened — there is no backfill source, by design.
 *
 * TODAY'S SURFACE (the live chain, summarised on the server so the whole chain
 * never crosses to the client): strike × expiry IV as a heat table or the 3D
 * surface, ATM IV by expiry, and the smile for the expiry in focus.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { PIE_COLORS } from "@/components/charts";
import { Hero, Mark } from "@/components/ui/statement";
import { ChoicePill, DeskHead, DeskNote } from "@/components/options/desk-ui";
import { IvSurface } from "@/components/options/iv-surface";
import { HeroLine, RuledFooter, Segmented, SideFigure, pill, ruled } from "@/components/portfolio/ruled";
import {
  buildFixedStrikeMatrix,
  changeAt,
  defaultStrikes,
  ivAt,
  type IvSnapshotRow,
  type RightMode,
} from "@/lib/fixed-strike-vol-math";
import { useChartTheme } from "@/lib/chart-theme";
import { expectedMove } from "@/lib/option-analytics";
import type { IvSurface as IvSurfaceData } from "@/lib/option-chain-analytics";
import { formatOptionExpiry, formatStrike } from "@/lib/options";
import { formatCurrency } from "@/lib/utils";

const MODES: Array<{ value: RightMode; label: string }> = [
  { value: "otm", label: "OTM" },
  { value: "call", label: "Calls" },
  { value: "put", label: "Puts" },
];

const MAX_GRID_DATES = 10;
const NEAR_ATM_ROWS = 25;

type Side = "mid" | "call" | "put";

/** Today's chain, reduced to what this page draws. Built in vol-mode.tsx. */
export type VolToday = {
  surfaces: Record<Side, IvSurfaceData>;
  /** ATM IV per listed expiry, ascending by DTE; rows without an ATM IV dropped. */
  term: { expiry: string; dte: number; atmIv: number }[];
  /** Call/put IV by strike near spot, per expiry. */
  smiles: Record<string, { strike: number; callIv: number | null; putIv: number | null }[]>;
};

export function FixedStrikeVolView({
  ticker,
  rows,
  spot: liveSpot = null,
  today = null,
}: {
  ticker: string;
  rows: IvSnapshotRow[];
  /** Latest underlying price, when the quote provider answered. */
  spot?: number | null;
  today?: VolToday | null;
}) {
  // Expiries ranked by history depth, then nearness — the default is the one
  // you can actually read a time series from.
  const expiries = useMemo(() => {
    const byExpiry = new Map<string, Set<string>>();
    for (const r of rows) {
      const set = byExpiry.get(r.expiry) ?? new Set<string>();
      set.add(r.date);
      byExpiry.set(r.expiry, set);
    }
    return [...byExpiry.entries()]
      .map(([expiry, dates]) => ({ expiry, days: dates.size }))
      .sort((a, b) => b.days - a.days || (a.expiry < b.expiry ? -1 : 1));
  }, [rows]);

  const [expiry, setExpiry] = useState<string | null>(null);
  const [mode, setMode] = useState<RightMode>("otm");
  const [showAll, setShowAll] = useState(false);
  const [picked, setPicked] = useState<Set<number> | null>(null);

  const activeExpiry = expiry ?? expiries[0]?.expiry ?? null;
  const built = useMemo(
    () => (activeExpiry ? buildFixedStrikeMatrix(rows, activeExpiry, mode) : null),
    [rows, activeExpiry, mode],
  );
  const matrix = built && built.strikes.length > 0 ? built : null;

  if (!matrix && !today) {
    return (
      <DeskNote>
        No IV snapshots yet for {ticker}. Open the options desk once and today&apos;s surface is
        captured; a new column appears each day you come back.
      </DeskNote>
    );
  }

  const lastDate = matrix ? matrix.dates[matrix.dates.length - 1]! : null;
  const tapeSpot = matrix && lastDate ? (matrix.spotByDate.get(lastDate) ?? null) : null;
  const spot = liveSpot ?? tapeSpot;
  const atmStrike =
    !matrix || tapeSpot == null
      ? null
      : [...matrix.strikes].sort((a, b) => Math.abs(a - tapeSpot) - Math.abs(b - tapeSpot))[0] ?? null;

  // The expiry the summary and the smile describe: the tape's, if the live
  // chain still lists it, else the nearest listed one.
  const termRow =
    today?.term.find((t) => t.expiry === activeExpiry) ?? today?.term[0] ?? null;
  const em = termRow ? expectedMove(spot, termRow.atmIv, Math.max(termRow.dte, 0.5) / 365) : null;

  // Headline: IV at the at-the-money strike today, and how far it has moved
  // across the capture days we have for it.
  const headline = (() => {
    if (!matrix || atmStrike == null || !lastDate) return null;
    const now = ivAt(matrix, atmStrike, lastDate);
    if (now == null) return null;
    const firstDate = matrix.dates.find((d) => ivAt(matrix, atmStrike, d) != null) ?? lastDate;
    const then = ivAt(matrix, atmStrike, firstDate)!;
    const sessions = matrix.dates.length - matrix.dates.indexOf(firstDate);
    return { strike: atmStrike, now, change: (now - then) * 100, sessions };
  })();

  const heroFigure = headline
    ? `${(headline.now * 100).toFixed(1)}%`
    : termRow
      ? `${(termRow.atmIv * 100).toFixed(1)}%`
      : "—";

  return (
    <div className="space-y-9">
      <section aria-label={`${ticker} volatility summary`}>
        <HeroLine
          hero={
            <Hero
              className="min-w-0 flex-1 basis-[24rem]"
              eyebrow={
                headline && activeExpiry
                  ? `${ticker} · ${formatStrike(headline.strike)} strike · ${formatOptionExpiry(activeExpiry)}`
                  : termRow
                    ? `${ticker} · ATM implied vol · ${formatOptionExpiry(termRow.expiry)}`
                    : `${ticker} · implied vol`
              }
              figure={heroFigure}
              verdict={
                headline && headline.sessions > 1 ? (
                  Math.abs(headline.change) < 0.05 ? (
                    <>
                      Unchanged over {headline.sessions} sessions at the strike nearest the money.{" "}
                      <span className="text-[var(--muted)]">
                        The surface has held; any move in the option came from the stock.
                      </span>
                    </>
                  ) : (
                    <>
                      {headline.change < 0 ? "Down " : "Up "}
                      <Mark tone={headline.change < 0 ? "jade" : "coral"}>
                        {Math.abs(headline.change).toFixed(1)} points
                      </Mark>{" "}
                      in {headline.sessions} sessions at the strike nearest the money.{" "}
                      <span className="text-[var(--muted)]">
                        {headline.change < 0
                          ? "Vol is leaving this strike, not just the stock moving away."
                          : "Vol is being bid at this strike, not just the stock moving toward it."}
                      </span>
                    </>
                  )
                ) : (
                  <span className="text-[var(--muted)]">
                    {matrix
                      ? "One capture day so far. The change over time lights up from day two."
                      : "No snapshots yet — today's surface is captured on this visit."}
                  </span>
                )
              }
            />
          }
        >
          <SideFigure label="Spot" value={spot != null ? formatStrike(spot) : "—"} />
          <SideFigure
            label={termRow ? `ATM IV · ${termRow.dte}d` : "ATM IV"}
            value={termRow ? `${(termRow.atmIv * 100).toFixed(1)}%` : "—"}
          />
          <SideFigure label="Exp. move ±1σ" value={em != null ? `±${formatCurrency(em)}` : "—"} />
          <SideFigure
            label="Snapshots"
            value={
              matrix ? `${matrix.dates.length} ${matrix.dates.length === 1 ? "day" : "days"}` : "none yet"
            }
          />
        </HeroLine>
      </section>

      <nav
        aria-label="Volatility view"
        className="flex gap-1 overflow-x-auto border-b border-line text-sm"
      >
        {[
          { href: "#fixed", label: "Fixed-strike" },
          { href: "#surface", label: "IV surface" },
          { href: "#term", label: "Term structure and skew" },
        ].map((v, i) => (
          <a
            key={v.href}
            href={v.href}
            className={`-mb-px inline-flex min-h-11 items-center whitespace-nowrap border-b-2 px-3 transition-colors hover:text-[var(--paper)] ${
              i === 0 ? "border-[var(--brass)]" : "border-transparent text-[var(--muted)]"
            }`}
          >
            {v.label}
          </a>
        ))}
      </nav>

      <section id="fixed" aria-label="Fixed-strike vol" className="scroll-mt-28 space-y-4">
        {matrix ? (
          <FixedStrike
            matrix={matrix}
            spot={tapeSpot}
            atmStrike={atmStrike}
            expiries={expiries}
            activeExpiry={activeExpiry}
            onExpiry={(e) => {
              setExpiry(e);
              setPicked(null);
            }}
            mode={mode}
            onMode={setMode}
            showAll={showAll}
            onShowAll={setShowAll}
            picked={picked}
            onPicked={setPicked}
          />
        ) : (
          <>
            <DeskHead ruled={false} title="Fixed-strike vol" />
            <DeskNote>
              No IV snapshots yet for {ticker}. Open the options desk once and today&apos;s surface
              is captured; a new column appears each day you come back.
            </DeskNote>
          </>
        )}
      </section>

      {today && (
        <div className="grid gap-x-12 gap-y-9 lg:grid-cols-5">
          <SurfaceSection today={today} />
          <TermAndSmile ticker={ticker} today={today} expiry={termRow?.expiry ?? null} spot={spot} />
        </div>
      )}
    </div>
  );
}

// ── Fixed-strike: chart beside the grid ─────────────────────────────────────

function FixedStrike({
  matrix,
  spot,
  atmStrike,
  expiries,
  activeExpiry,
  onExpiry,
  mode,
  onMode,
  showAll,
  onShowAll,
  picked,
  onPicked,
}: {
  matrix: NonNullable<ReturnType<typeof buildFixedStrikeMatrix>>;
  spot: number | null;
  atmStrike: number | null;
  expiries: { expiry: string; days: number }[];
  activeExpiry: string | null;
  onExpiry: (e: string) => void;
  mode: RightMode;
  onMode: (m: RightMode) => void;
  showAll: boolean;
  onShowAll: (v: boolean) => void;
  picked: Set<number> | null;
  onPicked: (s: Set<number>) => void;
}) {
  const ct = useChartTheme();
  const dates = matrix.dates.slice(-MAX_GRID_DATES);
  const lastDate = matrix.dates[matrix.dates.length - 1]!;

  const gridStrikes = showAll
    ? matrix.strikes
    : spot == null
      ? matrix.strikes.slice(0, NEAR_ATM_ROWS)
      : [...matrix.strikes]
          .sort((a, b) => Math.abs(a - spot) - Math.abs(b - spot))
          .slice(0, NEAR_ATM_ROWS)
          .sort((a, b) => b - a);

  const selected = picked ?? new Set(defaultStrikes(matrix, 5));
  const toggleStrike = (k: number) => {
    const next = new Set(selected);
    if (next.has(k)) next.delete(k);
    else if (next.size < 8) next.add(k);
    onPicked(next);
  };

  // Chart data: one row per date, one key per selected strike.
  const chartStrikes = [...selected].sort((a, b) => b - a).filter((k) => matrix.strikes.includes(k));
  const colorOf = (k: number) => {
    const i = chartStrikes.indexOf(k);
    return i < 0 ? null : PIE_COLORS[i % PIE_COLORS.length];
  };
  const chartData = matrix.dates.map((d) => {
    const point: Record<string, number | string | null> = { date: d.slice(5) };
    for (const k of chartStrikes) point[String(k)] = ivAt(matrix, k, d) != null ? ivAt(matrix, k, d)! * 100 : null;
    return point;
  });

  const singleDay = matrix.dates.length < 2;
  const showChart = !singleDay && chartStrikes.length > 0;

  return (
    <>
      <DeskHead
        ruled={false}
        title="Fixed-strike vol"
        sub={
          <span className="mono">
            {spot != null ? `spot ${formatStrike(spot)} · ` : ""}
            {matrix.dates.length} {matrix.dates.length === 1 ? "day" : "days"}
          </span>
        }
        action={
          <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">
            <div role="group" aria-label="Expiration" className="flex max-w-full gap-1 overflow-x-auto">
              {expiries.map((e) => (
                <ChoicePill
                  key={e.expiry}
                  on={e.expiry === activeExpiry}
                  onClick={() => onExpiry(e.expiry)}
                  title={`${e.expiry} · ${e.days} ${e.days === 1 ? "day" : "days"} of history`}
                >
                  {formatOptionExpiry(e.expiry)} · {e.days}d history
                </ChoicePill>
              ))}
            </div>
            <Segmented label="Side" value={mode} onChange={onMode} options={MODES} />
          </div>
        }
      />

      {singleDay && (
        <p className="text-xs text-[var(--muted)]">
          One capture day so far — the grid fills out a column per day this page or the options desk
          is opened. Changes and the time chart light up from day two.
        </p>
      )}

      <div className={showChart ? "grid gap-x-10 gap-y-6 lg:grid-cols-5" : ""}>
        {showChart && (
          <div className="min-w-0 space-y-2 lg:col-span-3">
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={chartData} margin={{ top: 4, right: 12, bottom: 0, left: -14 }}>
                <CartesianGrid stroke={ct.grid} strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="date" tick={ct.tick} tickLine={false} axisLine={{ stroke: ct.grid }} />
                <YAxis
                  tick={ct.tick}
                  tickLine={false}
                  axisLine={false}
                  domain={["auto", "auto"]}
                  tickFormatter={(v: number) => `${v.toFixed(0)}%`}
                />
                <Tooltip
                  contentStyle={ct.tooltipStyle}
                  formatter={(value, name) => [`${Number(value ?? 0).toFixed(1)}%`, formatStrike(Number(name))]}
                />
                {chartStrikes.map((k) => (
                  <Line
                    key={k}
                    type="monotone"
                    dataKey={String(k)}
                    stroke={colorOf(k) ?? undefined}
                    strokeWidth={k === atmStrike ? 2.5 : 1.6}
                    dot={false}
                    connectNulls
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
            <div className="mono flex flex-wrap gap-x-3.5 gap-y-1 text-xs text-[var(--muted)]">
              {chartStrikes.map((k) => (
                <span key={k} className="inline-flex items-center gap-1.5">
                  <span aria-hidden className="h-0.5 w-3.5" style={{ background: colorOf(k) ?? undefined }} />
                  {formatStrike(k)}
                </span>
              ))}
            </div>
          </div>
        )}

        <div className={`min-w-0 space-y-3 ${showChart ? "lg:col-span-2" : ""}`}>
          <div className={`max-h-[560px] overflow-y-auto ${ruled.scroll}`}>
            <table className="mono w-full min-w-[380px] text-[13px]">
              <thead className="sticky top-0 z-10 bg-[var(--ink)]">
                <tr className={ruled.headRow}>
                  <th className="sticky left-0 bg-[var(--ink)] pb-2.5 pr-3 text-xs font-normal text-[var(--muted)]">
                    Strike
                  </th>
                  {dates.map((d) => (
                    <th
                      key={d}
                      className={`px-2 pb-2.5 text-right text-xs font-normal last:pr-0 ${
                        d === lastDate ? "text-[var(--paper)]" : "text-[var(--muted)]"
                      }`}
                    >
                      {d.slice(5)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {gridStrikes.map((k) => {
                  const isAtm = k === atmStrike;
                  const color = colorOf(k);
                  return (
                    <tr
                      key={k}
                      onClick={() => toggleStrike(k)}
                      title="Click to toggle this strike on the chart"
                      className="cursor-pointer border-b border-line transition-colors hover:bg-[var(--panel)]"
                    >
                      <td className="sticky left-0 bg-[var(--ink)] py-2 pr-3">
                        <button
                          type="button"
                          aria-pressed={color != null}
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleStrike(k);
                          }}
                          className="inline-flex items-center gap-2 whitespace-nowrap"
                        >
                          <span
                            aria-hidden
                            className="h-2 w-2 shrink-0 rounded-full bg-[var(--line)]"
                            style={color ? { background: color } : undefined}
                          />
                          <span className={isAtm ? "text-[var(--brass)]" : "text-[var(--paper)]"}>
                            {formatStrike(k)}
                          </span>
                          {isAtm && <span className="text-[10px] text-[var(--muted)]">ATM</span>}
                        </button>
                      </td>
                      {dates.map((d) => {
                        const iv = ivAt(matrix, k, d);
                        const chg = changeAt(matrix, k, d);
                        return (
                          <td key={d} className="px-2 py-2 text-right last:pr-0">
                            {iv == null ? (
                              <span className="text-[var(--muted)]">—</span>
                            ) : (
                              <span className="inline-flex flex-col items-end leading-tight">
                                <span className="text-[var(--paper)]">{(iv * 100).toFixed(1)}</span>
                                {chg != null && Math.abs(chg) >= 0.05 && (
                                  <span
                                    className={`text-[11px] ${chg > 0 ? "text-[var(--coral)]" : "text-[var(--jade)]"}`}
                                  >
                                    {chg > 0 ? "+" : ""}
                                    {chg.toFixed(1)}
                                  </span>
                                )}
                              </span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <RuledFooter
            className="items-start border-t-0 pt-0 text-xs"
            note={
              <span className="block max-w-[64ch]">
                Click a strike to chart it, up to 8. A new column appears each day you open the
                desk. IV in vol points; the small figure is the day-over-day change —{" "}
                <span className="text-[var(--coral)]">coral richened</span>,{" "}
                <span className="text-[var(--jade)]">jade cheapened</span>.
              </span>
            }
          >
            {matrix.strikes.length > NEAR_ATM_ROWS && (
              <button type="button" onClick={() => onShowAll(!showAll)} className={pill}>
                {showAll ? "Near ATM only" : `Show all ${matrix.strikes.length} strikes`}
              </button>
            )}
          </RuledFooter>
        </div>
      </div>
    </>
  );
}

// ── IV surface: strike × expiry heat table, or the 3D mesh ──────────────────

function SurfaceSection({ today }: { today: VolToday }) {
  const [side, setSide] = useState<Side>("mid");
  const [threeD, setThreeD] = useState(false);
  const surface = today.surfaces[side];

  const { lo, hi } = useMemo(() => {
    let lo = Infinity;
    let hi = -Infinity;
    for (const row of surface.z) {
      for (const v of row) {
        if (v == null) continue;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    }
    return { lo, hi };
  }, [surface]);
  const hasData = Number.isFinite(lo);

  // Strikes render high → low, like the fixed-strike grid above.
  const order = surface.strikes.map((_, i) => i).reverse();
  const atmIndex =
    surface.spot == null
      ? -1
      : surface.strikes.reduce(
          (best, k, i) =>
            Math.abs(k - surface.spot!) < Math.abs(surface.strikes[best]! - surface.spot!) ? i : best,
          0,
        );

  return (
    <section id="surface" aria-label="IV surface" className="min-w-0 scroll-mt-28 space-y-3 lg:col-span-3">
      <DeskHead
        title="IV surface"
        sub="strike by expiry, today"
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Segmented
              label="Side"
              value={side}
              onChange={setSide}
              options={[
                { value: "mid", label: "Mid" },
                { value: "call", label: "Calls" },
                { value: "put", label: "Puts" },
              ]}
            />
            <button type="button" aria-pressed={threeD} onClick={() => setThreeD((v) => !v)} className={pill}>
              {threeD ? "Back to the grid" : "Open in 3D"}
            </button>
          </div>
        }
      />
      {threeD ? (
        <>
          <IvSurface surface={surface} height={380} />
          <p className="text-xs text-[var(--muted)]">strike × expiry × IV · drag to rotate</p>
        </>
      ) : !hasData ? (
        <p className="py-8 text-sm text-[var(--muted)]">Not enough chain data to build a surface.</p>
      ) : (
        <>
          <div className={ruled.scroll}>
            <table className="mono border-separate border-spacing-0.5 text-xs">
              <thead>
                <tr>
                  <th />
                  {surface.expiries.map((e) => (
                    <th
                      key={e.expiry}
                      title={`${e.dte} days to expiry`}
                      className="whitespace-nowrap px-1.5 pb-1.5 text-center font-normal text-[var(--muted)]"
                    >
                      {formatOptionExpiry(e.expiry)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {order.map((i) => (
                  <tr key={surface.strikes[i]}>
                    <th
                      scope="row"
                      className={`whitespace-nowrap pr-3 text-left font-normal ${
                        i === atmIndex ? "text-[var(--brass)]" : "text-[var(--muted)]"
                      }`}
                    >
                      {formatStrike(surface.strikes[i]!)}
                    </th>
                    {surface.z[i]!.map((v, j) => {
                      // Brass deepens with IV, scaled to this surface's own range.
                      const t = v == null || hi <= lo ? 0 : (v - lo) / (hi - lo);
                      return (
                        <td
                          key={surface.expiries[j]!.expiry}
                          className="h-8 min-w-12 rounded-sm px-1.5 text-center text-[var(--paper)]"
                          style={
                            v == null
                              ? undefined
                              : {
                                  background: `color-mix(in srgb, var(--brass) ${Math.round(6 + t * 54)}%, transparent)`,
                                }
                          }
                        >
                          {v == null ? <span className="text-[var(--muted)]">—</span> : `${(v * 100).toFixed(0)}%`}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-[var(--muted)]">
            Darker brass is higher implied volatility, scaled to today&apos;s range (
            {(lo * 100).toFixed(0)}%–{(hi * 100).toFixed(0)}%). The brass strike is nearest spot.
          </p>
        </>
      )}
    </section>
  );
}

// ── Term structure and the smile for one expiry ─────────────────────────────

function TermAndSmile({
  ticker,
  today,
  expiry,
  spot,
}: {
  ticker: string;
  today: VolToday;
  expiry: string | null;
  spot: number | null;
}) {
  const ct = useChartTheme();
  const term = today.term.map((t) => ({ dte: t.dte, iv: t.atmIv * 100, expiry: t.expiry }));
  const smile = (expiry ? today.smiles[expiry] : undefined) ?? [];
  const smileRows = smile.map((p) => ({
    strike: p.strike,
    call: p.callIv != null ? p.callIv * 100 : null,
    put: p.putIv != null ? p.putIv * 100 : null,
  }));
  const ends = term.length > 1 ? [term[0]!, term[Math.floor(term.length / 2)]!, term[term.length - 1]!] : [];

  return (
    <section
      id="term"
      aria-label="Term structure and skew"
      className="min-w-0 scroll-mt-28 space-y-6 lg:col-span-2"
    >
      <div className="space-y-2">
        <DeskHead title="Term structure" sub="ATM IV by expiry" />
        {term.length < 2 ? (
          <p className="py-6 text-sm text-[var(--muted)]">Need ATM IV on ≥2 expiries (and a spot price).</p>
        ) : (
          <>
            <ResponsiveContainer width="100%" height={130}>
              <LineChart data={term} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
                <CartesianGrid stroke={ct.grid} strokeDasharray="2 4" vertical={false} />
                <XAxis dataKey="dte" type="number" domain={["dataMin", "dataMax"]} hide />
                <YAxis
                  tick={ct.tick}
                  tickFormatter={(v) => `${Number(v).toFixed(0)}%`}
                  tickLine={false}
                  axisLine={false}
                  width={40}
                  domain={["auto", "auto"]}
                />
                <Tooltip
                  contentStyle={ct.tooltipStyle}
                  formatter={(value) => [`${Number(value).toFixed(1)}%`, "ATM IV"]}
                  labelFormatter={(l) => `${l}d to expiry`}
                />
                <Line type="monotone" dataKey="iv" stroke={ct.blue} strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
            <div className="mono flex justify-between gap-2 text-[11px] text-[var(--muted)]">
              {ends.map((t) => (
                <span key={t.expiry} className="whitespace-nowrap">
                  {formatOptionExpiry(t.expiry)} · {t.iv.toFixed(0)}%
                </span>
              ))}
            </div>
          </>
        )}
      </div>

      <div className="space-y-2">
        <DeskHead
          title="Smile / skew"
          sub={expiry ? formatOptionExpiry(expiry) : undefined}
          action={
            <span className="text-xs text-[var(--muted)]">
              <span className="text-[var(--jade)]">Calls</span> /{" "}
              <span className="text-[var(--coral)]">Puts</span>
            </span>
          }
        />
        {smileRows.length < 2 ? (
          <p className="py-6 text-sm text-[var(--muted)]">Not enough priced strikes for a smile.</p>
        ) : (
          <>
            <ResponsiveContainer width="100%" height={130}>
              <LineChart data={smileRows} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
                <CartesianGrid stroke={ct.grid} strokeDasharray="2 4" vertical={false} />
                <XAxis dataKey="strike" type="number" domain={["dataMin", "dataMax"]} hide />
                <YAxis
                  tick={ct.tick}
                  tickFormatter={(v) => `${Number(v).toFixed(0)}%`}
                  tickLine={false}
                  axisLine={false}
                  width={40}
                  domain={["auto", "auto"]}
                />
                <Tooltip
                  contentStyle={ct.tooltipStyle}
                  formatter={(value, name) => {
                    const v = Number(value);
                    return [Number.isFinite(v) ? `${v.toFixed(1)}%` : "—", name === "call" ? "Call IV" : "Put IV"];
                  }}
                  labelFormatter={(l) => `Strike ${formatStrike(Number(l))}`}
                />
                {spot != null && <ReferenceLine x={spot} stroke={ct.brass} strokeDasharray="4 4" />}
                <Line type="monotone" dataKey="call" stroke={ct.jade} strokeWidth={2} dot={false} connectNulls name="call" />
                <Line type="monotone" dataKey="put" stroke={ct.coral} strokeWidth={2} dot={false} connectNulls name="put" />
              </LineChart>
            </ResponsiveContainer>
            <div className="mono flex justify-between gap-2 text-[11px] text-[var(--muted)]">
              <span>{formatStrike(smileRows[0]!.strike)}</span>
              {spot != null && <span className="text-[var(--brass)]">spot {formatStrike(spot)}</span>}
              <span>{formatStrike(smileRows[smileRows.length - 1]!.strike)}</span>
            </div>
          </>
        )}
      </div>

      <Link
        href={`/investments/options/chain?ticker=${encodeURIComponent(ticker)}`}
        className="inline-flex min-h-10 items-center text-sm text-[var(--brass)] underline-offset-2 hover:underline"
      >
        Open interest, volume, greeks and dealer gamma are on Chain →
      </Link>
    </section>
  );
}
