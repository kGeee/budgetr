"use client";

/**
 * Options analytics panel for the investments view. Everything here is derived
 * live from the option-leg holdings (their OCC tickers + cost basis), the Yahoo
 * option-chain IV map, and underlying prices (live Finnhub quote when we have
 * one, else Yahoo's chain quote). Four sections, all ruled onto the canvas:
 *
 *   1. Selected position — one underlying × expiry: payoff at expiry beside its
 *      risk, reward and IV figures.
 *   2. Expiration calendar — legs grouped by expiry with DTE + risk badges and
 *      per-leg assignment / expiry-worthless flags.
 *   3. Greeks — best-effort Black-Scholes per contract, plus position delta.
 *   4. The chain around the strikes you hold.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { SectionHead } from "@/components/ui/statement";
import { pill, ruled, Segmented } from "@/components/portfolio/ruled";
import { PIE_COLORS } from "@/components/charts";
import { formatCurrency } from "@/lib/utils";
import {
  classifyOptionLegs,
  daysToExpiry,
  expiryBucket,
  formatOptionExpiry,
  formatStrike,
  optionRiskFlag,
  parseOccSymbol,
  riskLevel,
  type OptionRiskFlag,
  type ParsedOption,
  type RiskLevel,
} from "@/lib/options";
import { computeGreeks } from "@/lib/greeks";
import { analyzePayoff, CONTRACT_SIZE, type PayoffAnalysis, type PayoffLeg } from "@/lib/payoff";
import { expectedMove, probabilityOfProfit } from "@/lib/option-analytics";
import { PayoffDiagram } from "@/components/options/payoff-diagram";
import type { HoldingRow } from "@/components/portfolio/portfolio-view";
import type { LiveQuote } from "@/components/portfolio/live-prices";
import type { OptionQuote } from "@/lib/yahoo";

type Leg = { h: HoldingRow; p: ParsedOption };

/** Which underlying × expiry the "selected position" section is showing. */
export type PositionFocus = { underlying: string; expiry: string };

export function OptionsAnalytics({
  legs,
  quotes,
  ivByOcc,
  underlyingPrices,
  chainByUnderlying = {},
  currency = "USD",
  omit = [],
  focus,
  onFocus,
}: {
  legs: HoldingRow[];
  quotes: Record<string, LiveQuote>;
  ivByOcc: Record<string, number>;
  underlyingPrices: Record<string, number>;
  chainByUnderlying?: Record<string, OptionQuote[]>;
  currency?: string;
  /** Sections the host already renders itself (Positions merges Greeks into its legs table). */
  omit?: Array<"greeks">;
  /** Controlled selection for the selected-position section; uncontrolled when absent. */
  focus?: PositionFocus | null;
  onFocus?: (f: PositionFocus) => void;
}) {
  // Parse once; drop any non-OCC rows defensively.
  const parsed = useMemo<Leg[]>(
    () =>
      legs
        .map((h) => ({ h, p: parseOccSymbol(h.ticker) }))
        .filter((x): x is Leg => x.p != null),
    [legs],
  );

  // Stable accent colour per underlying, by alphabetical order.
  const colorByUnderlying = useMemo(() => {
    const names = Array.from(new Set(parsed.map(({ p }) => p.underlying))).sort();
    const map: Record<string, string> = {};
    names.forEach((n, i) => (map[n] = PIE_COLORS[i % PIE_COLORS.length]));
    return map;
  }, [parsed]);

  const priceFor = (underlying: string): number | null =>
    quotes[underlying.toUpperCase()]?.price ?? underlyingPrices[underlying] ?? null;

  // Flatten the chains into an OCC → quote lookup for real (CBOE) Greeks.
  const chainByOcc = useMemo(() => {
    const m: Record<string, OptionQuote> = {};
    for (const list of Object.values(chainByUnderlying)) {
      for (const c of list) m[c.occ] = c;
    }
    return m;
  }, [chainByUnderlying]);

  if (parsed.length === 0) return null;

  return (
    <div className="space-y-9">
      <SpreadPnl
        parsed={parsed}
        currency={currency}
        ivByOcc={ivByOcc}
        priceFor={priceFor}
        focus={focus}
        onFocus={onFocus}
      />
      <ExpirationCalendar parsed={parsed} colorByUnderlying={colorByUnderlying} priceFor={priceFor} />
      {!omit.includes("greeks") && (
        <GreeksTable
          parsed={parsed}
          ivByOcc={ivByOcc}
          chainByOcc={chainByOcc}
          colorByUnderlying={colorByUnderlying}
          priceFor={priceFor}
        />
      )}
      <OptionsChain
        parsed={parsed}
        chainByUnderlying={chainByUnderlying}
        colorByUnderlying={colorByUnderlying}
        priceFor={priceFor}
      />
    </div>
  );
}

