"use client";

/**
 * Wheel & premium collection — the income side of the options book:
 * the year's premium beside its monthly chart → wheel stories (where each
 * underlying is in its cycle) → open short premium (CSP collateral, CC
 * coverage, annualized yield) → the cycle ledger beside the per-underlying
 * scorecard. Everything is ruled straight onto the canvas.
 */

import { useState } from "react";
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Hero, Mark, SectionHead } from "@/components/ui/statement";
import { ruled, RuledFooter, Segmented, SideFigure } from "@/components/portfolio/ruled";
import { wheelVerdict } from "@/lib/investments-verdict";
import { formatCurrency } from "@/lib/utils";
import { formatOptionExpiry, formatStrike } from "@/lib/options";
import type { WheelReport, WheelStory } from "@/lib/wheel";

const money = (n: number) => formatCurrency(n, "USD", { maximumFractionDigits: 0 });
const signed = (n: number) => `${n >= 0 ? "+" : "−"}${money(Math.abs(n))}`;
const signColor = (n: number) => (n >= 0 ? "text-[var(--jade)]" : "text-[var(--coral)]");
const toneOf = (n: number) => (n >= 0 ? "jade" : "coral") as "jade" | "coral";

const OUTCOME_BADGE: Record<string, { label: string; cls: string }> = {
  expired: { label: "expired · kept", cls: "text-[var(--jade)]" },
  assigned: { label: "assigned", cls: "text-[var(--brass)]" },
  closed: { label: "bought back", cls: "text-[var(--muted)]" },
  open: { label: "open", cls: "text-[var(--paper)]" },
};

const STORY_STATUS: Record<WheelStory["status"], { label: string; cls: string }> = {
  "selling-puts": { label: "Selling puts", cls: "text-[var(--paper)]" },
  "holding-shares": { label: "Holding shares", cls: "text-[var(--brass)]" },
  "selling-calls": { label: "Selling calls", cls: "text-[var(--paper)]" },
  completed: { label: "Completed", cls: "text-[var(--jade)]" },
};

function PhaseChip({ children, tone }: { children: React.ReactNode; tone?: "jade" | "brass" | "muted" }) {
  const cls =
    tone === "jade"
      ? "border-[var(--jade)]/40 text-[var(--jade)]"
      : tone === "brass"
        ? "border-[var(--brass-dim)] text-[var(--brass)]"
        : "border-line text-[var(--muted)]";
  return <span className={`rounded-full border px-2 py-0.5 text-[11px] ${cls}`}>{children}</span>;
}

/** Month keys are `YYYY-MM`; the axis only has room for the month's name. */
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function monthTick(month: string): string {
  const [y, m] = month.split("-");
  const name = MONTH_NAMES[Number(m) - 1] ?? month;
  return m === "01" ? `${name} ’${y!.slice(2)}` : name;
}

const contractsLabel = (n: number) => `${n} ${n === 1 ? "contract" : "contracts"}`;

/**
 * One underlying's place in the wheel: ticker, the chain of phases, a sentence
 * of where it stands, and what the whole story has made.
 */
