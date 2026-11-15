"use client";

/**
 * Per-ticker options desk — the full options picture for ONE underlying, driven
 * by the complete CBOE/Yahoo chain (every listed expiry + strike, weeklies and
 * all), not just the legs you happen to hold.
 *
 * Layout (everything sits on the canvas — rules, not cards):
 *   1. Positioning header — the expected move as the page's figure, with ATM IV,
 *      max pain, put/call ratio, skew and dealer gamma on the same line.
 *   2. The chain — expiry-type filter and expiry pills, then the raw
 *      calls | strike | puts table with the contracts you hold in brass. A bid
 *      or ask is a button: it adds that leg to the builder.
 *   3. One lens at a time — volatility smile, IV term structure, open interest,
 *      volume, a selectable greek-by-strike, dealer GEX, or the 3D IV surface.
 *   4. The strategy builder — legs and payoff on the left, safety and the
 *      suggester on the right.
 *   5. Your positions — the existing OptionsAnalytics panel, when you hold legs.
 *
 * All the math lives in `lib/option-chain-analytics.ts` (pure + tested); this is
 * presentation + wiring. Live underlying price comes from the Finnhub WS via
 * `useLivePrices`, falling back to the chain's quoted price.
 */

import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Hero, Mark, SectionHead } from "@/components/ui/statement";
import { ChoicePill, DeskNote, LensTab } from "@/components/options/desk-ui";
import { IvSurface } from "@/components/options/iv-surface";
import { OptionsAnalytics } from "@/components/options/options-analytics";
import { StrategyBuilder, type ManualLeg } from "@/components/options/strategy-builder";
import { HeroLine, RuledFooter, Segmented, SideFigure, ruled } from "@/components/portfolio/ruled";
import { useLivePrices } from "@/components/portfolio/live-prices";
import type { HoldingRow } from "@/components/portfolio/portfolio-view";
import { formatCurrency } from "@/lib/utils";
import {
  daysToExpiry,
  formatOptionExpiry,
  formatStrike,
  parseOccSymbol,
} from "@/lib/options";
import { computeGreeks } from "@/lib/greeks";
import { useChartTheme } from "@/lib/chart-theme";
import { expectedMove } from "@/lib/option-analytics";
import type { OptionQuote } from "@/lib/yahoo";
import {
  atmIv,
  buildIvSurface,
  contractsForExpiry,
  flowByStrike,
  gammaExposureByStrike,
  greekByStrike,
  ivTermStructure,
  listExpiries,
  maxPain,
  putCallStats,
  skew25,
  totalGex,
  volatilitySmile,
  type ExpiryKind,
  type GreekKey,
} from "@/lib/option-chain-analytics";

// Recharts colors come from the theme via useChartTheme() so they adapt to
// light/dark; each chart sub-component reads `ct` and uses ct.grid/jade/etc.

type ChartTab = "smile" | "term" | "oi" | "volume" | "greek" | "gex" | "surface";
type ExpiryFilter = "all" | ExpiryKind | "weekly";

const CHART_TABS: { key: ChartTab; label: string }[] = [
  { key: "smile", label: "Smile / skew" },
  { key: "term", label: "Term structure" },
  { key: "oi", label: "Open interest" },
  { key: "volume", label: "Volume" },
  { key: "greek", label: "Greeks" },
  { key: "gex", label: "Dealer gamma" },
  { key: "surface", label: "3D IV surface" },
];

/** On-canvas chart height for the lens — shorter than a carded chart needs. */
const LENS_HEIGHT = 260;