// ── Expiration calendar ─────────────────────────────────────────────────────

const RISK_STYLE: Record<RiskLevel, { text: string; border: string; dot: string; label: string }> = {
  expired: { text: "text-[var(--coral)]", border: "border-[var(--coral)]", dot: "bg-[var(--coral)]", label: "Expired" },
  high: { text: "text-[var(--coral)]", border: "border-[var(--coral)]", dot: "bg-[var(--coral)]", label: "≤7d" },
  medium: { text: "text-[var(--brass)]", border: "border-[var(--brass-dim)]", dot: "bg-[var(--brass)]", label: "≤30d" },
  ok: { text: "text-[var(--muted)]", border: "border-line", dot: "bg-[var(--muted)]", label: "OK" },
};

const FLAG_LABEL: Record<Exclude<OptionRiskFlag, null>, string> = {
  assignment: "Assignment risk",
  expiry: "May expire worthless",
};

function ExpirationCalendar({
  parsed,
  colorByUnderlying,
  priceFor,
}: {
  parsed: Leg[];
  colorByUnderlying: Record<string, string>;
  priceFor: (u: string) => number | null;
}) {
  // Group legs by expiry (soonest first), then consolidate each expiry's legs by
  // underlying so a ticker's positions read as one cluster — and name the
  // structure (e.g. "Bull call spread") when classifyOptionLegs recognizes it.
  const groups = useMemo(() => {
    const byExpiry = new Map<string, Leg[]>();
    for (const leg of parsed) {
      const arr = byExpiry.get(leg.p.expiry);
      if (arr) arr.push(leg);
      else byExpiry.set(leg.p.expiry, [leg]);
    }
    return Array.from(byExpiry.entries())
      .map(([expiry, legs]) => {
        const byUnderlying = new Map<string, Leg[]>();
        for (const leg of legs) {
          const arr = byUnderlying.get(leg.p.underlying);
          if (arr) arr.push(leg);
          else byUnderlying.set(leg.p.underlying, [leg]);
        }
        const underlyings = Array.from(byUnderlying.entries())
          .map(([underlying, uLegs]) => {
            const structures = classifyOptionLegs(
              uLegs.map(({ h, p }) => ({ parsed: p, quantity: h.quantity, costBasis: h.costBasis })),
            );
            // Only surface a label when the legs form one clean structure.
            const label = structures.length === 1 ? structures[0].label : null;
            return { underlying, legs: uLegs, label };
          })
          .sort((a, b) => a.underlying.localeCompare(b.underlying));
        return { expiry, underlyings, dte: daysToExpiry(expiry) };
      })
      .sort((a, b) => a.dte - b.dte);
  }, [parsed]);

  return (
    <section aria-label="Expiration calendar">
      <SectionHead
        title="Expiration calendar"
        action={
          <span className="text-xs text-[var(--muted)]">
            {groups.length} {groups.length === 1 ? "expiry" : "expiries"} · contracts, signed
          </span>
        }
      />
      <ul>
        {groups.map(({ expiry, underlyings, dte }) => {
          const level = riskLevel(dte);
          const rs = RISK_STYLE[level];
          return (
            <li key={expiry} className="border-b border-line py-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <span className={`inline-block h-2 w-2 rounded-full ${rs.dot}`} />
                  <span className="font-medium">{formatOptionExpiry(expiry)}</span>
                  <span className={`mono text-xs ${rs.text}`}>{expiryBucket(dte)}</span>
                </div>
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide ${rs.border} ${rs.text}`}
                >
                  {rs.label}
                </span>
              </div>
              <div className="mt-2.5 space-y-2">
                {underlyings.map(({ underlying, legs, label }) => (
                  <div key={underlying} className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
                    <span className="inline-flex items-center gap-1.5">
                      <span
                        className="inline-block h-1.5 w-1.5 shrink-0 rounded-sm"
                        style={{ background: colorByUnderlying[underlying] }}
                      />
                      <span className="font-medium text-[var(--brass)]">{underlying}</span>
                      {label && (
                        <span className="rounded-full border border-line px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-[var(--muted)]">
                          {label}
                        </span>
                      )}
                    </span>
                    <ul className="flex flex-wrap gap-1.5">
                      {legs.map(({ h, p }) => {
                        const flag = optionRiskFlag(p, h.quantity, priceFor(p.underlying), dte);
                        const long = (h.quantity ?? 0) >= 0;
                        // Quantity is stored in shares (100/contract) — show contracts.
                        const contracts = Math.abs(h.quantity ?? 0) / CONTRACT_SIZE;
                        return (
                          <li
                            key={h.id}
                            className="inline-flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-xs"
                          >
                            <span className={`mono ${long ? "text-[var(--jade)]" : "text-[var(--coral)]"}`}>
                              {long ? "+" : "−"}
                              {contracts}
                            </span>
                            <span className="text-[var(--muted)]">
                              {formatStrike(p.strike)} {p.right}
                            </span>
                            {flag && (
                              <span
                                title={FLAG_LABEL[flag]}
                                className="inline-flex items-center gap-1 rounded-sm bg-[var(--coral)]/15 px-1 py-0.5 text-[10px] uppercase tracking-wide text-[var(--coral)]"
                              >
                                <AlertTriangle size={9} />
                                {flag === "assignment" ? "Assign" : "Worthless"}
                              </span>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ── Spread P&L ──────────────────────────────────────────────────────────────

type ExpiryView = {
  expiry: string;
  dte: number;
  label: string;
  detail: string;
  payoffLegs: PayoffLeg[];
  analysis: PayoffAnalysis;
  hasEconomics: boolean;
  pop: number | null;
  expMove: number | null;
  /** Representative IV the estimates were run on (the leg nearest spot). */
  iv: number | null;
  /** Worst flag across this expiry's legs: assignment outranks expiry-worthless. */
  flag: OptionRiskFlag;
  /** e.g. "short 1 contract" — only when the expiry is a single leg. */
  size: string | null;
};

type PositionCard = {
  underlying: string;
  spot: number | null;
  expiries: ExpiryView[];
};

function SpreadPnl({
  parsed,
  currency,
  ivByOcc,
  priceFor,
  focus,
  onFocus,
}: {
  parsed: Leg[];
  currency: string;
  ivByOcc: Record<string, number>;
  priceFor: (u: string) => number | null;
  focus?: PositionFocus | null;
  onFocus?: (f: PositionFocus) => void;
}) {
  const [local, setLocal] = useState<PositionFocus | null>(null);
  const active = focus !== undefined ? focus : local;
  const select = (f: PositionFocus) => {
    setLocal(f);
    onFocus?.(f);
  };

  // One consolidated card per underlying: group its legs by expiry, and for each
  // expiry sum ALL of that expiry's legs (every strike, calls + puts) into a
  // single payoff. Keep only underlyings with at least one costed expiry.
  const cards = useMemo<PositionCard[]>(() => {
    const byUnderlying = new Map<string, Leg[]>();
    for (const leg of parsed) {
      const arr = byUnderlying.get(leg.p.underlying);
      if (arr) arr.push(leg);
      else byUnderlying.set(leg.p.underlying, [leg]);
    }

    const out: PositionCard[] = [];
    for (const [underlying, legs] of byUnderlying) {
      const spot = priceFor(underlying);

      const byExpiry = new Map<string, Leg[]>();
      for (const leg of legs) {
        const arr = byExpiry.get(leg.p.expiry);
        if (arr) arr.push(leg);
        else byExpiry.set(leg.p.expiry, [leg]);
      }

      const expiries: ExpiryView[] = [];
      for (const [expiry, expLegs] of byExpiry) {
        const payoffLegs: PayoffLeg[] = expLegs.map(({ h, p }) => ({
          parsed: p,
          quantity: h.quantity,
          costBasis: h.costBasis,
        }));
        const analysis = analyzePayoff(payoffLegs);
        const hasEconomics =
          analysis.maxProfit != null ||
          analysis.maxLoss != null ||
          analysis.maxProfitUnbounded ||
          analysis.maxLossUnbounded;

        // Name the expiry's legs when they form one clean structure.
        const structures = classifyOptionLegs(
          expLegs.map(({ h, p }) => ({ parsed: p, quantity: h.quantity, costBasis: h.costBasis })),
        );
        const single = structures.length === 1 ? structures[0] : null;
        const label = single ? single.label : `${expLegs.length}-leg position`;
        const detail = single ? single.detail : formatOptionExpiry(expiry);

        // Representative IV for the model estimates: the leg nearest spot.
        const ivs = expLegs
          .map(({ p }) => ({ p, iv: ivByOcc[p.occ] }))
          .filter((x): x is { p: ParsedOption; iv: number } => typeof x.iv === "number" && x.iv > 0);
        const iv =
          spot != null && ivs.length
            ? ivs.slice().sort((a, b) => Math.abs(a.p.strike - spot) - Math.abs(b.p.strike - spot))[0].iv
            : (ivs[0]?.iv ?? null);
        const dte = Math.max(0, daysToExpiry(expiry));
        const T = dte / 365;

        expiries.push({
          expiry,
          dte,
          label,
          detail,
          payoffLegs,
          analysis,
          hasEconomics,
          pop: probabilityOfProfit(payoffLegs, analysis, spot, iv, T),
          expMove: expectedMove(spot, iv, T),
          iv,
          flag: worstFlag(
            expLegs.map(({ h, p }) => optionRiskFlag(p, h.quantity, spot, daysToExpiry(expiry))),
          ),
          // Holdings carry ±100 per contract; a person counts contracts.
          size:
            expLegs.length === 1
              ? contractsPhrase((expLegs[0].h.quantity ?? 0) / CONTRACT_SIZE)
              : null,
        });
      }

      expiries.sort((a, b) => a.dte - b.dte);
      if (expiries.some((e) => e.hasEconomics)) out.push({ underlying, spot, expiries });
    }
    return out;
  }, [parsed, ivByOcc, priceFor]);

  if (cards.length === 0) return null;

  const card = cards.find((c) => c.underlying === active?.underlying) ?? cards[0];
  /** The focused underlying holds legs but none with a cost basis to draw from. */
  const missing =
    active != null && card.underlying !== active.underlying ? active.underlying : null;
  // Default to the nearest expiry with computable economics.
  const fallback =
    card.expiries.find((e) => e.hasEconomics && e.dte >= 0) ??
    card.expiries.find((e) => e.hasEconomics) ??
    card.expiries[0];
  const view =
    (missing == null ? card.expiries.find((e) => e.expiry === active?.expiry) : undefined) ??
    fallback;
  const { analysis } = view;
  const { underlying, spot } = card;
  const rr =
    analysis.maxProfit != null && analysis.maxLoss != null && analysis.maxLoss !== 0
      ? analysis.maxProfit / analysis.maxLoss
      : null;
  const chainHref = `/investments/options/chain?ticker=${encodeURIComponent(underlying)}`;

  return (
    <section aria-label="Selected position" className="space-y-4">
      {cards.length > 1 && (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs text-[var(--muted)]">Position</span>
          <Segmented
            label="Underlying"
            value={underlying}
            onChange={(u) => select({ underlying: u, expiry: "" })}
            options={cards.map((c) => ({ value: c.underlying, label: c.underlying }))}
          />
        </div>
      )}
      {missing && (
        <p className="text-xs text-[var(--muted)]">
          {missing} has no cost basis on its legs, so there is no payoff to draw — showing{" "}
          {underlying} instead.
        </p>
      )}

      <div className="grid items-start gap-x-12 gap-y-8 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-[var(--line-strong)] pb-2.5">
            <h2 className="font-display text-lg tracking-tight">
              {underlying} {view.label}
              <span className="mono ml-2 text-xs font-normal text-[var(--muted)]">
                {[view.size, view.detail, view.dte > 0 ? `${view.dte}d` : null]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </h2>
            <span className="text-xs text-[var(--muted)]">Payoff at expiry</span>
          </div>
          <ExpirySelector
            expiries={card.expiries}
            selected={view.expiry}
            onSelect={(expiry) => select({ underlying, expiry })}
          />
          <PayoffDiagram
            legs={view.payoffLegs}
            currentPrice={spot}
            breakevens={analysis.breakevens}
            className="mt-4"
          />
        </div>

        <div className="min-w-0">
          <SectionHead title="Risk, reward and IV" />
          <dl>
            <FigureRow label="Max profit" tone="jade">
              {signedMoney(analysis.maxProfit, currency, analysis.maxProfitUnbounded)}
            </FigureRow>
            <FigureRow label="Max loss" tone="coral">
              {signedMoney(
                analysis.maxLoss != null ? -analysis.maxLoss : null,
                currency,
                analysis.maxLossUnbounded,
              )}
            </FigureRow>
            <FigureRow label={analysis.breakevens.length > 1 ? "Breakevens" : "Breakeven"}>
              {analysis.breakevens.length
                ? analysis.breakevens.map((b) => formatStrike(Number(b.toFixed(2)))).join(" · ")
                : "—"}
            </FigureRow>
            <FigureRow label="Prob. of profit">
              {view.pop != null ? `${(view.pop * 100).toFixed(0)}%` : "—"}
            </FigureRow>
            <FigureRow label="Reward : risk">{rr != null ? `${rr.toFixed(2)} : 1` : "—"}</FigureRow>
            <FigureRow label="Expected move (1σ)">
              {view.expMove != null && spot != null ? `±${formatCurrency(view.expMove, currency)}` : "—"}
            </FigureRow>
            <FigureRow label="Implied volatility">
              {view.iv != null ? `${(view.iv * 100).toFixed(0)}%` : "—"}
            </FigureRow>
            <FigureRow label="Assignment risk" tone={view.flag === "assignment" ? "coral" : undefined}>
              {view.flag ? FLAG_LABEL[view.flag] : "None flagged"}
            </FigureRow>
          </dl>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link href={chainHref} className={pill}>
              Open {underlying} chain
            </Link>
            <Link href={`${chainHref}&mode=vol`} className={pill}>
              Fixed-strike vol
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

function worstFlag(flags: OptionRiskFlag[]): OptionRiskFlag {
  if (flags.includes("assignment")) return "assignment";
  if (flags.includes("expiry")) return "expiry";
  return null;
}

/** "short 2 contracts" from a signed CONTRACT count (not the ±100 share quantity). */
function contractsPhrase(contracts: number): string {
  const n = Math.abs(contracts);
  const shown = Number.isInteger(n) ? n : Number(n.toFixed(2));
  return `${contracts < 0 ? "short" : "long"} ${shown} ${shown === 1 ? "contract" : "contracts"}`;
}

function signedMoney(value: number | null, currency: string, unbounded: boolean): string {
  if (unbounded) return "Unlimited";
  if (value == null) return "—";
  return `${value >= 0 ? "+" : "−"}${formatCurrency(Math.abs(value), currency)}`;
}

/** One ruled label / figure line in the selected position's stats. */
function FigureRow({
  label,
  tone,
  children,
}: {
  label: string;
  tone?: "jade" | "coral";
  children: React.ReactNode;
}) {
  const color =
    tone === "jade" ? "text-[var(--jade)]" : tone === "coral" ? "text-[var(--coral)]" : "";
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-line py-2.5">
      <dt className="text-[13px] text-[var(--muted)]">{label}</dt>
      <dd className={`mono text-right text-sm ${color}`}>{children}</dd>
    </div>
  );
}

/** Expiration selector — chip buttons, collapsing to a dropdown when there are many. */
function ExpirySelector({
  expiries,
  selected,
  onSelect,
}: {
  expiries: ExpiryView[];
  selected: string;
  onSelect: (expiry: string) => void;
}) {
  if (expiries.length < 2) return null;
  if (expiries.length > 5) {
    return (
      <select
        value={selected}
        onChange={(e) => onSelect(e.target.value)}
        aria-label="Expiration"
        className="mt-3 w-full rounded-full border border-[var(--line-strong)] bg-transparent px-3 py-1.5 text-xs text-[var(--paper)]"
      >
        {expiries.map((e) => (
          <option key={e.expiry} value={e.expiry}>
            {formatOptionExpiry(e.expiry)} · {e.dte}d
          </option>
        ))}
      </select>
    );
  }
  return (
    <div className="mt-3 flex flex-wrap gap-1.5">
      {expiries.map((e) => {
        const active = e.expiry === selected;
        return (
          <button
            key={e.expiry}
            type="button"
            onClick={() => onSelect(e.expiry)}
            aria-pressed={active}
            className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
              active
                ? "border-[var(--brass-dim)] bg-[var(--panel-2)] text-[var(--paper)]"
                : "border-line text-[var(--muted)] hover:border-[var(--brass-dim)] hover:text-[var(--paper)]"
            }`}
          >
            {formatOptionExpiry(e.expiry)}
            <span className="mono ml-1.5 text-[var(--muted)]">{e.dte}d</span>
          </button>
        );
      })}
    </div>
  );
}