function StoryRow({ story }: { story: WheelStory }) {
  const status = STORY_STATUS[story.status];
  return (
    <li className="grid grid-cols-[4rem_minmax(0,1fr)_auto] items-center gap-x-5 gap-y-2 border-b border-line py-3.5 lg:grid-cols-[4rem_minmax(0,1.3fr)_minmax(0,1fr)_7rem]">
      <span className="mono font-medium">{story.underlying}</span>
      <div className="col-span-2 col-start-2 row-start-2 flex flex-wrap items-center gap-x-1.5 gap-y-2 text-[11px] text-[var(--muted)] lg:col-span-1 lg:col-start-2 lg:row-start-1">
        {story.phases.map((p, i) => (
          <span key={i} className="flex items-center gap-1.5">
            {i > 0 && <span aria-hidden>→</span>}
            {p.kind === "csp" && (
              <PhaseChip tone={p.cycle.net >= 0 ? "jade" : "muted"}>
                CSP {formatStrike(p.cycle.strike)} {signed(p.cycle.net)}
              </PhaseChip>
            )}
            {p.kind === "assigned" && (
              <PhaseChip tone="brass">
                assigned {p.shares} sh @ {formatStrike(p.costPerShare)}
              </PhaseChip>
            )}
            {p.kind === "cc" && (
              <PhaseChip tone={p.cycle.net >= 0 ? "jade" : "muted"}>
                CC {formatStrike(p.cycle.strike)} {signed(p.cycle.net)}
              </PhaseChip>
            )}
            {p.kind === "calledAway" && (
              <PhaseChip tone="brass">called away @ {formatStrike(p.pricePerShare)}</PhaseChip>
            )}
          </span>
        ))}
      </div>
      <p className="min-w-0 text-[13px] text-[var(--muted)]">
        <span className={status.cls}>{status.label}</span>{" "}
        <span className="mono text-xs">
          {story.started}
          {story.ended ? ` → ${story.ended}` : ""}
        </span>
        <span className="mono text-xs">
          {" · premium "}
          <span className={signColor(story.premium)}>{signed(story.premium)}</span>
          {story.stockPnl != null && (
            <>
              {" · stock "}
              <span className={signColor(story.stockPnl)}>{signed(story.stockPnl)}</span>
            </>
          )}
          {story.adjustedBasis != null && ` · adj. basis ${money(story.adjustedBasis)}/sh`}
        </span>
      </p>
      <span className={`mono text-right ${signColor(story.total)}`} title="Premium plus stock P&L">
        {signed(story.total)}
      </span>
    </li>
  );
}