export function OptionsChainView({
  ticker,
  contracts,
  ivByOcc,
  chainPrice,
  snapshotPrice,
  heldLegs,
  currency = "USD",
}: {
  ticker: string;
  contracts: OptionQuote[];
  ivByOcc: Record<string, number>;
  /** Underlying price quoted alongside the chain (delayed), or null. */
  chainPrice: number | null;
  /** Finnhub REST snapshot price for the underlying, or null. */
  snapshotPrice: number | null;
  /** Option legs you hold on this underlying (OCC-tickered holdings). */
  heldLegs: HoldingRow[];
  currency?: string;
}) {
  const { quotes } = useLivePrices();
  const live = quotes[ticker.toUpperCase()]?.price ?? null;
  const spot = live ?? snapshotPrice ?? chainPrice ?? null;

  const expiries = useMemo(() => listExpiries(contracts), [contracts]);
  const heldExpiries = useMemo(
    () =>
      new Set(
        heldLegs
          .map((h) => parseOccSymbol(h.ticker)?.expiry)
          .filter((e): e is string => Boolean(e)),
      ),
    [heldLegs],
  );

  const [filter, setFilter] = useState<ExpiryFilter>("all");
  const shownExpiries = useMemo(
    () => (filter === "all" ? expiries : expiries.filter((e) => e.kind === filter || (filter === "weekly" && e.kind === "weekly"))),
    [expiries, filter],
  );

  // Default to the nearest non-expired expiry that has contracts.
  const [selected, setSelected] = useState<string | null>(null);
  const selectedExpiry = useMemo(() => {
    const pool = shownExpiries.length ? shownExpiries : expiries;
    if (selected && pool.some((e) => e.expiry === selected)) return selected;
    return (pool.find((e) => e.dte >= 0) ?? pool[0])?.expiry ?? null;
  }, [selected, shownExpiries, expiries]);

  const [tab, setTab] = useState<ChartTab>("smile");

  const heldOccs = useMemo(
    () => new Set(heldLegs.map((h) => h.ticker?.toUpperCase()).filter(Boolean) as string[]),
    [heldLegs],
  );

  // Legs for the builder live here so a click on a bid or ask in the chain can
  // add one. Counts are whole contracts; the builder scales to shares.
  const [builderLegs, setBuilderLegs] = useState<ManualLeg[]>([]);
  const addBuilderLeg = (right: "call" | "put", strike: number, side: "long" | "short") =>
    setBuilderLegs((legs) => [
      ...legs,
      {
        id: legs.reduce((mx, l) => Math.max(mx, l.id), 0) + 1,
        right,
        strike,
        contracts: side === "long" ? 1 : -1,
      },
    ]);

  if (!contracts.length) {
    return (
      <DeskNote>
        No live option chain is available for <span className="mono text-[var(--brass)]">{ticker}</span>{" "}
        right now. CBOE lists chains for optionable US equities and ETFs — if this is one, try again
        in a moment (the feed is cached and occasionally unreachable).
      </DeskNote>
    );
  }

  const pool = shownExpiries.length ? shownExpiries : expiries;

  return (
    <div className="space-y-9">
      <PositioningHeader
        ticker={ticker}
        contracts={contracts}
        spot={spot}
        isLive={live != null}
        selectedExpiry={selectedExpiry}
        heldLegs={heldLegs}
        currency={currency}
      />

      {/* The chain: expiry controls, then calls | strike | puts on the canvas. */}
      <section aria-label="Chain" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">
            <Segmented
              label="Expiry type"
              value={filter}
              onChange={setFilter}
              options={[
                { value: "all", label: "All" },
                { value: "weekly", label: "Weeklies" },
                { value: "monthly", label: "Monthlies" },
                { value: "quarterly", label: "Quarterlies" },
              ]}
            />
            <div
              role="group"
              aria-label="Expiration"
              className="flex min-w-0 max-w-full gap-1 overflow-x-auto"
            >
              {pool.map((e) => (
                <ChoicePill
                  key={e.expiry}
                  on={e.expiry === selectedExpiry}
                  onClick={() => setSelected(e.expiry)}
                  title={`${e.dte >= 0 ? `${e.dte} days to expiry` : "expired"} · ${e.kind}${
                    heldExpiries.has(e.expiry) ? " · you hold legs here" : ""
                  }`}
                >
                  {formatOptionExpiry(e.expiry)} · {e.dte >= 0 ? `${e.dte}d` : "exp"}
                  {e.kind !== "weekly" ? ` · ${e.kind === "quarterly" ? "Q" : "M"}` : ""}
                  {heldExpiries.has(e.expiry) && <span className="text-[var(--brass)]"> ◆</span>}
                </ChoicePill>
              ))}
            </div>
          </div>
          <span className="text-xs text-[var(--muted)]">
            <span className="text-[var(--jade)]">Calls</span> /{" "}
            <span className="text-[var(--coral)]">Puts</span> · shaded cells are in the money
            {heldOccs.size > 0 ? " · brass cells are legs you hold" : ""}
          </span>
        </div>

        {selectedExpiry && (
          <ChainTable
            contracts={contractsForExpiry(contracts, selectedExpiry)}
            spot={spot}
            heldOccs={heldOccs}
            onPick={addBuilderLeg}
            summary={`${expiries.length} expiries · ${contracts.length} contracts`}
          />
        )}
      </section>

      {/* One lens at a time over the same chain. */}
      <section aria-label="Chain analytics" className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-x-4 border-b border-[var(--line-strong)]">
          <div role="group" aria-label="Lens" className="flex max-w-full gap-1 overflow-x-auto">
            {CHART_TABS.map(({ key, label }) => (
              <LensTab key={key} on={tab === key} onClick={() => setTab(key)}>
                {label}
              </LensTab>
            ))}
          </div>
          <span className="pb-2.5 text-xs text-[var(--muted)]">
            {selectedExpiry && tab !== "term" && tab !== "surface"
              ? `${formatOptionExpiry(selectedExpiry)} · `
              : ""}
            free CBOE chain · delayed ~15m
          </span>
        </div>
        <ChartPanel
          tab={tab}
          ticker={ticker}
          contracts={contracts}
          selectedExpiry={selectedExpiry}
          spot={spot}
        />
      </section>

      <StrategyBuilder
        ticker={ticker}
        contracts={contracts}
        selectedExpiry={selectedExpiry}
        spot={spot}
        currency={currency}
        legs={builderLegs}
        onLegsChange={setBuilderLegs}
      />

      {heldLegs.length > 0 && (
        <section className="space-y-4">
          <SectionHead title={`Your positions in ${ticker}`} count={heldLegs.length} />
          <OptionsAnalytics
            legs={heldLegs}
            quotes={quotes}
            ivByOcc={ivByOcc}
            underlyingPrices={spot != null ? { [ticker]: spot } : {}}
            chainByUnderlying={{ [ticker]: contracts }}
            currency={currency}
          />
        </section>
      )}
    </div>
  );
}

