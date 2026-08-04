"use client";

/**
 * LEAPS › stock replacement — should you own 100 shares or one long call?
 *
 * Layout: pick a contract → the headline tradeoff (capital, exposure, what the
 * leverage costs) → the terminal P/L of both positions across a price range →
 * the full candidate table so the strike ladder's shape is visible.
 *
 * The chart plots both legs with the parts a plain payoff diagram drops:
 * dividends credited to the shares, interest credited to the call's unspent
 * capital. Leaving those out is what makes LEAPS look worse than they are.
 */

import { useMemo, useState } from "react";
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
import { Card } from "@/components/ui/card";
import { formatCurrency } from "@/lib/utils";
import { formatOptionExpiry } from "@/lib/options";
import { compareToShares, priceLadder, type LeapsCandidate } from "@/lib/quant/leaps";

const money = (n: number) => formatCurrency(n, "USD", { maximumFractionDigits: 0 });
const money2 = (n: number) => formatCurrency(n, "USD", { maximumFractionDigits: 2 });
const pct = (n: number | null, digits = 1) =>
  n == null ? "—" : `${(n * 100).toFixed(digits)}%`;
const signedPct = (n: number | null, digits = 1) =>
  n == null ? "—" : `${n >= 0 ? "+" : "−"}${Math.abs(n * 100).toFixed(digits)}%`;
const signColor = (n: number) => (n >= 0 ? "text-[var(--jade)]" : "text-[var(--coral)]");

function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: string;
}) {
  return (
    <div className="min-w-0">
      <div className="eyebrow text-[var(--muted)]">{label}</div>
      <div className={`mt-1 font-display text-2xl tabular ${tone ?? ""}`}>{value}</div>
      {hint ? <div className="mt-0.5 text-xs text-[var(--muted)]">{hint}</div> : null}
    </div>
  );
}