// ── Greeks ──────────────────────────────────────────────────────────────────

function GreeksTable({
  parsed,
  ivByOcc,
  chainByOcc,
  colorByUnderlying,
  priceFor,
}: {
  parsed: Leg[];
  ivByOcc: Record<string, number>;
  chainByOcc: Record<string, OptionQuote>;
  colorByUnderlying: Record<string, string>;
  priceFor: (u: string) => number | null;
}) {
  const rows = useMemo(() => {
    return parsed
      .map(({ h, p }) => {
        const quote = chainByOcc[p.occ];
        const iv = quote?.iv ?? ivByOcc[p.occ] ?? null;
        // Prefer real source Greeks (CBOE); fall back to Black-Scholes from IV.
        const cg = quote?.greeks;
        const g =
          cg && cg.delta != null ? cg : computeGreeks(p, priceFor(p.underlying), iv);
        // Stored quantity is in SHARES (100 per contract); show contract count.
        const shares = h.quantity ?? 0;
        const contracts = shares / CONTRACT_SIZE;
        // Position delta = per-share delta × shares held.
        const posDelta = g.delta != null ? g.delta * shares : null;
        return { h, p, iv, g, contracts, posDelta };
      })
      .sort((a, b) => daysToExpiry(a.p.expiry) - daysToExpiry(b.p.expiry));
  }, [parsed, ivByOcc, chainByOcc, priceFor]);

  const hasAnyGreek = rows.some((r) => r.g.delta != null);

  return (
    <section aria-label="Greeks">
      {hasAnyGreek ? (
        <div className={ruled.scroll}>
          <table className={`${ruled.table} min-w-[640px]`}>
            <thead>
              <tr className={`${ruled.headRow} align-bottom`}>
                <th className="pb-2.5 pr-5 text-left font-normal">
                  <h2 className="font-display text-lg tracking-tight text-[var(--paper)]">
                    Greeks
                    <span className="mono ml-2 text-xs font-normal text-[var(--muted)]">
                      live CBOE · per share
                    </span>
                  </h2>
                </th>
                {["Contracts", "IV", "Delta", "Gamma", "Theta", "Vega", "Pos. Δ"].map((label) => (
                  <th key={label} className={`${ruled.th} text-right`}>
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ h, p, iv, g, contracts, posDelta }) => {
                const long = contracts >= 0;
                return (
                  <tr key={h.id} className={ruled.row}>
                    <td className={ruled.td}>
                      <span className="inline-flex items-center gap-2">
                        <span
                          className="inline-block h-1.5 w-1.5 shrink-0 rounded-sm"
                          style={{ background: colorByUnderlying[p.underlying] }}
                        />
                        <span className="mono font-medium">{p.underlying}</span>
                        <span className="text-[13px] text-[var(--muted)]">
                          {formatStrike(p.strike)} {p.right} · {formatOptionExpiry(p.expiry)}
                        </span>
                      </span>
                    </td>
                    <td
                      className={`${ruled.td} ${ruled.num} ${long ? "text-[var(--jade)]" : "text-[var(--coral)]"}`}
                    >
                      {long ? "+" : "−"}
                      {Math.abs(contracts)}
                    </td>
                    <Num value={iv != null ? iv * 100 : null} suffix="%" digits={1} />
                    <Num value={g.delta} digits={3} />
                    <Num value={g.gamma} digits={4} />
                    <Num value={g.theta} digits={3} />
                    <Num value={g.vega} digits={3} />
                    <Num value={posDelta} digits={1} />
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <>
          <SectionHead title="Greeks" />
          <p className="py-6 text-sm text-[var(--muted)]">
            No option-chain data available for these contracts right now — Greeks need a live chain
            from CBOE.
          </p>
        </>
      )}
    </section>
  );
}

/** Right-aligned mono numeric cell, dashed when null. */
function Num({
  value,
  digits = 2,
  suffix = "",
}: {
  value: number | null;
  digits?: number;
  suffix?: string;
}) {
  return (
    <td className={`${ruled.td} ${ruled.num} ${value == null ? "text-[var(--muted)]" : ""}`}>
      {value == null ? "—" : `${value.toFixed(digits)}${suffix}`}
    </td>
  );
}

// ── Options chain browser ───────────────────────────────────────────────────

/** How many strikes to show on each side of the spot price. */
const CHAIN_WINDOW = 8;

/**
 * Live option-chain browser (free Yahoo data), laid out the familiar way: calls
 * on the left, puts on the right, strikes down the middle. Greeks are computed
 * per contract from the chain's IV. Windowed around spot and centered on the
 * strikes you actually hold, which are highlighted.
 */
function OptionsChain({
  parsed,
  chainByUnderlying,
  colorByUnderlying,
  priceFor,
}: {
  parsed: Leg[];
  chainByUnderlying: Record<string, OptionQuote[]>;
  colorByUnderlying: Record<string, string>;
  priceFor: (u: string) => number | null;
}) {
  const blocks = useMemo(() => {
    // Underlyings we hold options on, that also have chain data.
    const heldOccs = new Set(parsed.map(({ p }) => p.occ));
    const underlyings = Array.from(new Set(parsed.map(({ p }) => p.underlying))).sort();

    return underlyings
      .map((underlying) => {
        const contracts = chainByUnderlying[underlying] ?? [];
        if (!contracts.length) return null;
        const spot = priceFor(underlying);

        // Group by expiry, but only expiries we actually hold a leg on.
        const heldExpiries = new Set(
          parsed.filter(({ p }) => p.underlying === underlying).map(({ p }) => p.expiry),
        );
        const byExpiry = new Map<string, OptionQuote[]>();
        for (const c of contracts) {
          if (!heldExpiries.has(c.expiry)) continue;
          const arr = byExpiry.get(c.expiry);
          if (arr) arr.push(c);
          else byExpiry.set(c.expiry, [c]);
        }

        const expiries = Array.from(byExpiry.entries())
          .map(([expiry, cs]) => ({ expiry, cs, dte: daysToExpiry(expiry) }))
          .sort((a, b) => a.dte - b.dte)
          .map(({ expiry, cs, dte }) => {
            const calls = new Map<number, OptionQuote>();
            const puts = new Map<number, OptionQuote>();
            for (const c of cs) (c.right === "call" ? calls : puts).set(c.strike, c);

            let strikes = Array.from(new Set(cs.map((c) => c.strike))).sort((a, b) => a - b);
            // Window around spot (or held strikes) so the table stays readable.
            const center =
              spot ??
              cs.find((c) => heldOccs.has(c.occ))?.strike ??
              strikes[Math.floor(strikes.length / 2)];
            if (strikes.length > CHAIN_WINDOW * 2 + 1) {
              let ci = 0;
              for (let i = 0; i < strikes.length; i++) {
                if (Math.abs(strikes[i] - center) < Math.abs(strikes[ci] - center)) ci = i;
              }
              strikes = strikes.slice(
                Math.max(0, ci - CHAIN_WINDOW),
                ci + CHAIN_WINDOW + 1,
              );
            }
            return { expiry, dte, strikes, calls, puts };
          });

        return { underlying, spot, expiries };
      })
      .filter((b): b is NonNullable<typeof b> => b != null && b.expiries.length > 0);
  }, [parsed, chainByUnderlying, priceFor]);

  if (blocks.length === 0) return null;

  return (
    <section aria-label="Options chain">
      <SectionHead
        title="Chain around your strikes"
        action={<span className="text-xs text-[var(--muted)]">free CBOE chain · live IV + Greeks</span>}
      />
      <div>
        {blocks.map((b) => (
          <div key={b.underlying} className="border-b border-line py-4">
            <div className="mb-2 flex items-center gap-2">
              <span
                className="inline-block h-2 w-2 shrink-0 rounded-sm"
                style={{ background: colorByUnderlying[b.underlying] }}
              />
              <span className="mono font-medium">{b.underlying}</span>
              {b.spot != null && (
                <span className="mono text-xs text-[var(--muted)]">
                  spot {formatStrike(Number(b.spot.toFixed(2)))}
                </span>
              )}
            </div>
            {b.expiries.map((e) => (
              <ChainTable
                key={e.expiry}
                underlying={b.underlying}
                expiry={e.expiry}
                dte={e.dte}
                strikes={e.strikes}
                calls={e.calls}
                puts={e.puts}
                spot={b.spot}
                heldOccs={new Set(parsed.map(({ p }) => p.occ))}
              />
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}

function ChainTable({
  underlying,
  expiry,
  dte,
  strikes,
  calls,
  puts,
  spot,
  heldOccs,
}: {
  underlying: string;
  expiry: string;
  dte: number;
  strikes: number[];
  calls: Map<number, OptionQuote>;
  puts: Map<number, OptionQuote>;
  spot: number | null;
  heldOccs: Set<string>;
}) {
  return (
    <div className="mb-4 last:mb-0">
      <div className="mb-1.5 flex items-center gap-2 text-xs text-[var(--muted)]">
        <span>{formatOptionExpiry(expiry)}</span>
        {dte >= 0 && <span className="mono">· {dte}d</span>}
        <span className="ml-3 text-[var(--jade)]">Calls</span>
        <span className="text-[var(--coral)]">/ Puts</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-xs">
          <thead>
            <tr className="text-[var(--muted)]">
              {["OI", "Δ", "IV", "Bid", "Ask"].map((h) => (
                <th key={`c-${h}`} className="px-2 py-1 text-right font-normal">
                  {h}
                </th>
              ))}
              <th className="px-2 py-1 text-center font-medium text-[var(--paper)]">Strike</th>
              {["Bid", "Ask", "IV", "Δ", "OI"].map((h) => (
                <th key={`p-${h}`} className="px-2 py-1 text-right font-normal">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {strikes.map((k) => {
              const call = calls.get(k);
              const put = puts.get(k);
              // Prefer the source's real Greeks; fall back to Black-Scholes.
              const callG =
                call?.greeks?.delta != null
                  ? call.greeks
                  : call
                    ? computeGreeks(parseOccSymbol(call.occ)!, spot, call.iv)
                    : null;
              const putG =
                put?.greeks?.delta != null
                  ? put.greeks
                  : put
                    ? computeGreeks(parseOccSymbol(put.occ)!, spot, put.iv)
                    : null;
              const callHeld = call ? heldOccs.has(call.occ) : false;
              const putHeld = put ? heldOccs.has(put.occ) : false;
              const callItm = spot != null && spot > k;
              const putItm = spot != null && spot < k;
              const atSpot =
                spot != null &&
                Math.abs(k - spot) ===
                  Math.min(...strikes.map((s) => Math.abs(s - spot)));
              return (
                <tr
                  key={k}
                  className={`border-t border-line ${atSpot ? "bg-[var(--panel-2)]/60" : ""}`}
                >
                  <ChainCell value={call?.openInterest ?? null} digits={0} on={callHeld} itm={callItm} />
                  <ChainCell value={callG?.delta ?? null} digits={2} on={callHeld} itm={callItm} />
                  <ChainCell
                    value={call?.iv != null ? call.iv * 100 : null}
                    digits={0}
                    suffix="%"
                    on={callHeld}
                    itm={callItm}
                  />
                  <ChainCell value={call?.bid ?? null} digits={2} on={callHeld} itm={callItm} />
                  <ChainCell value={call?.ask ?? null} digits={2} on={callHeld} itm={callItm} />
                  <td className="px-2 py-1.5 text-center mono font-medium text-[var(--paper)]">
                    {formatStrike(k)}
                  </td>
                  <ChainCell value={put?.bid ?? null} digits={2} on={putHeld} itm={putItm} />
                  <ChainCell value={put?.ask ?? null} digits={2} on={putHeld} itm={putItm} />
                  <ChainCell
                    value={put?.iv != null ? put.iv * 100 : null}
                    digits={0}
                    suffix="%"
                    on={putHeld}
                    itm={putItm}
                  />
                  <ChainCell value={putG?.delta ?? null} digits={2} on={putHeld} itm={putItm} />
                  <ChainCell value={put?.openInterest ?? null} digits={0} on={putHeld} itm={putItm} />
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-1.5 text-xs text-[var(--muted)]">
        Highlighted cells are contracts you hold in {underlying}. Shaded strike is nearest the spot.
      </p>
    </div>
  );
}

/** One chain cell — brass-tinted when held, dimmed when out-of-the-money. */
function ChainCell({
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
  const tone = itm && value != null ? "text-[var(--paper)]" : "text-[var(--muted)]";
  return (
    <td
      className={`mono px-2 py-1.5 text-right ${tone} ${
        on ? "bg-[var(--brass)]/15 font-medium text-[var(--brass)]" : ""
      }`}
    >
      {value == null ? "—" : `${value.toFixed(digits)}${suffix}`}
    </td>
  );
}