// ── Positioning header ──────────────────────────────────────────────────────

function PositioningHeader({
  ticker,
  contracts,
  spot,
  isLive,
  selectedExpiry,
  heldLegs,
  currency,
}: {
  ticker: string;
  contracts: OptionQuote[];
  spot: number | null;
  isLive: boolean;
  selectedExpiry: string | null;
  heldLegs: HoldingRow[];
  currency: string;
}) {
  const stats = useMemo(() => {
    const chainPc = putCallStats(contracts);
    const exp = selectedExpiry;
    const expContracts = exp ? contractsForExpiry(contracts, exp) : [];
    const expPc = putCallStats(expContracts);
    const atm = exp ? atmIv(contracts, exp, spot) : null;
    const pain = exp ? maxPain(contracts, exp) : null;
    const sk = exp ? skew25(contracts, exp, spot) : null;
    const gex = exp ? totalGex(contracts, exp, spot) : null;
    const dte = exp ? Math.max(0, daysToExpiry(exp)) : 0;
    const em = expectedMove(spot, atm, dte / 365);
    return { chainPc, expPc, atm, pain, sk, gex, em, dte };
  }, [contracts, spot, selectedExpiry]);

  // Sentiment read from the chain-wide put/call OI ratio.
  const pc = stats.chainPc.oiRatio;
  const sentiment =
    pc == null
      ? ({ label: "—", tone: "muted" } as const)
      : pc > 1.15
        ? ({ label: "Put-heavy / hedged", tone: "coral" } as const)
        : pc < 0.7
          ? ({ label: "Call-heavy / bullish", tone: "jade" } as const)
          : ({ label: "Balanced", tone: "default" } as const);

  const skewRead =
    stats.sk == null
      ? "—"
      : stats.sk > 0.01
        ? "Downside (puts bid)"
        : stats.sk < -0.01
          ? "Upside (calls bid)"
          : "Flat";

  // Where the legs you hold on this expiry sit against the priced-in move.
  const held = useMemo(
    () =>
      heldLegs
        .map((h) => parseOccSymbol(h.ticker))
        .filter((p): p is NonNullable<typeof p> => p != null && p.expiry === selectedExpiry),
    [heldLegs, selectedExpiry],
  );
  const hasMove = stats.em != null && spot != null;
  const inside = hasMove ? held.filter((p) => Math.abs(p.strike - spot!) <= stats.em!).length : 0;

  return (
    <section aria-label={`${ticker} chain summary`}>
      <HeroLine
        hero={
          <Hero
            className="min-w-0 flex-1 basis-[22rem]"
            eyebrow={
              hasMove && selectedExpiry
                ? `${ticker} · expected move to ${formatOptionExpiry(selectedExpiry)}`
                : `${ticker} · spot`
            }
            figure={
              hasMove
                ? `±${formatCurrency(stats.em!, currency)}`
                : spot != null
                  ? formatCurrency(spot, currency)
                  : "—"
            }
            verdict={
              <>
                {hasMove && (
                  <>
                    Spot is <Mark tone="default">{formatCurrency(spot!, currency)}</Mark> and the{" "}
                  </>
                )}
                {hasMove ? "chain reads " : "Positioning reads "}
                <Mark tone={sentiment.tone}>
                  {sentiment.label === "—" ? "unclear" : sentiment.label.toLowerCase()}
                </Mark>
                .
                {hasMove && held.length === 1 && (
                  <>
                    {" "}
                    Your{" "}
                    <Mark tone="brass">
                      {formatStrike(held[0].strike)} {held[0].right}
                    </Mark>{" "}
                    sits {inside === 1 ? "inside" : "outside"} the one-sigma range.
                  </>
                )}
                {hasMove && held.length > 1 && (
                  <>
                    {" "}
                    <Mark tone="brass">
                      {inside} of your {held.length} legs
                    </Mark>{" "}
                    here sit inside the one-sigma range.
                  </>
                )}
              </>
            }
          >
            <span
              className={`inline-flex items-center gap-1 text-[10px] uppercase tracking-wide ${
                isLive ? "text-[var(--jade)]" : "text-[var(--muted)]"
              }`}
            >
              <span
                className={`inline-block h-1.5 w-1.5 rounded-full ${isLive ? "bg-[var(--jade)] animate-pulse" : "bg-[var(--muted)]"}`}
              />
              {isLive ? "live" : "delayed"}
            </span>
          </Hero>
        }
      >
        <SideFigure
          label={selectedExpiry ? `ATM IV · ${stats.dte}d` : "ATM IV"}
          value={stats.atm != null ? `${(stats.atm * 100).toFixed(1)}%` : "—"}
        />
        {/* The hero carries the move when there is one; otherwise it is "—" here. */}
        {!hasMove && <SideFigure label="Exp. move ±1σ" value="—" />}
        <SideFigure label="Max pain" value={stats.pain != null ? formatStrike(stats.pain) : "—"} />
        <SideFigure
          label="P/C ratio (OI) · whole chain"
          tone={sentiment.tone === "default" ? undefined : sentiment.tone}
          value={
            stats.chainPc.oiRatio != null
              ? `${stats.chainPc.oiRatio.toFixed(2)} · ${sentiment.label}`
              : "—"
          }
        />
        <SideFigure label="Skew" value={skewRead} />
        <SideFigure
          label="Dealer GEX"
          tone={stats.gex == null ? undefined : stats.gex >= 0 ? "jade" : "coral"}
          value={
            stats.gex != null
              ? `${compactSigned(stats.gex)} · ${stats.gex >= 0 ? "positive · pinning" : "negative · volatile"}`
              : "—"
          }
        />
      </HeroLine>
    </section>
  );
}