export function LeapsView({
  ticker,
  spot,
  candidates,
  dividendYield,
  rate,
  marginRate,
}: {
  ticker: string;
  spot: number;
  candidates: LeapsCandidate[];
  dividendYield: number | null;
  rate: number;
  marginRate: number;
}) {
  // Default to the deepest in-the-money long-dated call — the one that behaves
  // most like the shares, which is the comparison people actually come for.
  const defaultOcc = useMemo(() => {
    const itm = candidates.filter((c) => c.isStockReplacement);
    const pool = itm.length ? itm : candidates;
    return pool.length ? pool.reduce((a, b) => (a.strike < b.strike ? a : b)).occ : null;
  }, [candidates]);

  const [selectedOcc, setSelectedOcc] = useState<string | null>(defaultOcc);
  const selected = candidates.find((c) => c.occ === selectedOcc) ?? candidates[0] ?? null;

  const series = useMemo(() => {
    if (!selected) return [];
    return compareToShares(
      {
        spot,
        strike: selected.strike,
        premium: selected.premium,
        dte: selected.dte,
        iv: selected.iv,
        dividendYield,
        rate,
      },
      selected,
      priceLadder(spot, 0.6, 121),
    );
  }, [selected, spot, dividendYield, rate]);

  if (!candidates.length) {
    return (
      <Card>
        <p className="text-sm text-[var(--muted)]">
          No listed calls on {ticker} expire more than a year out, so there&rsquo;s nothing here to
          compare against the shares. Plenty of symbols only list a few months forward — the
          nearer-dated chain is on the Chain tab.
        </p>
      </Card>
    );
  }

  if (!selected) return null;

  const trails = selected.trailsSharesAboveStrikeBy;

  return (
    <div className="space-y-5">
      {/* ── contract picker ─────────────────────────────────────────── */}
      <Card>
        <div className="flex flex-wrap items-center gap-2">
          <span className="eyebrow mr-1 text-[var(--muted)]">Contract</span>
          {candidates.map((c) => {
            const on = c.occ === selected.occ;
            return (
              <button
                key={c.occ}
                onClick={() => setSelectedOcc(c.occ)}
                className={`rounded-full border px-3 py-1.5 text-xs tabular transition-colors ${
                  on
                    ? "border-[var(--jade)] bg-[var(--jade)]/12 text-[var(--jade)]"
                    : "border-line text-[var(--muted)] hover:text-[var(--paper)]"
                }`}
              >
                {formatOptionExpiry(c.expiry)} · {money(c.strike)}
                {c.isStockReplacement ? "" : " OTM"}
              </button>
            );
          })}
        </div>
      </Card>

      {/* ── the headline tradeoff ───────────────────────────────────── */}
      <Card>
        <div className="grid grid-cols-2 gap-5 sm:grid-cols-4">
          <Stat
            label="Capital"
            value={money(selected.contractCost)}
            hint={`vs ${money(selected.sharesCost)} for 100 shares`}
          />
          <Stat
            label="Frees up"
            value={money(selected.capitalFreed)}
            hint={`${pct(selected.capitalFreedPct, 0)} of the share cost`}
            tone="text-[var(--jade)]"
          />
          <Stat
            label="Exposure"
            value={
              selected.deltaEquivalentShares == null
                ? "—"
                : `${selected.deltaEquivalentShares.toFixed(0)} sh`
            }
            hint={
              selected.effectiveLeverage == null
                ? "delta unavailable"
                : `${selected.effectiveLeverage.toFixed(1)}× per dollar`
            }
          />
          <Stat
            label="Max loss"
            value={money(selected.maxLoss)}
            hint={`the whole premium, below ${money(selected.worthlessAtOrBelow)}`}
            tone="text-[var(--coral)]"
          />
        </div>
      </Card>

      {/* ── what the leverage costs ─────────────────────────────────── */}
      <Card>
        <div className="eyebrow mb-3 text-[var(--brass)]">What the leverage costs</div>
        <div className="grid grid-cols-2 gap-5 sm:grid-cols-4">
          <Stat
            label="Time value"
            value={money2(selected.extrinsic * 100)}
            hint={`${pct(selected.extrinsicPctOfSpot)} of spot, over ${selected.years.toFixed(1)}y`}
          />
          <Stat
            label="Dividends forgone"
            value={dividendYield == null ? "—" : money2(selected.forgoneDividends * 100)}
            hint={dividendYield == null ? "no yield data" : `${pct(dividendYield, 2)} yield`}
          />
          <Stat
            label="Implied borrow rate"
            value={pct(selected.impliedFinancingRate)}
            hint={
              selected.impliedFinancingRate == null
                ? "out of the money — not a replacement"
                : `cash earns ${pct(rate)} · margin ${pct(marginRate)}`
            }
            tone={
              selected.vsMarginRate == null
                ? undefined
                : selected.vsMarginRate <= 0
                  ? "text-[var(--jade)]"
                  : "text-[var(--brass)]"
            }
          />
          <Stat
            label="Net carry"
            value={money2(selected.netCarry * 100)}
            hint="time value + dividends − interest earned"
            tone={signColor(-selected.netCarry)}
          />
        </div>

        <p className="mt-4 border-t border-line pt-4 text-sm leading-relaxed text-[var(--muted)]">
          {trails >= 0 ? (
            <>
              Above {money(selected.strike)} this call trails 100 shares by a flat{" "}
              <span className="tabular text-[var(--paper)]">{money2(trails * 100)}</span> however
              far the stock runs — both positions gain a dollar per dollar up there, so the gap
              never closes. That fixed amount is what you pay to cap the downside at{" "}
              {money(selected.maxLoss)} and keep {money(selected.capitalFreed)} in cash.
            </>
          ) : (
            <>
              Above {money(selected.strike)} this call actually <em>beats</em> 100 shares by a flat{" "}
              <span className="tabular text-[var(--jade)]">{money2(-trails * 100)}</span> — the
              interest on the {money(selected.capitalFreed)} it frees up more than covers its time
              value and forgone dividends. The tradeoff is only the downside gap below.
            </>
          )}{" "}
          Below <span className="tabular text-[var(--paper)]">{money2(selected.leapWinsBelow)}</span>{" "}
          the call is ahead, because its loss stops at the premium while the shares keep falling.
        </p>
      </Card>

      {/* ── terminal P/L, both positions ────────────────────────────── */}
      <Card>
        <div className="mb-1 flex items-baseline justify-between">
          <div className="eyebrow text-[var(--brass)]">At expiry · {formatOptionExpiry(selected.expiry)}</div>
          <div className="text-xs text-[var(--muted)]">
            breakeven {money2(selected.breakeven)} · {signedPct(selected.breakevenMovePct)} from spot
          </div>
        </div>
        <div className="h-[280px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={series} margin={{ top: 12, right: 8, bottom: 4, left: 8 }}>
              <CartesianGrid stroke="var(--line)" strokeDasharray="2 4" vertical={false} />
              <XAxis
                dataKey="price"
                type="number"
                domain={["dataMin", "dataMax"]}
                tickFormatter={(v: number) => money(v)}
                stroke="var(--muted)"
                fontSize={11}
                tickLine={false}
              />
              <YAxis
                tickFormatter={(v: number) => money(v)}
                stroke="var(--muted)"
                fontSize={11}
                tickLine={false}
                width={64}
              />
              <Tooltip
                contentStyle={{
                  background: "var(--panel-2)",
                  border: "1px solid var(--line)",
                  borderRadius: 12,
                  fontSize: 12,
                }}
                labelFormatter={(v) => `${ticker} at ${money2(Number(v))}`}
                formatter={(v, name) => [money(Number(v)), name === "leap" ? "1 LEAP" : "100 shares"]}
              />
              <ReferenceLine y={0} stroke="var(--line-strong)" />
              <ReferenceLine
                x={spot}
                stroke="var(--brass)"
                strokeDasharray="3 3"
                label={{ value: "spot", position: "top", fill: "var(--brass)", fontSize: 10 }}
              />
              <Line
                type="monotone"
                dataKey="shares"
                stroke="var(--muted)"
                strokeWidth={1.5}
                dot={false}
                name="shares"
              />
              <Line
                type="monotone"
                dataKey="leap"
                stroke="var(--jade)"
                strokeWidth={2}
                dot={false}
                name="leap"
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <p className="mt-2 text-xs text-[var(--muted)]">
          Both lines include what a payoff diagram usually drops: dividends credited to the shares,
          and interest on the cash the call doesn&rsquo;t tie up.
        </p>
      </Card>

      {/* ── the strike ladder ───────────────────────────────────────── */}
      <Card>
        <div className="eyebrow mb-3 text-[var(--brass)]">Every long-dated call</div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-line text-left">
                {[
                  "Expiry",
                  "Strike",
                  "Premium",
                  "Time value",
                  "Δ-shares",
                  "Borrow rate",
                  "Cost / exposure",
                  "Breakeven",
                  "P(ITM)",
                ].map((h) => (
                  <th key={h} className="eyebrow py-2 pr-3 font-medium text-[var(--muted)]">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {candidates.map((c) => {
                const on = c.occ === selected.occ;
                return (
                  <tr
                    key={c.occ}
                    onClick={() => setSelectedOcc(c.occ)}
                    className={`cursor-pointer border-b border-line/60 transition-colors last:border-0 ${
                      on ? "bg-[var(--jade)]/8" : "hover:bg-[var(--panel-2)]"
                    }`}
                  >
                    <td className="py-2.5 pr-3 tabular">{formatOptionExpiry(c.expiry)}</td>
                    <td className="py-2.5 pr-3 tabular">
                      {money(c.strike)}
                      {c.isStockReplacement ? null : (
                        <span className="ml-1.5 text-[10px] text-[var(--muted)]">OTM</span>
                      )}
                    </td>
                    <td className="py-2.5 pr-3 tabular">{money2(c.premium)}</td>
                    <td className="py-2.5 pr-3 tabular text-[var(--muted)]">
                      {money2(c.extrinsic)}
                    </td>
                    <td className="py-2.5 pr-3 tabular">
                      {c.deltaEquivalentShares == null ? "—" : c.deltaEquivalentShares.toFixed(0)}
                    </td>
                    <td className="py-2.5 pr-3 tabular">{pct(c.impliedFinancingRate)}</td>
                    <td className="py-2.5 pr-3 tabular">{pct(c.costPerExposureRate)}</td>
                    <td className="py-2.5 pr-3 tabular">
                      {money2(c.breakeven)}
                      <span className="ml-1.5 text-xs text-[var(--muted)]">
                        {signedPct(c.breakevenMovePct, 0)}
                      </span>
                    </td>
                    <td className="py-2.5 pr-3 tabular">{pct(c.probAboveBreakeven, 0)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs leading-relaxed text-[var(--muted)]">
          <strong className="text-[var(--paper)]">Borrow rate</strong> is the annualised cost of
          controlling the shares through the option, quoted against the capital it frees. It&rsquo;s
          blank out of the money, where the call isn&rsquo;t standing in for the shares at all.{" "}
          <strong className="text-[var(--paper)]">Cost / exposure</strong> divides the same cost by
          the delta-weighted exposure it actually buys, so every strike is comparable — that&rsquo;s
          the column to rank by.
        </p>
      </Card>
    </div>
  );
}