export function WheelView({ report }: { report: WheelReport }) {
  const [showAllCycles, setShowAllCycles] = useState(false);
  const [chart, setChart] = useState<"month" | "cumulative">("month");
  const { kpis, months, cumulative, open, cycles, rollup, stories, spreadLegsExcluded } = report;
  const chartData = months.map((m, i) => ({ ...m, cumulative: cumulative[i]!.cumulative }));
  const visibleCycles = showAllCycles ? cycles : cycles.slice(0, 25);
  const verdict = wheelVerdict(kpis);

  // The scorecard's closing row. Win rate is recomputed over every finished
  // cycle (same rule as each row: net > 0), not averaged across underlyings.
  const finished = cycles.filter((c) => c.outcome !== "open");
  const totals = {
    net: rollup.reduce((a, r) => a + r.net, 0),
    cycles: rollup.reduce((a, r) => a + r.cycles, 0),
    open: rollup.reduce((a, r) => a + r.open, 0),
    winRatePct:
      finished.length > 0 ? (finished.filter((c) => c.net > 0).length / finished.length) * 100 : null,
  };

  if (months.length === 0 && open.length === 0) {
    return (
      <div className="border-t border-line pt-5">
        <p className="eyebrow">Wheel &amp; premium</p>
        <p className="mt-3 max-w-lg text-sm text-[var(--muted)]">
          No option trades on the tape yet. Once short puts or covered calls appear in your
          investment transactions, premium income and wheel cycles report here automatically.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-9">
      {/* The year's premium is the figure; this month and what is still open
          read it. Contract counts here come off the trade tape — 1 per contract,
          not the ±100 a holding carries. */}
      <section
        aria-label="Wheel and premium"
        className="grid items-end gap-x-12 gap-y-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]"
      >
        <Hero
          eyebrow="Net premium · year to date"
          figure={signed(kpis.netYtd)}
          tone={toneOf(kpis.netYtd)}
          verdict={
            <>
              {verdict.lead}
              {verdict.amount != null && (
                <>
                  {" "}
                  <Mark tone={verdict.tone}>{money(verdict.amount)}</Mark>
                </>
              )}{" "}
              {verdict.tail}
            </>
          }
        >
          <dl className="mt-1 flex flex-wrap gap-y-3 border-t border-line">
            <SideFigure label="This month" value={signed(kpis.netThisMonth)} tone={toneOf(kpis.netThisMonth)} />
            <SideFigure
              label="All time"
              value={signed(kpis.netAllTime)}
              tone={toneOf(kpis.netAllTime)}
              sub={`${signed(kpis.netAllOptions)} incl. spreads · ${spreadLegsExcluded} spread ${spreadLegsExcluded === 1 ? "leg" : "legs"} excluded`}
            />
            <SideFigure
              label="Collateral at risk"
              value={money(kpis.collateralAtRisk)}
              tone={kpis.uncoveredCalls > 0 ? "coral" : undefined}
              sub={`${kpis.openContracts} open short ${kpis.openContracts === 1 ? "contract" : "contracts"}${
                kpis.uncoveredCalls > 0 ? ` · ${kpis.uncoveredCalls} uncovered call${kpis.uncoveredCalls > 1 ? "s" : ""}` : ""
              }`}
            />
          </dl>
        </Hero>

        {months.length > 0 && (
          <div className="min-w-0">
            <div className="mb-2.5 flex flex-wrap items-center justify-between gap-3">
              <span className="text-xs text-[var(--muted)]">
                {chart === "month" ? "Net premium by month" : "Cumulative net premium"}
              </span>
              <Segmented
                label="Chart"
                value={chart}
                onChange={setChart}
                options={[
                  { value: "month", label: "By month" },
                  { value: "cumulative", label: "Cumulative" },
                ]}
              />
            </div>
            <div className="border-b border-line">
              <ResponsiveContainer width="100%" height={200}>
                <ComposedChart data={chartData} margin={{ top: 6, right: 4, bottom: 0, left: -8 }}>
                  <CartesianGrid stroke="var(--chart-grid)" strokeDasharray="3 3" vertical={false} />
                  <XAxis
                    dataKey="month"
                    tickFormatter={monthTick}
                    tick={{ fill: "var(--muted)", fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    yAxisId="net"
                    hide={chart !== "month"}
                    tick={{ fill: "var(--muted)", fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                  />
                  {/* The running total has its own scale: against the monthly
                      bars' axis it would flatten them into the floor. */}
                  <YAxis
                    yAxisId="cum"
                    hide={chart === "month"}
                    tick={{ fill: "var(--muted)", fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <Tooltip
                    contentStyle={{ background: "var(--chart-tooltip-bg)", border: "1px solid var(--line)", borderRadius: 10, fontSize: 12 }}
                    formatter={(v, name) => [
                      money(Number(v ?? 0)),
                      name === "net" ? "net premium" : "cumulative",
                    ]}
                  />
                  {chart === "month" && (
                    <Bar yAxisId="net" dataKey="net" radius={[2, 2, 0, 0]}>
                      {chartData.map((m, i) => (
                        <Cell
                          key={m.month}
                          fill={m.net >= 0 ? "var(--jade)" : "var(--coral)"}
                          opacity={i === chartData.length - 1 ? 1 : 0.6}
                        />
                      ))}
                    </Bar>
                  )}
                  <Line
                    yAxisId="cum"
                    type="monotone"
                    dataKey="cumulative"
                    stroke="var(--brass)"
                    strokeWidth={chart === "month" ? 1.5 : 2}
                    strokeDasharray={chart === "month" ? "4 4" : undefined}
                    dot={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            {chart === "month" && (
              <p className="mt-2 text-xs text-[var(--muted)]">
                Dashed line: cumulative net premium, all time.
              </p>
            )}
          </div>
        )}
      </section>

      {/* Wheel stories — the chained narrative */}
      {stories.length > 0 && (
        <section aria-label="Wheel stories">
          <SectionHead
            title="Wheel stories"
            action={
              <span className="text-xs text-[var(--muted)]">
                where each underlying is in its cycle · premium plus stock
              </span>
            }
          />
          <ul>
            {stories.map((story) => (
              <StoryRow key={story.underlying + story.started} story={story} />
            ))}
          </ul>
        </section>
      )}

      {/* Open short positions */}
      {open.length > 0 && (
        <section aria-label="Open short premium" className="space-y-3">
          <div className={ruled.scroll}>
            <table className={`${ruled.table} min-w-[680px]`}>
              <thead>
                <tr className={`${ruled.headRow} align-bottom`}>
                  <th className="pb-2.5 pr-5 text-left font-normal">
                    <h2 className="font-display text-lg tracking-tight text-[var(--paper)]">
                      Open short premium
                    </h2>
                  </th>
                  <th className={`${ruled.th} text-right`}>Expiry</th>
                  <th className={`${ruled.th} text-right`}>Credit</th>
                  <th className={`${ruled.th} text-right`}>To close</th>
                  <th className={`${ruled.th} text-right`}>Collateral</th>
                  <th className={`${ruled.th} text-right`}>Ann.</th>
                </tr>
              </thead>
              <tbody>
                {open.map((p) => (
                  <tr key={p.occ} className={ruled.row}>
                    <td className={ruled.td}>
                      <span className="mono mr-3 font-medium">{p.underlying}</span>
                      <span className="text-[13px] text-[var(--muted)]">
                        {formatStrike(p.strike)} {p.right} · short {contractsLabel(p.contracts)} ·{" "}
                        {p.right === "put" ? "cash-secured" : "covered call"}
                      </span>
                      {p.covered === false && (
                        <span className="ml-2 text-[11px] uppercase tracking-wide text-[var(--coral)]">
                          uncovered
                        </span>
                      )}
                    </td>
                    <td className={`${ruled.td} ${ruled.num}`}>
                      {formatOptionExpiry(p.expiry)}{" "}
                      <span
                        className={
                          p.dte <= 7
                            ? "text-[var(--coral)]"
                            : p.dte <= 21
                              ? "text-[var(--brass)]"
                              : "text-[var(--muted)]"
                        }
                      >
                        {p.dte}d
                      </span>
                    </td>
                    <td className={`${ruled.td} ${ruled.num} ${p.credit != null ? signColor(p.credit) : "text-[var(--muted)]"}`}>
                      {p.credit != null ? signed(p.credit) : "—"}
                    </td>
                    <td className={`${ruled.td} ${ruled.num}`}>
                      {p.markToClose != null ? money(p.markToClose) : "—"}
                    </td>
                    <td className={`${ruled.td} ${ruled.num}`}>
                      {p.collateral != null ? money(p.collateral) : "—"}
                    </td>
                    <td className={`${ruled.td} ${ruled.num}`}>
                      {p.annualizedPct != null ? `${p.annualizedPct.toFixed(1)}%` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[13px] text-[var(--muted)]">
            Contracts are whole contracts (1 = 100 shares). Credit and To close are dollars for the
            whole position.
          </p>
        </section>
      )}

      {(cycles.length > 0 || rollup.length > 0) && (
        <div className="grid items-start gap-x-12 gap-y-9 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          {/* Cycle ledger */}
          {cycles.length > 0 && (
            <section aria-label="Short-premium ledger" className="min-w-0 space-y-3">
              <div className={ruled.scroll}>
                <table className={`${ruled.table} min-w-[600px]`}>
                  <thead>
                    <tr className={`${ruled.headRow} align-bottom`}>
                      <th className={ruled.th}>Opened</th>
                      <th className="pb-2.5 pr-5 text-left font-normal">
                        <h2 className="font-display text-lg tracking-tight text-[var(--paper)]">
                          Short-premium ledger
                        </h2>
                      </th>
                      <th className={ruled.th}>Outcome</th>
                      <th className={`${ruled.th} text-right`}>Net</th>
                      <th className={`${ruled.th} text-right`}>Days</th>
                      <th className={`${ruled.th} text-right`}>Ann.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleCycles.map((c) => {
                      const badge = OUTCOME_BADGE[c.outcome]!;
                      return (
                        <tr key={c.occ + c.opened} className={ruled.row}>
                          <td className={`${ruled.td} mono whitespace-nowrap text-xs text-[var(--muted)]`}>
                            {c.opened}
                          </td>
                          <td className={ruled.td}>
                            <span className="mono font-medium">{c.underlying}</span>{" "}
                            <span className="text-[13px] text-[var(--muted)]">
                              {formatStrike(c.strike)} {c.right} · {formatOptionExpiry(c.expiry)} ·{" "}
                              {contractsLabel(c.qty)}
                            </span>
                          </td>
                          <td className={`${ruled.td} whitespace-nowrap text-[13px] ${badge.cls}`}>
                            {badge.label}
                          </td>
                          <td className={`${ruled.td} ${ruled.num} ${signColor(c.net)}`}>{signed(c.net)}</td>
                          <td className={`${ruled.td} ${ruled.num} text-[var(--muted)]`}>{c.daysHeld}</td>
                          <td className={`${ruled.td} ${ruled.num} text-[var(--muted)]`}>
                            {c.annualizedPct != null && c.outcome !== "open"
                              ? `${c.annualizedPct.toFixed(0)}%`
                              : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {cycles.length > 25 && (
                <button
                  onClick={() => setShowAllCycles((v) => !v)}
                  className="text-[13px] text-[var(--brass)] underline-offset-2 transition-colors hover:text-[var(--paper)] hover:underline"
                >
                  {showAllCycles ? "Show the latest 25" : `Show the full ledger (${cycles.length})`}
                </button>
              )}
            </section>
          )}

          {/* Per-underlying scorecard */}
          {rollup.length > 0 && (
            <section aria-label="By underlying" className="min-w-0">
              <div className={ruled.scroll}>
                <table className={`${ruled.table} min-w-[380px]`}>
                  <thead>
                    <tr className={`${ruled.headRow} align-bottom`}>
                      <th className="pb-2.5 pr-5 text-left font-normal">
                        <h2 className="font-display text-lg tracking-tight text-[var(--paper)]">
                          By underlying
                        </h2>
                      </th>
                      <th className={`${ruled.th} text-right`}>Net premium</th>
                      <th className={`${ruled.th} text-right`}>Cycles</th>
                      <th className={`${ruled.th} text-right`}>Open</th>
                      <th className={`${ruled.th} text-right`}>Win rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rollup.map((r) => (
                      <tr key={r.underlying} className={ruled.row}>
                        <td className={`${ruled.td} mono font-medium`}>{r.underlying}</td>
                        <td className={`${ruled.td} ${ruled.num} ${signColor(r.net)}`}>{signed(r.net)}</td>
                        <td className={`${ruled.td} ${ruled.num} text-[var(--muted)]`}>{r.cycles}</td>
                        <td className={`${ruled.td} ${ruled.num} text-[var(--muted)]`}>{r.open || "—"}</td>
                        <td className={`${ruled.td} ${ruled.num}`}>
                          {r.winRatePct != null ? `${r.winRatePct.toFixed(0)}%` : "—"}
                        </td>
                      </tr>
                    ))}
                    <tr className={ruled.totalRow}>
                      <td className={`${ruled.td} ${ruled.totalLabel}`}>Total</td>
                      <td className={`${ruled.td} ${ruled.num} ${signColor(totals.net)}`}>{signed(totals.net)}</td>
                      <td className={`${ruled.td} ${ruled.num}`}>{totals.cycles}</td>
                      <td className={`${ruled.td} ${ruled.num}`}>{totals.open || "—"}</td>
                      <td className={`${ruled.td} ${ruled.num}`}>
                        {totals.winRatePct != null ? `${totals.winRatePct.toFixed(0)}%` : "—"}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </div>
      )}

      <RuledFooter
        note={
          <>
            Premium income covers naked short premium only — spread strategies (verticals, combos)
            are excluded from every figure here and live on the options desk instead. Cycles cover
            contracts opened with a sell; assignment is inferred from a matching ±100-share stock
            trade within five days of expiry. Annualized figures are net premium over cash-secured
            collateral (puts).
          </>
        }
      />
    </div>
  );
}