/** "$1.2B" / "−$840M" — compact, signed dollar magnitude for GEX. */
function compactSigned(n: number): string {
  const sign = n < 0 ? "−" : "";
  const abs = Math.abs(n);
  const unit = abs >= 1e9 ? ["B", 1e9] : abs >= 1e6 ? ["M", 1e6] : abs >= 1e3 ? ["K", 1e3] : ["", 1];
  return `${sign}$${(abs / (unit[1] as number)).toFixed(abs >= 1e9 ? 2 : 1)}${unit[0]}`;
}

// ── Chart panel ─────────────────────────────────────────────────────────────

function ChartPanel({
  tab,
  ticker,
  contracts,
  selectedExpiry,
  spot,
}: {
  tab: ChartTab;
  ticker: string;
  contracts: OptionQuote[];
  selectedExpiry: string | null;
  spot: number | null;
}) {
  return (
    <div>
      {tab === "smile" && <SmileChart contracts={contracts} expiry={selectedExpiry} spot={spot} />}
      {tab === "term" && <TermChart contracts={contracts} spot={spot} />}
      {tab === "oi" && (
        <FlowChart contracts={contracts} expiry={selectedExpiry} spot={spot} metric="oi" />
      )}
      {tab === "volume" && (
        <FlowChart contracts={contracts} expiry={selectedExpiry} spot={spot} metric="volume" />
      )}
      {tab === "greek" && <GreekChart contracts={contracts} expiry={selectedExpiry} spot={spot} />}
      {tab === "gex" && <GexChart contracts={contracts} expiry={selectedExpiry} spot={spot} />}
      {tab === "surface" && <SurfacePanel ticker={ticker} contracts={contracts} spot={spot} />}
    </div>
  );
}

function EmptyChart({ label }: { label: string }) {
  return <p className="py-16 text-center text-sm text-[var(--muted)]">{label}</p>;
}

// Smile / skew — call & put IV vs strike for one expiry.
function SmileChart({
  contracts,
  expiry,
  spot,
}: {
  contracts: OptionQuote[];
  expiry: string | null;
  spot: number | null;
}) {
  const ct = useChartTheme();
  const data = useMemo(
    () => (expiry ? volatilitySmile(contracts, expiry, spot) : []),
    [contracts, expiry, spot],
  );
  const rows = data
    .filter((d) => d.callIv != null || d.putIv != null)
    .map((d) => ({
      strike: d.strike,
      call: d.callIv != null ? d.callIv * 100 : null,
      put: d.putIv != null ? d.putIv * 100 : null,
    }));
  if (rows.length < 2) return <EmptyChart label="Not enough priced strikes for a smile." />;
  return (
    <ResponsiveContainer width="100%" height={LENS_HEIGHT}>
      <LineChart data={rows} margin={{ left: 4, right: 12, top: 8, bottom: 4 }}>
        <CartesianGrid stroke={ct.grid} strokeDasharray="2 4" vertical={false} />
        <XAxis
          dataKey="strike"
          type="number"
          domain={["dataMin", "dataMax"]}
          tick={ct.tick}
          tickFormatter={(v) => formatStrike(v)}
          tickLine={false}
          axisLine={{ stroke: ct.grid }}
        />
        <YAxis
          tick={ct.tick}
          tickFormatter={(v) => `${v.toFixed(0)}%`}
          tickLine={false}
          axisLine={false}
          width={44}
        />
        <Tooltip
          contentStyle={ct.tooltipStyle}
          formatter={(value, name) => {
            const v = Number(value);
            return [Number.isFinite(v) ? `${v.toFixed(1)}%` : "—", name === "call" ? "Call IV" : "Put IV"];
          }}
          labelFormatter={(l) => `Strike ${formatStrike(Number(l))}`}
        />
        {spot != null && (
          <ReferenceLine x={spot} stroke={ct.brass} strokeDasharray="4 4" label={{ value: "spot", fill: ct.brass, fontSize: 10, position: "top" }} />
        )}
        <Line type="monotone" dataKey="call" stroke={ct.jade} strokeWidth={2} dot={false} connectNulls name="call" />
        <Line type="monotone" dataKey="put" stroke={ct.coral} strokeWidth={2} dot={false} connectNulls name="put" />
      </LineChart>
    </ResponsiveContainer>
  );
}

