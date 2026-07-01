"use client";

/**
 * Options analytics panel for the investments view. Everything here is derived
 * live from the option-leg holdings (their OCC tickers + cost basis), the Yahoo
 * option-chain IV map, and underlying prices (live Finnhub quote when we have
 * one, else Yahoo's chain quote). Three sections:
 *
 *   1. Expiration calendar — legs grouped by expiry with DTE + risk badges and
 *      per-leg assignment / expiry-worthless flags.
 *   2. Greeks — best-effort Black-Scholes per contract, plus position delta.
 *   3. Spread P&L — max-profit / max-loss / breakeven cards for the verticals
 *      and long singles classifyOptionLegs recognizes.
 */

import { useMemo } from "react";
import { AlertTriangle, CalendarClock, Sigma } from "lucide-react";
import { Card } from "@/components/ui/card";
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
import type { HoldingRow } from "@/components/portfolio-view";
import type { LiveQuote } from "@/components/live-prices";

type Leg = { h: HoldingRow; p: ParsedOption };

export function OptionsAnalytics({
  legs,
  quotes,
  ivByOcc,
  underlyingPrices,
  currency = "USD",
}: {
  legs: HoldingRow[];
  quotes: Record<string, LiveQuote>;
  ivByOcc: Record<string, number>;
  underlyingPrices: Record<string, number>;
  currency?: string;
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

  if (parsed.length === 0) return null;

  return (
    <div className="space-y-5">
      <ExpirationCalendar parsed={parsed} colorByUnderlying={colorByUnderlying} priceFor={priceFor} />
      <SpreadPnl parsed={parsed} colorByUnderlying={colorByUnderlying} currency={currency} />
      <GreeksTable
        parsed={parsed}
        ivByOcc={ivByOcc}
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
  // Group legs by expiry, ascending (soonest first).
  const groups = useMemo(() => {
    const map = new Map<string, Leg[]>();
    for (const leg of parsed) {
      const arr = map.get(leg.p.expiry);
      if (arr) arr.push(leg);
      else map.set(leg.p.expiry, [leg]);
    }
    return Array.from(map.entries())
      .map(([expiry, legs]) => ({ expiry, legs, dte: daysToExpiry(expiry) }))
      .sort((a, b) => a.dte - b.dte);
  }, [parsed]);

  return (
    <Card className="p-0">
      <div className="flex items-center justify-between border-b border-line px-6 py-4">
        <span className="eyebrow inline-flex items-center gap-2">
          <CalendarClock size={13} className="text-[var(--brass)]" />
          Expiration calendar
        </span>
        <span className="text-xs text-[var(--muted)]">
          {groups.length} {groups.length === 1 ? "expiry" : "expiries"}
        </span>
      </div>
      <ul className="divide-y divide-line/60">
        {groups.map(({ expiry, legs, dte }) => {
          const level = riskLevel(dte);
          const rs = RISK_STYLE[level];
          return (
            <li key={expiry} className="px-6 py-4">
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
              <ul className="mt-2.5 flex flex-wrap gap-2">
                {legs.map(({ h, p }) => {
                  const flag = optionRiskFlag(p, h.quantity, priceFor(p.underlying), dte);
                  const long = (h.quantity ?? 0) >= 0;
                  return (
                    <li
                      key={h.id}
                      className="inline-flex items-center gap-1.5 rounded-md border border-line/60 bg-[var(--panel)]/50 px-2 py-1 text-xs"
                    >
                      <span
                        className="inline-block h-1.5 w-1.5 shrink-0 rounded-sm"
                        style={{ background: colorByUnderlying[p.underlying] }}
                      />
                      <span className="font-medium text-[var(--brass)]">{p.underlying}</span>
                      <span className={`mono ${long ? "text-[var(--jade)]" : "text-[var(--coral)]"}`}>
                        {long ? "+" : "−"}
                        {Math.abs(h.quantity ?? 0)}
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
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

// ── Spread P&L ──────────────────────────────────────────────────────────────

function SpreadPnl({
  parsed,
  colorByUnderlying,
  currency,
}: {
  parsed: Leg[];
  colorByUnderlying: Record<string, string>;
  currency: string;
}) {
  // Classify per underlying, keeping only structures with computable economics.
  const cards = useMemo(() => {
    const byUnderlying = new Map<string, Leg[]>();
    for (const leg of parsed) {
      const arr = byUnderlying.get(leg.p.underlying);
      if (arr) arr.push(leg);
      else byUnderlying.set(leg.p.underlying, [leg]);
    }
    const out: {
      underlying: string;
      label: string;
      detail: string;
      maxProfit: number | null;
      maxLoss: number | null;
      breakeven: number | null;
    }[] = [];
    for (const [underlying, legs] of byUnderlying) {
      const structures = classifyOptionLegs(
        legs.map(({ h, p }) => ({ parsed: p, quantity: h.quantity, costBasis: h.costBasis })),
      );
      for (const st of structures) {
        if (st.maxProfit == null && st.maxLoss == null) continue;
        out.push({
          underlying,
          label: st.label,
          detail: st.detail,
          maxProfit: st.maxProfit ?? null,
          maxLoss: st.maxLoss ?? null,
          breakeven: st.breakeven ?? null,
        });
      }
    }
    return out;
  }, [parsed]);

  if (cards.length === 0) return null;

  return (
    <Card className="p-0">
      <div className="flex items-center justify-between border-b border-line px-6 py-4">
        <span className="eyebrow">Spread risk / reward</span>
        <span className="text-xs text-[var(--muted)]">max P&amp;L at expiry</span>
      </div>
      <div className="grid gap-4 p-6 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((c, i) => {
          const rr =
            c.maxProfit != null && c.maxLoss != null && c.maxLoss !== 0
              ? c.maxProfit / c.maxLoss
              : null;
          return (
            <div
              key={`${c.underlying}:${i}`}
              className="rounded-[var(--radius)] border border-line bg-[var(--panel)]/40 p-4"
            >
              <div className="flex items-center gap-2">
                <span
                  className="inline-block h-2 w-2 shrink-0 rounded-sm"
                  style={{ background: colorByUnderlying[c.underlying] }}
                />
                <span className="font-medium text-[var(--brass)]">{c.underlying}</span>
                <span className="text-sm text-[var(--paper)]">{c.label}</span>
              </div>
              <p className="mt-0.5 text-xs text-[var(--muted)]">{c.detail}</p>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <Metric
                  label="Max profit"
                  value={c.maxProfit}
                  currency={currency}
                  tone="jade"
                  unbounded={c.maxProfit == null}
                />
                <Metric
                  label="Max loss"
                  value={c.maxLoss != null ? -c.maxLoss : null}
                  currency={currency}
                  tone="coral"
                />
              </div>
              <div className="mt-3 flex items-center justify-between border-t border-line/60 pt-2.5 text-xs">
                <span className="text-[var(--muted)]">Breakeven</span>
                <span className="mono">
                  {c.breakeven != null ? formatStrike(Number(c.breakeven.toFixed(2))) : "—"}
                </span>
              </div>
              <div className="mt-1 flex items-center justify-between text-xs">
                <span className="text-[var(--muted)]">Reward : risk</span>
                <span className="mono">{rr != null ? `${rr.toFixed(2)}×` : "—"}</span>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function Metric({
  label,
  value,
  currency,
  tone,
  unbounded = false,
}: {
  label: string;
  value: number | null;
  currency: string;
  tone: "jade" | "coral";
  unbounded?: boolean;
}) {
  const color = tone === "jade" ? "text-[var(--jade)]" : "text-[var(--coral)]";
  return (
    <div>
      <p className="eyebrow">{label}</p>
      <p className={`mono mt-1 text-sm ${color}`}>
        {unbounded
          ? "Unlimited"
          : value == null
            ? "—"
            : `${value >= 0 ? "+" : "−"}${formatCurrency(Math.abs(value), currency)}`}
      </p>
    </div>
  );
}

// ── Greeks ──────────────────────────────────────────────────────────────────

function GreeksTable({
  parsed,
  ivByOcc,
  colorByUnderlying,
  priceFor,
}: {
  parsed: Leg[];
  ivByOcc: Record<string, number>;
  colorByUnderlying: Record<string, string>;
  priceFor: (u: string) => number | null;
}) {
  const rows = useMemo(() => {
    return parsed
      .map(({ h, p }) => {
        const iv = ivByOcc[p.occ] ?? null;
        const g = computeGreeks(p, priceFor(p.underlying), iv);
        const contracts = h.quantity ?? 0;
        // Position delta = per-share delta × contracts × 100 shares.
        const posDelta = g.delta != null ? g.delta * contracts * 100 : null;
        return { h, p, iv, g, contracts, posDelta };
      })
      .sort((a, b) => daysToExpiry(a.p.expiry) - daysToExpiry(b.p.expiry));
  }, [parsed, ivByOcc, priceFor]);

  const hasAnyGreek = rows.some((r) => r.g.delta != null);

  return (
    <Card className="overflow-hidden p-0">
      <div className="flex items-center justify-between border-b border-line px-6 py-4">
        <span className="eyebrow inline-flex items-center gap-2">
          <Sigma size={13} className="text-[var(--brass)]" />
          Greeks
        </span>
        <span className="text-xs text-[var(--muted)]">Black-Scholes · live IV</span>
      </div>
      {hasAnyGreek ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-line text-left">
                {["Contract", "Qty", "IV", "Delta", "Gamma", "Theta", "Vega", "Pos. Δ"].map((label, i) => (
                  <th
                    key={label}
                    className={`px-4 py-3 eyebrow font-medium ${i >= 1 ? "text-right" : ""}`}
                  >
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ h, p, iv, g, contracts, posDelta }) => {
                const long = contracts >= 0;
                return (
                  <tr key={h.id} className="border-b border-line/60 last:border-0">
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-2">
                        <span
                          className="inline-block h-1.5 w-1.5 shrink-0 rounded-sm"
                          style={{ background: colorByUnderlying[p.underlying] }}
                        />
                        <span className="font-medium text-[var(--brass)]">{p.underlying}</span>
                        <span className="text-[var(--muted)]">
                          {formatStrike(p.strike)} {p.right} · {formatOptionExpiry(p.expiry)}
                        </span>
                      </span>
                    </td>
                    <td
                      className={`mono px-4 py-3 text-right ${long ? "text-[var(--jade)]" : "text-[var(--coral)]"}`}
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
        <p className="px-6 py-8 text-center text-sm text-[var(--muted)]">
          No implied-vol data available for these contracts right now — Greeks need a live option
          chain from Yahoo.
        </p>
      )}
    </Card>
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
    <td className={`mono px-4 py-3 text-right ${value == null ? "text-[var(--faint)]" : ""}`}>
      {value == null ? "—" : `${value.toFixed(digits)}${suffix}`}
    </td>
  );
}
