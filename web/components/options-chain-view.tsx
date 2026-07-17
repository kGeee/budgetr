"use client";

/**
 * Per-ticker options desk — the full options picture for ONE underlying, driven
 * by the complete CBOE/Yahoo chain (every listed expiry + strike, weeklies and
 * all), not just the legs you happen to hold.
 *
 * Layout:
 *   1. Positioning header — spot, ATM IV, put/call ratios, max pain, expected
 *      move, skew, dealer gamma — the read an options trader takes off the chain.
 *   2. Controls — an expiry dropdown (with weekly/monthly/all filter) and a
 *      segmented chart selector.
 *   3. The selected visualization — volatility smile, IV term structure, open
 *      interest, volume, a selectable greek-by-strike, dealer GEX, or the 3D IV
 *      surface.
 *   4. The raw calls | strike | puts chain table for the chosen expiry, with the
 *      contracts you hold highlighted.
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
import {
  Activity,
  CalendarClock,
  Gauge,
  Layers,
  LineChart as LineChartIcon,
  Boxes,
  Sigma,
  TrendingUp,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { IvSurface } from "@/components/iv-surface";
import { OptionsAnalytics } from "@/components/options-analytics";
import { StrategyBuilder } from "@/components/strategy-builder";
import { useLivePrices } from "@/components/live-prices";
import type { HoldingRow } from "@/components/portfolio-view";
import { formatCurrency } from "@/lib/utils";
import {
  daysToExpiry,
  formatOptionExpiry,
  formatStrike,
  parseOccSymbol,
} from "@/lib/options";
import { computeGreeks } from "@/lib/greeks";
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

// Shared recharts styling — mirrors components/charts.tsx so the new charts read
// as the same system (the module-level consts there aren't exported).
const GRID = "#212a27";
const tick = { fill: "#8b948c", fontSize: 11, fontFamily: "var(--font-mono)" };
const tooltipStyle = {
  background: "#101413",
  border: "1px solid #303b37",
  borderRadius: 12,
  fontSize: 12,
  color: "#ece7da",
  padding: "8px 12px",
  boxShadow: "0 30px 60px -32px rgba(0,0,0,0.9)",
  fontFamily: "var(--font-mono)",
} as const;
const JADE = "#6fe3a6";
const CORAL = "#f0897b";
const BRASS = "#cbb07c";
const BLUE = "#7fb2e0";

type ChartTab = "smile" | "term" | "oi" | "volume" | "greek" | "gex" | "surface";
type ExpiryFilter = "all" | ExpiryKind | "weekly";

const CHART_TABS: { key: ChartTab; label: string; icon: typeof Activity }[] = [
  { key: "smile", label: "Smile / skew", icon: Activity },
  { key: "term", label: "Term structure", icon: TrendingUp },
  { key: "oi", label: "Open interest", icon: Layers },
  { key: "volume", label: "Volume", icon: LineChartIcon },
  { key: "greek", label: "Greeks", icon: Sigma },
  { key: "gex", label: "Dealer gamma", icon: Gauge },
  { key: "surface", label: "3D IV surface", icon: Boxes },
];

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

  if (!contracts.length) {
    return (
      <Card className="p-10 text-center">
        <p className="text-sm text-[var(--muted)]">
          No live option chain is available for <span className="text-[var(--brass)]">{ticker}</span>{" "}
          right now. CBOE lists chains for optionable US equities and ETFs — if this is one, try again
          in a moment (the feed is cached and occasionally unreachable).
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <PositioningHeader
        ticker={ticker}
        contracts={contracts}
        spot={spot}
        isLive={live != null}
        selectedExpiry={selectedExpiry}
        currency={currency}
      />

      {/* Expiry selector + filter */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <CalendarClock size={14} className="text-[var(--brass)]" />
          <label htmlFor="expiry" className="eyebrow">
            Expiry
          </label>
          <select
            id="expiry"
            value={selectedExpiry ?? ""}
            onChange={(e) => setSelected(e.target.value)}
            className="rounded-lg border border-line bg-[var(--panel)] px-3 py-1.5 text-sm text-[var(--paper)] outline-none focus:border-[var(--brass-dim)]"
          >
            {(shownExpiries.length ? shownExpiries : expiries).map((e) => (
              <option key={e.expiry} value={e.expiry}>
                {formatOptionExpiry(e.expiry)} · {e.dte >= 0 ? `${e.dte}d` : "exp"}
                {heldExpiries.has(e.expiry) ? " ◆" : ""}
                {e.kind !== "weekly" ? ` · ${e.kind === "quarterly" ? "Q" : "M"}` : ""}
              </option>
            ))}
          </select>
        </div>

        <Segmented
          value={filter}
          onChange={(v) => setFilter(v as ExpiryFilter)}
          options={[
            { key: "all", label: "All" },
            { key: "weekly", label: "Weeklies" },
            { key: "monthly", label: "Monthlies" },
            { key: "quarterly", label: "Quarterlies" },
          ]}
        />

        <span className="ml-auto text-xs text-[var(--muted)]">
          {expiries.length} expiries · {contracts.length} contracts
        </span>
      </div>

      {/* Chart selector */}
      <div className="flex flex-wrap gap-2">
        {CHART_TABS.map(({ key, label, icon: Icon }) => {
          const active = tab === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs transition-colors ${
                active
                  ? "border-[var(--brass-dim)] bg-[var(--panel-2)] text-[var(--paper)]"
                  : "border-line text-[var(--muted)] hover:text-[var(--paper)]"
              }`}
            >
              <Icon size={13} className={active ? "text-[var(--brass)]" : ""} />
              {label}
            </button>
          );
        })}
      </div>

      <ChartPanel
        tab={tab}
        ticker={ticker}
        contracts={contracts}
        selectedExpiry={selectedExpiry}
        spot={spot}
      />

      {selectedExpiry && (
        <ChainTable
          ticker={ticker}
          contracts={contractsForExpiry(contracts, selectedExpiry)}
          expiry={selectedExpiry}
          spot={spot}
          heldOccs={heldOccs}
        />
      )}

      <StrategyBuilder
        ticker={ticker}
        contracts={contracts}
        selectedExpiry={selectedExpiry}
        spot={spot}
        currency={currency}
      />

      {heldLegs.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 pt-2">
            <span className="eyebrow">Your positions in {ticker}</span>
            <span className="h-px flex-1 bg-line" />
          </div>
          <OptionsAnalytics
            legs={heldLegs}
            quotes={quotes}
            ivByOcc={ivByOcc}
            underlyingPrices={spot != null ? { [ticker]: spot } : {}}
            chainByUnderlying={{ [ticker]: contracts }}
            currency={currency}
          />
        </div>
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
  currency,
}: {
  ticker: string;
  contracts: OptionQuote[];
  spot: number | null;
  isLive: boolean;
  selectedExpiry: string | null;
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
      ? { label: "—", tone: "text-[var(--muted)]" }
      : pc > 1.15
        ? { label: "Put-heavy / hedged", tone: "text-[var(--coral)]" }
        : pc < 0.7
          ? { label: "Call-heavy / bullish", tone: "text-[var(--jade)]" }
          : { label: "Balanced", tone: "text-[var(--paper)]" };

  const skewRead =
    stats.sk == null
      ? "—"
      : stats.sk > 0.01
        ? "Downside (puts bid)"
        : stats.sk < -0.01
          ? "Upside (calls bid)"
          : "Flat";

  return (
    <Card className="p-0">
      <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-line px-6 py-5">
        <div className="flex items-baseline gap-3">
          <span className="font-display text-2xl text-[var(--paper)]">{ticker}</span>
          {spot != null && (
            <span className="mono text-lg text-[var(--brass)]">
              {formatCurrency(spot, currency)}
            </span>
          )}
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
        </div>
        <span className={`text-sm font-medium ${sentiment.tone}`}>{sentiment.label}</span>
      </div>
      <div className="grid grid-cols-2 divide-x divide-y divide-line/60 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="ATM IV" hint={selectedExpiry ? `${stats.dte}d` : undefined}>
          {stats.atm != null ? `${(stats.atm * 100).toFixed(1)}%` : "—"}
        </Stat>
        <Stat label="Exp. move ±1σ">
          {stats.em != null && spot != null ? `±${formatCurrency(stats.em, currency)}` : "—"}
        </Stat>
        <Stat label="Max pain">{stats.pain != null ? formatStrike(stats.pain) : "—"}</Stat>
        <Stat label="P/C ratio (OI)" hint="whole chain">
          {stats.chainPc.oiRatio != null ? stats.chainPc.oiRatio.toFixed(2) : "—"}
        </Stat>
        <Stat label="Skew">{skewRead}</Stat>
        <Stat
          label="Dealer GEX"
          hint={stats.gex != null ? (stats.gex >= 0 ? "positive · pinning" : "negative · volatile") : undefined}
          tone={stats.gex == null ? undefined : stats.gex >= 0 ? "jade" : "coral"}
        >
          {stats.gex != null ? compactSigned(stats.gex) : "—"}
        </Stat>
      </div>
    </Card>
  );
}

function Stat({
  label,
  hint,
  tone,
  children,
}: {
  label: string;
  hint?: string;
  tone?: "jade" | "coral";
  children: React.ReactNode;
}) {
  const color =
    tone === "jade" ? "text-[var(--jade)]" : tone === "coral" ? "text-[var(--coral)]" : "text-[var(--paper)]";
  return (
    <div className="px-5 py-4">
      <p className="eyebrow flex items-center gap-1.5">
        {label}
        {hint && <span className="text-[9px] normal-case text-[var(--faint)]">· {hint}</span>}
      </p>
      <p className={`mono mt-1.5 text-lg ${color}`}>{children}</p>
    </div>
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
  const meta = CHART_TABS.find((t) => t.key === tab)!;
  return (
    <Card className="p-0">
      <div className="flex items-center justify-between border-b border-line px-6 py-4">
        <span className="eyebrow inline-flex items-center gap-2">
          <meta.icon size={13} className="text-[var(--brass)]" />
          {meta.label}
          {selectedExpiry && tab !== "term" && tab !== "surface" && (
            <span className="normal-case text-[var(--muted)]">· {formatOptionExpiry(selectedExpiry)}</span>
          )}
        </span>
        <span className="text-xs text-[var(--muted)]">free CBOE chain · delayed ~15m</span>
      </div>
      <div className="p-4 sm:p-6">
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
    </Card>
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
    <ResponsiveContainer width="100%" height={320}>
      <LineChart data={rows} margin={{ left: 4, right: 12, top: 8, bottom: 4 }}>
        <CartesianGrid stroke={GRID} strokeDasharray="2 4" vertical={false} />
        <XAxis
          dataKey="strike"
          type="number"
          domain={["dataMin", "dataMax"]}
          tick={tick}
          tickFormatter={(v) => formatStrike(v)}
          tickLine={false}
          axisLine={{ stroke: GRID }}
        />
        <YAxis
          tick={tick}
          tickFormatter={(v) => `${v.toFixed(0)}%`}
          tickLine={false}
          axisLine={false}
          width={44}
        />
        <Tooltip
          contentStyle={tooltipStyle}
          formatter={(value, name) => {
            const v = Number(value);
            return [Number.isFinite(v) ? `${v.toFixed(1)}%` : "—", name === "call" ? "Call IV" : "Put IV"];
          }}
          labelFormatter={(l) => `Strike ${formatStrike(Number(l))}`}
        />
        {spot != null && (
          <ReferenceLine x={spot} stroke={BRASS} strokeDasharray="4 4" label={{ value: "spot", fill: BRASS, fontSize: 10, position: "top" }} />
        )}
        <Line type="monotone" dataKey="call" stroke={JADE} strokeWidth={2} dot={false} connectNulls name="call" />
        <Line type="monotone" dataKey="put" stroke={CORAL} strokeWidth={2} dot={false} connectNulls name="put" />
      </LineChart>
    </ResponsiveContainer>
  );
}

// IV term structure — ATM IV vs DTE across all expiries.
function TermChart({ contracts, spot }: { contracts: OptionQuote[]; spot: number | null }) {
  const rows = useMemo(
    () =>
      ivTermStructure(contracts, spot)
        .filter((t) => t.atmIv != null && t.dte >= 0)
        .map((t) => ({ dte: t.dte, iv: (t.atmIv as number) * 100, expiry: t.expiry })),
    [contracts, spot],
  );
  if (rows.length < 2) return <EmptyChart label="Need ATM IV on ≥2 expiries (and a spot price)." />;
  return (
    <ResponsiveContainer width="100%" height={320}>
      <LineChart data={rows} margin={{ left: 4, right: 12, top: 8, bottom: 4 }}>
        <CartesianGrid stroke={GRID} strokeDasharray="2 4" vertical={false} />
        <XAxis
          dataKey="dte"
          type="number"
          domain={["dataMin", "dataMax"]}
          tick={tick}
          tickFormatter={(v) => `${v}d`}
          tickLine={false}
          axisLine={{ stroke: GRID }}
        />
        <YAxis tick={tick} tickFormatter={(v) => `${v.toFixed(0)}%`} tickLine={false} axisLine={false} width={44} />
        <Tooltip
          contentStyle={tooltipStyle}
          formatter={(value) => [`${Number(value).toFixed(1)}%`, "ATM IV"]}
          labelFormatter={(l) => `${l}d to expiry`}
        />
        <Line type="monotone" dataKey="iv" stroke={BRASS} strokeWidth={2} dot={{ r: 2.5, fill: BRASS }} />
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
    <ResponsiveContainer width="100%" height={320}>
      <BarChart data={rows} margin={{ left: 4, right: 12, top: 8, bottom: 4 }} barGap={0}>
        <CartesianGrid stroke={GRID} strokeDasharray="2 4" vertical={false} />
        <XAxis
          dataKey="strike"
          type="number"
          domain={["dataMin", "dataMax"]}
          tick={tick}
          tickFormatter={(v) => formatStrike(v)}
          tickLine={false}
          axisLine={{ stroke: GRID }}
        />
        <YAxis tick={tick} tickFormatter={(v) => compactNum(v)} tickLine={false} axisLine={false} width={48} />
        <Tooltip
          contentStyle={tooltipStyle}
          formatter={(value, name) => [compactNum(Number(value)), name === "call" ? "Calls" : "Puts"]}
          labelFormatter={(l) => `Strike ${formatStrike(Number(l))}`}
        />
        {spot != null && <ReferenceLine x={spot} stroke={BRASS} strokeDasharray="4 4" label={{ value: "spot", fill: BRASS, fontSize: 10, position: "top" }} />}
        {pain != null && <ReferenceLine x={pain} stroke={BLUE} strokeDasharray="2 2" label={{ value: "max pain", fill: BLUE, fontSize: 10, position: "insideTopRight" }} />}
        <Bar dataKey="call" fill={JADE} fillOpacity={0.85} name="call" />
        <Bar dataKey="put" fill={CORAL} fillOpacity={0.85} name="put" />
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
        value={greek}
        onChange={(v) => setGreek(v as GreekKey)}
        options={[
          { key: "delta", label: "Delta" },
          { key: "gamma", label: "Gamma" },
          { key: "theta", label: "Theta" },
          { key: "vega", label: "Vega" },
        ]}
      />
      {rows.filter((r) => r.call != null || r.put != null).length < 2 ? (
        <EmptyChart label="Not enough greek data on this expiry." />
      ) : (
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={rows} margin={{ left: 4, right: 12, top: 8, bottom: 4 }}>
            <CartesianGrid stroke={GRID} strokeDasharray="2 4" vertical={false} />
            <XAxis
              dataKey="strike"
              type="number"
              domain={["dataMin", "dataMax"]}
              tick={tick}
              tickFormatter={(v) => formatStrike(v)}
              tickLine={false}
              axisLine={{ stroke: GRID }}
            />
            <YAxis tick={tick} tickLine={false} axisLine={false} width={52} />
            <Tooltip
              contentStyle={tooltipStyle}
              formatter={(value, name) => {
                const v = Number(value);
                return [Number.isFinite(v) ? v.toFixed(4) : "—", name === "call" ? "Call" : "Put"];
              }}
              labelFormatter={(l) => `Strike ${formatStrike(Number(l))}`}
            />
            {spot != null && <ReferenceLine x={spot} stroke={BRASS} strokeDasharray="4 4" />}
            <Line type="monotone" dataKey="call" stroke={JADE} strokeWidth={2} dot={false} connectNulls name="call" />
            <Line type="monotone" dataKey="put" stroke={CORAL} strokeWidth={2} dot={false} connectNulls name="put" />
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
  const rows = useMemo(
    () => (expiry ? gammaExposureByStrike(contracts, expiry, spot) : []),
    [contracts, expiry, spot],
  );
  if (rows.length < 2)
    return <EmptyChart label="Dealer GEX needs per-contract gamma + open interest (CBOE chain) and a spot price." />;
  return (
    <ResponsiveContainer width="100%" height={320}>
      <ComposedChart data={rows} margin={{ left: 4, right: 12, top: 8, bottom: 4 }}>
        <CartesianGrid stroke={GRID} strokeDasharray="2 4" vertical={false} />
        <XAxis
          dataKey="strike"
          type="number"
          domain={["dataMin", "dataMax"]}
          tick={tick}
          tickFormatter={(v) => formatStrike(v)}
          tickLine={false}
          axisLine={{ stroke: GRID }}
        />
        <YAxis tick={tick} tickFormatter={(v) => compactNum(v)} tickLine={false} axisLine={false} width={52} />
        <Tooltip
          contentStyle={tooltipStyle}
          formatter={(value) => [compactSigned(Number(value)), "GEX"]}
          labelFormatter={(l) => `Strike ${formatStrike(Number(l))}`}
        />
        <ReferenceLine y={0} stroke="#303b37" />
        {spot != null && <ReferenceLine x={spot} stroke={BRASS} strokeDasharray="4 4" label={{ value: "spot", fill: BRASS, fontSize: 10, position: "top" }} />}
        <Bar dataKey="gex" name="gex">
          {rows.map((r) => (
            <Cell key={r.strike} fill={r.gex >= 0 ? JADE : CORAL} fillOpacity={0.85} />
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
      <div className="flex items-center justify-between gap-3">
        <Segmented
          value={side}
          onChange={(v) => setSide(v as "call" | "put" | "mid")}
          options={[
            { key: "mid", label: "Mid" },
            { key: "call", label: "Calls" },
            { key: "put", label: "Puts" },
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
  ticker,
  contracts,
  expiry,
  spot,
  heldOccs,
}: {
  ticker: string;
  contracts: OptionQuote[];
  expiry: string;
  spot: number | null;
  heldOccs: Set<string>;
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

  return (
    <Card className="overflow-hidden p-0">
      <div className="flex items-center justify-between border-b border-line px-6 py-4">
        <span className="eyebrow inline-flex items-center gap-2">
          <Layers size={13} className="text-[var(--brass)]" />
          Chain · {formatOptionExpiry(expiry)}
        </span>
        <span className="text-xs text-[var(--muted)]">
          <span className="text-[var(--jade)]">Calls</span> / <span className="text-[var(--coral)]">Puts</span>
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-xs">
          <thead>
            <tr className="text-[var(--faint)]">
              {["OI", "Vol", "IV", "Δ", "Bid", "Ask"].map((h) => (
                <th key={`c-${h}`} className="px-2 py-2 text-right font-medium">
                  {h}
                </th>
              ))}
              <th className="sticky left-0 z-10 bg-[var(--panel)] px-3 py-2 text-center font-medium text-[var(--paper)] shadow-[1px_0_0_var(--line),-1px_0_0_var(--line)]">
                  Strike
                </th>
              {["Bid", "Ask", "Δ", "IV", "Vol", "OI"].map((h) => (
                <th key={`p-${h}`} className="px-2 py-2 text-right font-medium">
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
                <tr key={k} className={`border-t border-line/40 ${atSpot ? "bg-[var(--panel-2)]/60" : ""}`}>
                  <Cell2 value={call?.openInterest ?? null} digits={0} on={callHeld} itm={callItm} />
                  <Cell2 value={call?.volume ?? null} digits={0} on={callHeld} itm={callItm} />
                  <Cell2 value={call?.iv != null ? call.iv * 100 : null} digits={0} suffix="%" on={callHeld} itm={callItm} />
                  <Cell2 value={callG} digits={2} on={callHeld} itm={callItm} />
                  <Cell2 value={call?.bid ?? null} digits={2} on={callHeld} itm={callItm} />
                  <Cell2 value={call?.ask ?? null} digits={2} on={callHeld} itm={callItm} />
                  <td
                    className={`sticky left-0 z-10 px-3 py-1.5 text-center mono font-medium text-[var(--paper)] shadow-[1px_0_0_var(--line),-1px_0_0_var(--line)] ${atSpot ? "bg-[var(--panel-2)]" : "bg-[var(--panel)]"}`}
                  >
                    {formatStrike(k)}
                  </td>
                  <Cell2 value={put?.bid ?? null} digits={2} on={putHeld} itm={putItm} />
                  <Cell2 value={put?.ask ?? null} digits={2} on={putHeld} itm={putItm} />
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
      <div className="flex items-center justify-between gap-3 border-t border-line px-6 py-3">
        <p className="text-[10px] text-[var(--faint)]">
          {heldOccs.size > 0 ? `Brass cells are contracts you hold in ${ticker}. ` : ""}
          Shaded row is nearest spot.
        </p>
        {hidden > 0 && (
          <button
            type="button"
            onClick={() => setShowAll(true)}
            className="text-xs text-[var(--brass)] hover:underline"
          >
            Show all {strikes.length + hidden} strikes
          </button>
        )}
        {showAll && (
          <button
            type="button"
            onClick={() => setShowAll(false)}
            className="text-xs text-[var(--muted)] hover:underline"
          >
            Collapse to near-spot
          </button>
        )}
      </div>
    </Card>
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
}: {
  value: number | null;
  digits: number;
  suffix?: string;
  on: boolean;
  itm: boolean;
}) {
  const tone = value == null ? "text-[var(--faint)]" : itm ? "text-[var(--paper)]" : "text-[var(--muted)]";
  return (
    <td className={`mono px-2 py-1.5 text-right ${tone} ${on ? "bg-[var(--brass)]/15 font-medium text-[var(--brass)]" : ""}`}>
      {value == null ? "—" : `${value.toFixed(digits)}${suffix}`}
    </td>
  );
}

// ── Shared bits ─────────────────────────────────────────────────────────────

function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { key: T; label: string }[];
}) {
  return (
    <div className="inline-flex rounded-lg border border-line p-0.5">
      {options.map((o) => {
        const active = value === o.key;
        return (
          <button
            key={o.key}
            type="button"
            onClick={() => onChange(o.key)}
            className={`rounded-md px-3 py-1 text-xs transition-colors ${
              active ? "bg-[var(--panel-2)] text-[var(--paper)]" : "text-[var(--muted)] hover:text-[var(--paper)]"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** "12.3K" / "4.5M" — compact unsigned integer for OI/volume axes. */
function compactNum(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return `${Math.round(n)}`;
}