// IV term structure — ATM IV vs DTE across all expiries.
function TermChart({ contracts, spot }: { contracts: OptionQuote[]; spot: number | null }) {
  const ct = useChartTheme();
  const rows = useMemo(
    () =>
      ivTermStructure(contracts, spot)
        .filter((t) => t.atmIv != null && t.dte >= 0)
        .map((t) => ({ dte: t.dte, iv: (t.atmIv as number) * 100, expiry: t.expiry })),
    [contracts, spot],
  );
  if (rows.length < 2) return <EmptyChart label="Need ATM IV on ≥2 expiries (and a spot price)." />;
  return (
    <ResponsiveContainer width="100%" height={LENS_HEIGHT}>
      <LineChart data={rows} margin={{ left: 4, right: 12, top: 8, bottom: 4 }}>
        <CartesianGrid stroke={ct.grid} strokeDasharray="2 4" vertical={false} />
        <XAxis
          dataKey="dte"
          type="number"
          domain={["dataMin", "dataMax"]}
          tick={ct.tick}
          tickFormatter={(v) => `${v}d`}
          tickLine={false}
          axisLine={{ stroke: ct.grid }}
        />
        <YAxis tick={ct.tick} tickFormatter={(v) => `${v.toFixed(0)}%`} tickLine={false} axisLine={false} width={44} />
        <Tooltip
          contentStyle={ct.tooltipStyle}
          formatter={(value) => [`${Number(value).toFixed(1)}%`, "ATM IV"]}
          labelFormatter={(l) => `${l}d to expiry`}
        />
        <Line type="monotone" dataKey="iv" stroke={ct.brass} strokeWidth={2} dot={{ r: 2.5, fill: ct.brass }} />
      </LineChart>
    </ResponsiveContainer>
  );
}

// Open interest / volume by strike — calls vs puts, with spot + max pain marks.
function FlowChart({
  contracts,
  expiry,
  spot,
  metric,
}: {
  contracts: OptionQuote[];
  expiry: string | null;
  spot: number | null;
  metric: "oi" | "volume";
}) {
  const ct = useChartTheme();
  const { rows, pain } = useMemo(() => {
    if (!expiry) return { rows: [], pain: null as number | null };
    const flow = flowByStrike(contracts, expiry).map((f) => ({
      strike: f.strike,
      call: metric === "oi" ? f.callOi : f.callVol,
      put: metric === "oi" ? f.putOi : f.putVol,
    }));
    return { rows: flow, pain: metric === "oi" ? maxPain(contracts, expiry) : null };
  }, [contracts, expiry, metric]);
  if (rows.length < 1 || rows.every((r) => r.call === 0 && r.put === 0))
    return <EmptyChart label={`No ${metric === "oi" ? "open interest" : "volume"} on this expiry.`} />;
  return (
    <ResponsiveContainer width="100%" height={LENS_HEIGHT}>
      <BarChart data={rows} margin={{ left: 4, right: 12, top: 8, bottom: 4 }} barGap={0}>
        <CartesianGrid stroke={ct.grid} strokeDasharray="2 4" vertical={false} />
        <XAxis
          dataKey="strike"
          type="number"
          domain={["dataMin", "dataMax"]}
          tick={ct.tick}
          tickFormatter={(v) => formatStrike(v)}
          tickLine={false}
          axisLine={{ stroke: ct.grid }}
        />
        <YAxis tick={ct.tick} tickFormatter={(v) => compactNum(v)} tickLine={false} axisLine={false} width={48} />
        <Tooltip
          contentStyle={ct.tooltipStyle}
          formatter={(value, name) => [compactNum(Number(value)), name === "call" ? "Calls" : "Puts"]}
          labelFormatter={(l) => `Strike ${formatStrike(Number(l))}`}
        />
        {spot != null && <ReferenceLine x={spot} stroke={ct.brass} strokeDasharray="4 4" label={{ value: "spot", fill: ct.brass, fontSize: 10, position: "top" }} />}
        {pain != null && <ReferenceLine x={pain} stroke={ct.blue} strokeDasharray="2 2" label={{ value: "max pain", fill: ct.blue, fontSize: 10, position: "insideTopRight" }} />}
        <Bar dataKey="call" fill={ct.jade} fillOpacity={0.85} name="call" />
        <Bar dataKey="put" fill={ct.coral} fillOpacity={0.85} name="put" />
      </BarChart>
    </ResponsiveContainer>
  );
}

