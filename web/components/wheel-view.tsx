"use client";

/**
 * Wheel & premium collection — the income side of the options book:
 * KPI band → monthly net premium bars + cumulative line → open short
 * positions (CSP collateral, CC coverage, annualized yield) → the cycle
 * ledger (how every short ended) → per-underlying scorecard.
 */

import { useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card } from "@/components/ui/card";
import { formatCurrency } from "@/lib/utils";
import { formatOptionExpiry, formatStrike } from "@/lib/options";
import type { WheelReport } from "@/lib/wheel";

const money = (n: number) => formatCurrency(n, "USD", { maximumFractionDigits: 0 });
const signed = (n: number) => `${n >= 0 ? "+" : "−"}${money(Math.abs(n))}`;
const signColor = (n: number) => (n >= 0 ? "text-[var(--jade)]" : "text-[var(--coral)]");

const OUTCOME_BADGE: Record<string, { label: string; cls: string }> = {
  expired: { label: "expired · kept", cls: "bg-[var(--jade)]/12 text-[var(--jade)]" },
  assigned: { label: "assigned", cls: "bg-[var(--brass)]/15 text-[var(--brass)]" },
  closed: { label: "bought back", cls: "bg-[var(--panel-2)] text-[var(--muted)]" },
  open: { label: "open", cls: "bg-[var(--blue)]/12 text-[var(--blue)]" },
};

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className="min-w-0">
      <p className="eyebrow">{label}</p>
      <p className={`display-2 font-display tabular mt-1.5 text-2xl sm:text-3xl ${tone ?? ""}`}>{value}</p>
      {sub && <p className="mt-1 text-xs text-[var(--muted)]">{sub}</p>}
    </div>
  );
}

