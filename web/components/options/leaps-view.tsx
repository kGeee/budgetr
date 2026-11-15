"use client";

/**
 * LEAPS › stock replacement — should you own 100 shares or one long call?
 *
 * Layout, all on the canvas: the headline tradeoff for the selected contract
 * (what it frees up, with capital / exposure / max loss on the same line) → the
 * expiry pills → what the leverage costs beside the terminal P/L of both
 * positions → the strike ladder as a ruled table, where a row selects a strike.
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
import { Hero, Mark } from "@/components/ui/statement";
import { ChoicePill, DeskHead, DeskNote, FigureRow } from "@/components/options/desk-ui";
import { HeroLine, RuledFooter, SideFigure, pill, ruled } from "@/components/portfolio/ruled";
import { formatCurrency } from "@/lib/utils";
import { formatOptionExpiry } from "@/lib/options";
import {
  compareToShares,
  defaultCandidate,
  groupByExpiry,
  isReplacementCandidate,
  priceLadder,
  type LeapsCandidate,
} from "@/lib/quant/leaps";

const money = (n: number) => formatCurrency(n, "USD", { maximumFractionDigits: 0 });
const money2 = (n: number) => formatCurrency(n, "USD", { maximumFractionDigits: 2 });
const pct = (n: number | null, digits = 1) =>
  n == null ? "—" : `${(n * 100).toFixed(digits)}%`;
const signedPct = (n: number | null, digits = 1) =>
  n == null ? "—" : `${n >= 0 ? "+" : "−"}${Math.abs(n * 100).toFixed(digits)}%`;

export function LeapsView({
  ticker,
  spot,
  candidates,
  dividendYield,
  rate,
  marginRate,
  minDte,
}: {
  ticker: string;
  spot: number;
  candidates: LeapsCandidate[];
  dividendYield: number | null;
  rate: number;
  marginRate: number;
  /** Shortest life a call needs to count as a LEAP here, in days. */
  minDte?: number;
}) {
  // A liquid name lists hundreds of long-dated calls, so the view is scoped:
  // choose an expiry, then a strike within it. Rendering the lot at once is
  // what made the first cut of this page a 19,000px wall.
  const groups = useMemo(() => groupByExpiry(candidates), [candidates]);

  const [expiry, setExpiry] = useState<string | null>(groups[0]?.expiry ?? null);
  const [showAllStrikes, setShowAllStrikes] = useState(false);

  const group = groups.find((g) => g.expiry === expiry) ?? groups[0] ?? null;

  // Within the expiry, default to showing only the strikes that are actually
  // standing in for the shares — the far OTM tail is a different question.
  const rows = useMemo(() => {
    if (!group) return [];
    const replacements = group.candidates.filter((c) => isReplacementCandidate(c));
    return showAllStrikes || replacements.length === 0 ? group.candidates : replacements;
  }, [group, showAllStrikes]);

  const [selectedOcc, setSelectedOcc] = useState<string | null>(null);
  const selected =
    rows.find((c) => c.occ === selectedOcc) ?? defaultCandidate(rows) ?? rows[0] ?? null;

  const hiddenCount = group ? group.candidates.length - rows.length : 0;

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
      <DeskNote>
        No listed calls on {ticker} expire more than a year out, so there&rsquo;s nothing here to
        compare against the shares. Plenty of symbols only list a few months forward — the
        nearer-dated chain is on the Chain tab.
      </DeskNote>
    );
  }

  if (!selected) return null;

  const trails = selected.trailsSharesAboveStrikeBy;
  const cashShare = selected.sharesCost > 0 ? selected.contractCost / selected.sharesCost : null;
  const shares = selected.deltaEquivalentShares;

  return (
    <div className="space-y-9">
      {/* ── the headline tradeoff ───────────────────────────────────── */}
      <section aria-label="LEAPS versus shares">
        <HeroLine
          hero={
            <Hero
              className="min-w-0 flex-1 basis-[24rem]"
              eyebrow={`${ticker} ${money(selected.strike)} call · ${formatOptionExpiry(selected.expiry)} · frees up`}
              figure={money(selected.capitalFreed)}
              tone={selected.capitalFreed >= 0 ? "default" : "coral"}
              verdict={
                <>
                  {shares != null ? (
                    <>
                      One contract stands in for {shares.toFixed(0)} shares at{" "}
                      {cashShare != null ? pct(cashShare, 0) : "a fraction"} of the cash.
                    </>
                  ) : (
                    <>
                      One contract costs {cashShare != null ? pct(cashShare, 0) : "a fraction"} of
                      what 100 shares do.
                    </>
                  )}{" "}
                  {selected.impliedFinancingRate != null ? (
                    <>
                      The price is an implied borrow rate of{" "}
                      <Mark
                        tone={
                          selected.vsMarginRate != null && selected.vsMarginRate <= 0 ? "jade" : "brass"
                        }
                      >
                        {pct(selected.impliedFinancingRate)}
                      </Mark>{" "}
                      a year.
                    </>
                  ) : (
                    <span className="text-[var(--muted)]">
                      It is out of the money — a directional bet, not a stand-in for the shares.
                    </span>
                  )}
                </>
              }
            />
          }
        >
          <SideFigure
            label="Capital"
            value={money(selected.contractCost)}
            sub={`vs ${money(selected.sharesCost)} for 100 shares · frees ${pct(selected.capitalFreedPct, 0)}`}
          />
          <SideFigure
            label="Exposure"
            value={shares == null ? "—" : `${shares.toFixed(0)} shares · ${money(shares * spot)}`}
            sub={
              selected.effectiveLeverage == null
                ? "delta unavailable"
                : `${selected.delta != null ? `Δ ${selected.delta.toFixed(2)} · ` : ""}${selected.effectiveLeverage.toFixed(1)}× per dollar`
            }
          />
          <SideFigure
            label="Max loss"
            tone="coral"
            value={money(selected.maxLoss)}
            sub={`the whole premium, below ${money(selected.worthlessAtOrBelow)}`}
          />
        </HeroLine>
      </section>

      {/* ── expiry picker ───────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-[13px] text-[var(--muted)]">Expiry</span>
        <div role="group" aria-label="Expiry" className="flex max-w-full gap-1 overflow-x-auto">
          {groups.map((g) => (
            <ChoicePill
              key={g.expiry}
              on={g.expiry === selected.expiry}
              onClick={() => {
                setExpiry(g.expiry);
                setSelectedOcc(null); // re-default within the new expiry
              }}
              title={`${(g.dte / 365).toFixed(1)} years out`}
            >
              {formatOptionExpiry(g.expiry)} · {g.dte}d
            </ChoicePill>
          ))}
        </div>
        <span className="text-xs text-[var(--muted)]">
          Spot <span className="mono text-[var(--paper)]">{money2(spot)}</span>
          {minDte != null && <> · calls {minDte}+ days out</>} · cash at {pct(rate)} · margin
          benchmark {pct(marginRate)} · selected {money(selected.strike)} call at{" "}
          {money2(selected.premium)} per share
        </span>
      </div>

      {/* ── what the leverage costs · terminal P/L ──────────────────── */}
      <section aria-label="Cost and payoff" className="grid gap-x-12 gap-y-9 lg:grid-cols-5">
        <div className="min-w-0 lg:col-span-2">
          <DeskHead title="What the leverage costs" />
          <FigureRow
            label="Time value"
            sub={`premium above intrinsic, gone by expiry · ${pct(selected.extrinsicPctOfSpot)} of spot over ${selected.years.toFixed(1)}y`}
          >
            {money2(selected.extrinsic * 100)}
          </FigureRow>
          <FigureRow
            label="Dividends forgone"
            sub={
              dividendYield == null
                ? "no yield data"
                : `paid to shareholders, not to the call · ${pct(dividendYield, 2)} yield`
            }
          >
            {dividendYield == null ? "—" : money2(selected.forgoneDividends * 100)}
          </FigureRow>
          <FigureRow
            label="Implied borrow rate"
            sub={
              selected.impliedFinancingRate == null
                ? "out of the money — not a replacement"
                : `what the time value works out to, per year · cash earns ${pct(rate)} · margin ${pct(marginRate)}`
            }
            tone={
              selected.vsMarginRate == null
                ? undefined
                : selected.vsMarginRate <= 0
                  ? "jade"
                  : "brass"
            }
          >
            {pct(selected.impliedFinancingRate)}
          </FigureRow>
          <FigureRow
            label="Net carry"
            sub="time value + dividends − interest earned"
            tone={-selected.netCarry >= 0 ? "jade" : "coral"}
          >
            {money2(selected.netCarry * 100)}
          </FigureRow>
          <p className="pt-3 text-xs text-[var(--muted)]">
            Dollar figures are for one contract (100 shares).
          </p>
          <p className="pt-3 text-sm leading-relaxed text-[var(--muted)]">
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
                value and forgone dividends.
              </>
            )}{" "}
            {selected.leapWinsBelow != null ? (
              <>
                Below{" "}
                <span className="tabular text-[var(--paper)]">{money2(selected.leapWinsBelow)}</span>{" "}
                the call is ahead, because its loss stops at the premium while the shares keep
                falling.
              </>
            ) : (
              <>
                And it stays ahead all the way down: below the strike its loss stops at the premium
                while the shares keep falling. On these numbers there is no price at which owning the
                shares wins — which usually means the market is pricing very little time value into
                this strike, so check the spread before believing it.
              </>
            )}
          </p>
        </div>

        <div className="min-w-0 space-y-2.5 lg:col-span-3">
          <DeskHead
            title={`At expiry · ${formatOptionExpiry(selected.expiry)}`}
            action={
              <span className="flex items-center gap-4 text-xs text-[var(--muted)]">
                <span className="inline-flex items-center gap-1.5">
                  <span aria-hidden className="h-0.5 w-3.5 bg-[var(--brass)]" />1 LEAP
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span aria-hidden className="w-3.5 border-t-2 border-dashed border-[var(--muted)]" />
                  100 shares
                </span>
              </span>
            }
          />
          <div className="h-[260px] w-full">
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
                  x={selected.strike}
                  stroke="var(--line-strong)"
                  strokeDasharray="2 4"
                  label={{ value: "strike", position: "insideTopLeft", fill: "var(--muted)", fontSize: 10 }}
                />
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
                  strokeDasharray="5 5"
                  dot={false}
                  name="shares"
                />
                <Line
                  type="monotone"
                  dataKey="leap"
                  stroke="var(--brass)"
                  strokeWidth={2}
                  dot={false}
                  name="leap"
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <p className="mono text-xs text-[var(--muted)]">
            Strike {money(selected.strike)} · spot {money2(spot)} · breakeven{" "}
            {money2(selected.breakeven)} ({signedPct(selected.breakevenMovePct)} from spot)
          </p>
          <p className="text-xs text-[var(--muted)]">
            Both lines include what a payoff diagram usually drops: dividends credited to the shares,
            and interest on the cash the LEAP frees up.
          </p>
        </div>
      </section>

      {/* ── the strike ladder ───────────────────────────────────────── */}
      <section aria-label="Strikes" className="space-y-3">
        <div className={`max-h-[520px] overflow-y-auto ${ruled.scroll}`}>
          <table className={`${ruled.table} min-w-[820px]`}>
            <thead className="sticky top-0 z-10 bg-[var(--ink)]">
              <tr className={ruled.headRow}>
                <th className="pb-2.5 pr-5 font-normal">
                  <DeskHead
                    ruled={false}
                    title="Strikes"
                    sub={`calls · ${formatOptionExpiry(selected.expiry)} · ${rows.length} of ${group?.candidates.length ?? 0}`}
                  />
                </th>
                {[
                  "Premium",
                  "Time value",
                  "Δ-shares",
                  "Borrow rate",
                  "Cost / exposure",
                  "Breakeven",
                  "P(ITM)",
                ].map((h) => (
                  <th key={h} className={`${ruled.th} text-right align-bottom`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => {
                const on = c.occ === selected.occ;
                const tag = [on ? "selected" : null, c.isStockReplacement ? null : "OTM"]
                  .filter(Boolean)
                  .join(" · ");
                return (
                  <tr
                    key={c.occ}
                    onClick={() => setSelectedOcc(c.occ)}
                    className={`cursor-pointer transition-colors ${ruled.row} ${
                      on ? "bg-[var(--panel)]" : "hover:bg-[var(--panel)]/60"
                    }`}
                  >
                    <td className={`${ruled.td} mono`}>
                      <button
                        type="button"
                        aria-pressed={on}
                        onClick={() => setSelectedOcc(c.occ)}
                        className="inline-flex items-baseline gap-2.5 text-left"
                      >
                        <span className="font-medium">{money(c.strike)}</span>
                        {tag && (
                          <span
                            className={`font-sans text-xs ${on ? "text-[var(--brass)]" : "text-[var(--muted)]"}`}
                          >
                            {tag}
                          </span>
                        )}
                      </button>
                    </td>
                    <td className={`${ruled.td} ${ruled.num}`}>{money2(c.premium)}</td>
                    <td className={`${ruled.td} ${ruled.num}`}>{money2(c.extrinsic)}</td>
                    <td className={`${ruled.td} ${ruled.num}`}>
                      {c.deltaEquivalentShares == null ? "—" : c.deltaEquivalentShares.toFixed(0)}
                    </td>
                    <td className={`${ruled.td} ${ruled.num}`}>{pct(c.impliedFinancingRate)}</td>
                    <td className={`${ruled.td} ${ruled.num}`}>{pct(c.costPerExposureRate)}</td>
                    <td className={`${ruled.td} ${ruled.num}`}>
                      {money2(c.breakeven)}
                      <span className="ml-1.5 text-xs text-[var(--muted)]">
                        {signedPct(c.breakevenMovePct, 0)}
                      </span>
                    </td>
                    <td className={`${ruled.td} ${ruled.num}`}>{pct(c.probAboveBreakeven, 0)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <RuledFooter
          className="items-start border-t-0 pt-0 text-xs leading-relaxed"
          note={
            <span className="block max-w-[90ch]">
              <span className="text-[var(--paper)]">Borrow rate</span> is the annualised cost of
              controlling the shares through the option, quoted against the capital it frees.
              It&rsquo;s blank out of the money, where the call isn&rsquo;t standing in for the
              shares at all. <span className="text-[var(--paper)]">Cost / exposure</span> divides
              the same cost by the delta-weighted exposure it actually buys, so every strike is
              comparable — that&rsquo;s the column to rank by. Premiums and time value are per
              share; one contract is 100 shares.
            </span>
          }
        >
          {hiddenCount > 0 || showAllStrikes ? (
            <button onClick={() => setShowAllStrikes((v) => !v)} className={pill}>
              {showAllStrikes
                ? "Show replacements only"
                : `Show all strikes (+${hiddenCount} further out)`}
            </button>
          ) : null}
        </RuledFooter>
      </section>
    </div>
  );
}