// Selectable greek by strike (call + put).
function GreekChart({
  contracts,
  expiry,
  spot,
}: {
  contracts: OptionQuote[];
  expiry: string | null;
  spot: number | null;
}) {
  const ct = useChartTheme();
  const [greek, setGreek] = useState<GreekKey>("delta");
  const rows = useMemo(() => {
    if (!expiry) return [];
    // Fall back to Black-Scholes greeks when the source omits them, so the chart
    // isn't empty for chains that only ship IV.
    const g = greekByStrike(contracts, expiry, greek);
    if (g.some((r) => r.call != null || r.put != null)) return g;
    const bs = new Map<number, { call: number | null; put: number | null }>();
    for (const c of contractsForExpiry(contracts, expiry)) {
      const parsed = parseOccSymbol(c.occ);
      if (!parsed) continue;
      const val = computeGreeks(parsed, spot, c.iv)[greek];
      const row = bs.get(c.strike) ?? { call: null, put: null };
      if (c.right === "call") row.call = val;
      else row.put = val;
      bs.set(c.strike, row);
    }
    return Array.from(bs.entries())
      .map(([strike, v]) => ({ strike, call: v.call, put: v.put }))
      .sort((a, b) => a.strike - b.strike);
  }, [contracts, expiry, greek, spot]);

  return (
    <div className="space-y-4">
      <Segmented
        label="Greek"
        value={greek}
        onChange={setGreek}
        options={[
          { value: "delta", label: "Delta" },
          { value: "gamma", label: "Gamma" },
          { value: "theta", label: "Theta" },
          { value: "vega", label: "Vega" },
        ]}
      />
      {rows.filter((r) => r.call != null || r.put != null).length < 2 ? (
        <EmptyChart label="Not enough greek data on this expiry." />
      ) : (
        <ResponsiveContainer width="100%" height={LENS_HEIGHT}>
          <LineChart data={rows} margin={{ left: 4, right: 12, top: 8, bottom: 4 }}>
            <CartesianGrid stroke={ct.grid} strokeDasharray="2 4" vertical={false} />
            <XAxis
              dataKey="strike"
              type="number"
              domain={["dataMin", "dataMax"]}
              tick={ct.tick}
              tickFormatter={(v) => formatStrike(v)}
              tickLine={false}
              axisLine={{ stroke: ct.grid }}
            />
            <YAxis tick={ct.tick} tickLine={false} axisLine={false} width={52} />
            <Tooltip
              contentStyle={ct.tooltipStyle}
              formatter={(value, name) => {
                const v = Number(value);
                return [Number.isFinite(v) ? v.toFixed(4) : "—", name === "call" ? "Call" : "Put"];
              }}
              labelFormatter={(l) => `Strike ${formatStrike(Number(l))}`}
            />
            {spot != null && <ReferenceLine x={spot} stroke={ct.brass} strokeDasharray="4 4" />}
            <Line type="monotone" dataKey="call" stroke={ct.jade} strokeWidth={2} dot={false} connectNulls name="call" />
            <Line type="monotone" dataKey="put" stroke={ct.coral} strokeWidth={2} dot={false} connectNulls name="put" />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

// Dealer gamma exposure by strike.
function GexChart({
  contracts,
  expiry,
  spot,
}: {
  contracts: OptionQuote[];
  expiry: string | null;
  spot: number | null;
}) {
  const ct = useChartTheme();
  const rows = useMemo(
    () => (expiry ? gammaExposureByStrike(contracts, expiry, spot) : []),
    [contracts, expiry, spot],
  );
  if (rows.length < 2)
    return <EmptyChart label="Dealer GEX needs per-contract gamma + open interest (CBOE chain) and a spot price." />;
  return (
    <ResponsiveContainer width="100%" height={LENS_HEIGHT}>
      <ComposedChart data={rows} margin={{ left: 4, right: 12, top: 8, bottom: 4 }}>
        <CartesianGrid stroke={ct.grid} strokeDasharray="2 4" vertical={false} />
        <XAxis
          dataKey="strike"
          type="number"
          domain={["dataMin", "dataMax"]}
          tick={ct.tick}
          tickFormatter={(v) => formatStrike(v)}
          tickLine={false}
          axisLine={{ stroke: ct.grid }}
        />
        <YAxis tick={ct.tick} tickFormatter={(v) => compactNum(v)} tickLine={false} axisLine={false} width={52} />
        <Tooltip
          contentStyle={ct.tooltipStyle}
          formatter={(value) => [compactSigned(Number(value)), "GEX"]}
          labelFormatter={(l) => `Strike ${formatStrike(Number(l))}`}
        />
        <ReferenceLine y={0} stroke={ct.gridStrong} />
        {spot != null && <ReferenceLine x={spot} stroke={ct.brass} strokeDasharray="4 4" label={{ value: "spot", fill: ct.brass, fontSize: 10, position: "top" }} />}
        <Bar dataKey="gex" name="gex">
          {rows.map((r) => (
            <Cell key={r.strike} fill={r.gex >= 0 ? ct.jade : ct.coral} fillOpacity={0.85} />
          ))}
        </Bar>
      </ComposedChart>
    </ResponsiveContainer>
  );
}

// 3D IV surface with a call/put/mid side toggle.
function SurfacePanel({
  contracts,
  spot,
}: {
  ticker: string;
  contracts: OptionQuote[];
  spot: number | null;
}) {
  const [side, setSide] = useState<"call" | "put" | "mid">("mid");
  const surface = useMemo(
    () => buildIvSurface(contracts, spot, { side, strikeWindow: 14 }),
    [contracts, spot, side],
  );
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
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
        <span className="text-xs text-[var(--muted)]">strike × expiry × IV · drag to rotate</span>
      </div>
      <IvSurface surface={surface} height={380} />
    </div>
  );
}

// ── Chain table (calls | strike | puts) for one expiry ──────────────────────

/** Strikes shown each side of spot before the "show all" expander. */
const WINDOW = 12;

function ChainTable({
  contracts,
  spot,
  heldOccs,
  onPick,
  summary,
}: {
  contracts: OptionQuote[];
  spot: number | null;
  heldOccs: Set<string>;
  /** Add a one-contract leg to the builder: buy at the ask, sell at the bid. */
  onPick: (right: "call" | "put", strike: number, side: "long" | "short") => void;
  /** Chain-wide count line for the footer. */
  summary: string;
}) {
  const [showAll, setShowAll] = useState(false);
  const { strikes, calls, puts, hidden } = useMemo(() => {
    const calls = new Map<number, OptionQuote>();
    const puts = new Map<number, OptionQuote>();
    for (const c of contracts) (c.right === "call" ? calls : puts).set(c.strike, c);
    let strikes = Array.from(new Set(contracts.map((c) => c.strike))).sort((a, b) => a - b);
    const total = strikes.length;
    if (!showAll && spot != null && strikes.length > WINDOW * 2 + 1) {
      let ci = 0;
      for (let i = 0; i < strikes.length; i++) {
        if (Math.abs(strikes[i] - spot) < Math.abs(strikes[ci] - spot)) ci = i;
      }
      strikes = strikes.slice(Math.max(0, ci - WINDOW), ci + WINDOW + 1);
    }
    return { strikes, calls, puts, hidden: total - strikes.length };
  }, [contracts, spot, showAll]);

  const nearest =
    spot != null ? Math.min(...strikes.map((s) => Math.abs(s - spot))) : null;

  const th = "px-2.5 pb-2.5 text-right text-xs font-normal text-[var(--muted)]";

  return (
    <div className="space-y-3">
      <div className={ruled.scroll}>
        <table className="mono w-full min-w-[860px] text-[13px]">
          <thead>
            <tr className="border-b border-[var(--line-strong)]">
              {["OI", "Vol", "IV", "Δ", "Bid", "Ask"].map((h) => (
                <th key={`c-${h}`} className={th}>
                  {h}
                </th>
              ))}
              <th className="sticky left-0 z-10 border-x border-line bg-[var(--ink)] px-3 pb-2.5 text-center text-xs font-normal text-[var(--paper)]">
                Strike
              </th>
              {["Bid", "Ask", "Δ", "IV", "Vol", "OI"].map((h) => (
                <th key={`p-${h}`} className={th}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {strikes.map((k) => {
              const call = calls.get(k);
              const put = puts.get(k);
              const callG = greekDelta(call, spot);
              const putG = greekDelta(put, spot);
              const callHeld = call ? heldOccs.has(call.occ) : false;
              const putHeld = put ? heldOccs.has(put.occ) : false;
              const callItm = spot != null && spot > k;
              const putItm = spot != null && spot < k;
              const atSpot = nearest != null && spot != null && Math.abs(k - spot) === nearest;
              return (
                <tr key={k} className="border-b border-line">
                  <Cell2 value={call?.openInterest ?? null} digits={0} on={callHeld} itm={callItm} />
                  <Cell2 value={call?.volume ?? null} digits={0} on={callHeld} itm={callItm} />
                  <Cell2 value={call?.iv != null ? call.iv * 100 : null} digits={0} suffix="%" on={callHeld} itm={callItm} />
                  <Cell2 value={callG} digits={2} on={callHeld} itm={callItm} />
                  <Cell2
                    value={call?.bid ?? null}
                    digits={2}
                    on={callHeld}
                    itm={callItm}
                    onClick={call ? () => onPick("call", k, "short") : undefined}
                    actionLabel={`Sell 1 ${formatStrike(k)} call at the bid — add to the builder`}
                  />
                  <Cell2
                    value={call?.ask ?? null}
                    digits={2}
                    on={callHeld}
                    itm={callItm}
                    onClick={call ? () => onPick("call", k, "long") : undefined}
                    actionLabel={`Buy 1 ${formatStrike(k)} call at the ask — add to the builder`}
                  />
                  <td
                    className={`sticky left-0 z-10 border-x border-line bg-[var(--ink)] px-3 py-2 text-center font-medium ${
                      atSpot ? "text-[var(--brass)]" : "text-[var(--paper)]"
                    }`}
                    title={atSpot ? "Nearest strike to spot" : undefined}
                  >
                    {formatStrike(k)}
                  </td>
                  <Cell2
                    value={put?.bid ?? null}
                    digits={2}
                    on={putHeld}
                    itm={putItm}
                    onClick={put ? () => onPick("put", k, "short") : undefined}
                    actionLabel={`Sell 1 ${formatStrike(k)} put at the bid — add to the builder`}
                  />
                  <Cell2
                    value={put?.ask ?? null}
                    digits={2}
                    on={putHeld}
                    itm={putItm}
                    onClick={put ? () => onPick("put", k, "long") : undefined}
                    actionLabel={`Buy 1 ${formatStrike(k)} put at the ask — add to the builder`}
                  />
                  <Cell2 value={putG} digits={2} on={putHeld} itm={putItm} />
                  <Cell2 value={put?.iv != null ? put.iv * 100 : null} digits={0} suffix="%" on={putHeld} itm={putItm} />
                  <Cell2 value={put?.volume ?? null} digits={0} on={putHeld} itm={putItm} />
                  <Cell2 value={put?.openInterest ?? null} digits={0} on={putHeld} itm={putItm} />
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <RuledFooter
        className="border-t-0 pt-0 text-xs"
        note={
          <>
            Quotes are per share; one contract is 100 shares. Click a bid or ask to add that leg to
            the builder below. The brass strike is nearest spot. {summary}.
          </>
        }
      >
        {hidden > 0 && (
          <button
            type="button"
            onClick={() => setShowAll(true)}
            className="text-[13px] text-[var(--brass)] hover:underline"
          >
            Show all {strikes.length + hidden} strikes
          </button>
        )}
        {showAll && (
          <button
            type="button"
            onClick={() => setShowAll(false)}
            className="text-[13px] text-[var(--muted)] hover:underline"
          >
            Collapse to near-spot
          </button>
        )}
      </RuledFooter>
    </div>
  );
}

/** Real (source) delta if present, else Black-Scholes from IV, else null. */
function greekDelta(q: OptionQuote | undefined, spot: number | null): number | null {
  if (!q) return null;
  if (q.greeks?.delta != null) return q.greeks.delta;
  const parsed = parseOccSymbol(q.occ);
  return parsed ? computeGreeks(parsed, spot, q.iv).delta : null;
}

function Cell2({
  value,
  digits,
  suffix = "",
  on,
  itm,
  onClick,
  actionLabel,
}: {
  value: number | null;
  digits: number;
  suffix?: string;
  on: boolean;
  itm: boolean;
  /** Makes the figure a button (bid/ask → add a leg to the builder). */
  onClick?: () => void;
  actionLabel?: string;
}) {
  const tone = on
    ? "bg-[var(--brass)]/15 font-medium text-[var(--brass)]"
    : `${itm ? "bg-[var(--panel)]" : ""} ${value == null ? "text-[var(--muted)]" : "text-[var(--paper)]"}`;
  const text =
    value == null
      ? "—"
      : `${digits === 0 ? Math.round(value).toLocaleString() : value.toFixed(digits)}${suffix}`;
  return (
    <td className={`px-2.5 py-2 text-right ${tone}`}>
      {onClick && value != null ? (
        <button
          type="button"
          onClick={onClick}
          title={actionLabel}
          aria-label={actionLabel}
          className="rounded underline-offset-2 hover:text-[var(--brass)] hover:underline"
        >
          {text}
        </button>
      ) : (
        text
      )}
    </td>
  );
}

/** "12.3K" / "4.5M" — compact unsigned integer for OI/volume axes. */
function compactNum(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return `${Math.round(n)}`;
}