export function WheelView({ report }: { report: WheelReport }) {
  const [showAllCycles, setShowAllCycles] = useState(false);
  const { kpis, months, cumulative, open, cycles, rollup } = report;
  const chartData = months.map((m, i) => ({ ...m, cumulative: cumulative[i]!.cumulative }));
  const visibleCycles = showAllCycles ? cycles : cycles.slice(0, 25);

  if (months.length === 0 && open.length === 0) {
    return (
      <Card>
        <span className="eyebrow">Wheel & premium</span>
        <p className="mt-3 max-w-lg text-sm text-[var(--muted)]">
          No option trades on the tape yet. Once short puts or covered calls appear in your
          investment transactions, premium income and wheel cycles report here automatically.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-7">
      {/* KPI band */}
      <Card>
        <div className="grid grid-cols-2 gap-x-6 gap-y-5 lg:grid-cols-4">
          <Kpi label="Net premium · this month" value={signed(kpis.netThisMonth)} tone={signColor(kpis.netThisMonth)} />
          <Kpi label="Net premium · YTD" value={signed(kpis.netYtd)} tone={signColor(kpis.netYtd)} />
          <Kpi label="Net premium · all time" value={signed(kpis.netAllTime)} tone={signColor(kpis.netAllTime)} />
          <Kpi
            label="Collateral at risk"
            value={money(kpis.collateralAtRisk)}
            sub={`${kpis.openContracts} open short ${kpis.openContracts === 1 ? "contract" : "contracts"}${
              kpis.uncoveredCalls > 0 ? ` · ${kpis.uncoveredCalls} uncovered call${kpis.uncoveredCalls > 1 ? "s" : ""}` : ""
            }`}
            tone={kpis.uncoveredCalls > 0 ? "text-[var(--coral)]" : undefined}
          />
        </div>
      </Card>

      {/* Income charts */}
      {months.length > 0 && (
        <div className="grid gap-7 lg:grid-cols-2">
          <Card className="p-0">
            <div className="border-b border-line px-6 py-4">
              <span className="eyebrow">Net premium by month</span>
            </div>
            <div className="px-2 pb-2 pt-4 sm:px-4">
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={chartData} margin={{ top: 4, right: 12, bottom: 0, left: -8 }}>
                  <CartesianGrid stroke="var(--chart-grid)" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="month" tick={{ fill: "var(--muted)", fontSize: 11 }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fill: "var(--muted)", fontSize: 11 }} tickLine={false} axisLine={false} />
                  <Tooltip
                    contentStyle={{ background: "var(--chart-tooltip-bg)", border: "1px solid var(--line)", borderRadius: 10, fontSize: 12 }}
                    formatter={(v) => [money(Number(v ?? 0)), "net premium"]}
                  />
                  <Bar dataKey="net" radius={[4, 4, 0, 0]}>
                    {chartData.map((m) => (
                      <Cell key={m.month} fill={m.net >= 0 ? "var(--jade)" : "var(--coral)"} opacity={0.85} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
          <Card className="p-0">
            <div className="border-b border-line px-6 py-4">
              <span className="eyebrow">Cumulative net premium</span>
            </div>
            <div className="px-2 pb-2 pt-4 sm:px-4">
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={chartData} margin={{ top: 4, right: 12, bottom: 0, left: -8 }}>
                  <CartesianGrid stroke="var(--chart-grid)" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="month" tick={{ fill: "var(--muted)", fontSize: 11 }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fill: "var(--muted)", fontSize: 11 }} tickLine={false} axisLine={false} />
                  <Tooltip
                    contentStyle={{ background: "var(--chart-tooltip-bg)", border: "1px solid var(--line)", borderRadius: 10, fontSize: 12 }}
                    formatter={(v) => [money(Number(v ?? 0)), "cumulative"]}
                  />
                  <Line type="monotone" dataKey="cumulative" stroke="var(--brass)" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </div>
      )}

      {/* Open short positions */}
      {open.length > 0 && (
        <Card className="overflow-hidden p-0">
          <div className="border-b border-line px-6 py-4">
            <span className="eyebrow">Open short premium</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-sm">
              <thead>
                <tr className="border-b border-line text-left">
                  <th className="eyebrow px-6 py-2.5">Position</th>
                  <th className="eyebrow px-3 py-2.5 text-right">Expiry</th>
                  <th className="eyebrow px-3 py-2.5 text-right">Credit</th>
                  <th className="eyebrow px-3 py-2.5 text-right">To close</th>
                  <th className="eyebrow px-3 py-2.5 text-right">Collateral</th>
                  <th className="eyebrow px-3 py-2.5 text-right">Ann.</th>
                </tr>
              </thead>
              <tbody>
                {open.map((p) => (
                  <tr key={p.occ} className="border-b border-line/60 last:border-0">
                    <td className="px-6 py-2.5">
                      <span className="mono font-semibold text-[var(--brass)]">{p.underlying}</span>{" "}
                      <span className="text-[var(--muted)]">
                        {p.contracts}× {formatStrike(p.strike)} {p.right === "put" ? "CSP" : "CC"}
                      </span>
                      {p.covered === false && (
                        <span className="ml-2 rounded bg-[var(--coral)]/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-[var(--coral)]">
                          uncovered
                        </span>
                      )}
                    </td>
                    <td className="mono px-3 py-2.5 text-right text-[var(--muted)]">
                      {formatOptionExpiry(p.expiry)} <span className={p.dte <= 7 ? "text-[var(--coral)]" : p.dte <= 21 ? "text-[var(--brass)]" : "text-[var(--faint)]"}>· {p.dte}d</span>
                    </td>
                    <td className="mono px-3 py-2.5 text-right">{p.credit != null ? money(p.credit) : "—"}</td>
                    <td className="mono px-3 py-2.5 text-right text-[var(--muted)]">{p.markToClose != null ? money(p.markToClose) : "—"}</td>
                    <td className="mono px-3 py-2.5 text-right text-[var(--muted)]">{p.collateral != null ? money(p.collateral) : "—"}</td>
                    <td className="mono px-3 py-2.5 text-right">{p.annualizedPct != null ? `${p.annualizedPct.toFixed(1)}%` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Cycle ledger */}
      {cycles.length > 0 && (
        <Card className="overflow-hidden p-0">
          <div className="flex items-center justify-between border-b border-line px-6 py-4">
            <span className="eyebrow">Short-premium ledger</span>
            {cycles.length > 25 && (
              <button
                onClick={() => setShowAllCycles((v) => !v)}
                className="text-xs text-[var(--brass)] transition-colors hover:text-[var(--paper)]"
              >
                {showAllCycles ? "Latest 25" : `All ${cycles.length}`}
              </button>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-line text-left">
                  <th className="eyebrow px-6 py-2.5">Opened</th>
                  <th className="eyebrow px-3 py-2.5">Contract</th>
                  <th className="eyebrow px-3 py-2.5">Outcome</th>
                  <th className="eyebrow px-3 py-2.5 text-right">Net</th>
                  <th className="eyebrow px-3 py-2.5 text-right">Days</th>
                  <th className="eyebrow px-3 py-2.5 text-right">Ann.</th>
                </tr>
              </thead>
              <tbody>
                {visibleCycles.map((c) => {
                  const badge = OUTCOME_BADGE[c.outcome]!;
                  return (
                    <tr key={c.occ + c.opened} className="border-b border-line/60 last:border-0">
                      <td className="mono px-6 py-2.5 text-[var(--muted)]">{c.opened}</td>
                      <td className="px-3 py-2.5">
                        <span className="mono font-semibold text-[var(--brass)]">{c.underlying}</span>{" "}
                        <span className="text-[var(--muted)]">
                          {c.qty}× {formatStrike(c.strike)} {c.right} · {formatOptionExpiry(c.expiry)}
                        </span>
                      </td>
                      <td className="px-3 py-2.5">
                        <span className={`rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${badge.cls}`}>{badge.label}</span>
                      </td>
                      <td className={`mono px-3 py-2.5 text-right ${signColor(c.net)}`}>{signed(c.net)}</td>
                      <td className="mono px-3 py-2.5 text-right text-[var(--muted)]">{c.daysHeld}</td>
                      <td className="mono px-3 py-2.5 text-right text-[var(--muted)]">
                        {c.annualizedPct != null && c.outcome !== "open" ? `${c.annualizedPct.toFixed(0)}%` : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Per-underlying scorecard */}
      {rollup.length > 0 && (
        <Card className="overflow-hidden p-0">
          <div className="border-b border-line px-6 py-4">
            <span className="eyebrow">By underlying</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] text-sm">
              <thead>
                <tr className="border-b border-line text-left">
                  <th className="eyebrow px-6 py-2.5">Underlying</th>
                  <th className="eyebrow px-3 py-2.5 text-right">Net premium</th>
                  <th className="eyebrow px-3 py-2.5 text-right">Cycles</th>
                  <th className="eyebrow px-3 py-2.5 text-right">Open</th>
                  <th className="eyebrow px-3 py-2.5 text-right">Win rate</th>
                </tr>
              </thead>
              <tbody>
                {rollup.map((r) => (
                  <tr key={r.underlying} className="border-b border-line/60 last:border-0">
                    <td className="mono px-6 py-2.5 font-semibold text-[var(--brass)]">{r.underlying}</td>
                    <td className={`mono px-3 py-2.5 text-right ${signColor(r.net)}`}>{signed(r.net)}</td>
                    <td className="mono px-3 py-2.5 text-right text-[var(--muted)]">{r.cycles}</td>
                    <td className="mono px-3 py-2.5 text-right text-[var(--muted)]">{r.open || "—"}</td>
                    <td className="mono px-3 py-2.5 text-right">{r.winRatePct != null ? `${r.winRatePct.toFixed(0)}%` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <p className="text-[11px] text-[var(--muted)]">
        Premium income is net option cash flow — spread long legs subtract. Cycles cover contracts
        opened with a sell; assignment is inferred from a matching ±100-share stock trade within
        five days of expiry. Annualized figures are net premium over cash-secured collateral (puts).
      </p>
    </div>
  );
}
