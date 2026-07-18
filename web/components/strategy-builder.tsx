"use client";

/**
 * Opinion-driven strategy builder for the per-ticker options desk.
 *
 * You give it a view (direction + price target), a timeframe (the page's selected
 * expiry), and a risk appetite (a preset or explicit budget / max-loss + a
 * defined-risk toggle). It ranks candidate strategies priced off the live chain,
 * shows each one's payoff + safety numbers, and lets you hand-build any custom
 * position with the same analytics. All math lives in `lib/strategy.ts` (pure +
 * tested); this is inputs, wiring, and presentation.
 */

import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Compass, Plus, Shield, Sparkles, Trash2, Wand2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { PayoffDiagram } from "@/components/payoff-diagram";
import { formatCurrency } from "@/lib/utils";
import { daysToExpiry, formatOptionExpiry, formatStrike } from "@/lib/options";
import { computeGreeks } from "@/lib/greeks";
import { probabilityOfProfit } from "@/lib/option-analytics";
import { analyzePayoff, CONTRACT_SIZE, type PayoffAnalysis, type PayoffLeg } from "@/lib/payoff";
import { useChartTheme } from "@/lib/chart-theme";
import { atmIv, contractsForExpiry } from "@/lib/option-chain-analytics";
import {
  generateStrategies,
  marketImpliedDensity,
  midQuote,
  pnlDistribution,
  type Bias,
  type StrategyCandidate,
} from "@/lib/strategy";
import type { OptionQuote } from "@/lib/yahoo";


const BIASES: { key: Bias; label: string; hint: string }[] = [
  { key: "bullish", label: "Bullish", hint: "up" },
  { key: "bearish", label: "Bearish", hint: "down" },
  { key: "neutral", label: "Neutral", hint: "range-bound" },
  { key: "volatile", label: "Volatile", hint: "big move either way" },
];

type PresetKey = "conservative" | "balanced" | "aggressive";
const PRESETS: Record<PresetKey, { label: string; budget: number; maxLoss: number; definedOnly: boolean }> = {
  conservative: { label: "Conservative", budget: 1000, maxLoss: 300, definedOnly: true },
  balanced: { label: "Balanced", budget: 5000, maxLoss: 1500, definedOnly: true },
  aggressive: { label: "Aggressive", budget: 20000, maxLoss: 20000, definedOnly: false },
};

export function StrategyBuilder({
  ticker,
  contracts,
  selectedExpiry,
  spot,
  currency = "USD",
}: {
  ticker: string;
  contracts: OptionQuote[];
  selectedExpiry: string | null;
  spot: number | null;
  currency?: string;
}) {
  const expiryContracts = useMemo(
    () => (selectedExpiry ? contractsForExpiry(contracts, selectedExpiry) : []),
    [contracts, selectedExpiry],
  );
  const sigma = useMemo(() => {
    if (!selectedExpiry || spot == null) return null;
    const atm = atmIv(contracts, selectedExpiry, spot);
    if (atm != null) return atm;
    // Fall back to the mean priced IV on the expiry so we can still model.
    const ivs = expiryContracts.map((c) => c.iv).filter((v): v is number => v != null && v > 0);
    return ivs.length ? ivs.reduce((s, v) => s + v, 0) / ivs.length : null;
  }, [contracts, selectedExpiry, spot, expiryContracts]);

  const dte = selectedExpiry ? Math.max(0, daysToExpiry(selectedExpiry)) : 0;
  // Floor 0-DTE to half a day so probability / EV / greeks stay finite.
  const T = Math.max(dte, 0.5) / 365;
  const em = useMemo(
    () => (spot != null && sigma != null && T > 0 ? spot * sigma * Math.sqrt(T) : null),
    [spot, sigma, T],
  );

  const [bias, setBias] = useState<Bias>("bullish");
  const [preset, setPreset] = useState<PresetKey>("balanced");
  const [budget, setBudget] = useState(PRESETS.balanced.budget);
  const [maxLoss, setMaxLoss] = useState(PRESETS.balanced.maxLoss);
  const [definedOnly, setDefinedOnly] = useState(PRESETS.balanced.definedOnly);
  const [targetOverride, setTargetOverride] = useState<number | null>(null);

  // Default target anchors to the ±1σ move for the current view; a bias change
  // clears any manual override so the target re-anchors to the new direction.
  const defaultTarget = useMemo(() => {
    if (spot == null) return null;
    const move = em ?? spot * 0.05;
    const seed = bias === "bullish" ? spot + move : bias === "bearish" ? spot - move : spot;
    return Number(seed.toFixed(2));
  }, [bias, spot, em]);
  const target = targetOverride ?? defaultTarget;

  function applyPreset(key: PresetKey) {
    setPreset(key);
    setBudget(PRESETS[key].budget);
    setMaxLoss(PRESETS[key].maxLoss);
    setDefinedOnly(PRESETS[key].definedOnly);
  }

  const candidates = useMemo(() => {
    if (spot == null || sigma == null || !selectedExpiry || target == null) return [];
    return generateStrategies({
      underlying: ticker,
      expiry: selectedExpiry,
      expiryContracts,
      spot,
      sigma,
      target,
      bias,
      risk: { budget, maxLoss, definedOnly },
    });
  }, [ticker, selectedExpiry, expiryContracts, spot, sigma, target, bias, budget, maxLoss, definedOnly]);

  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const selected =
    candidates.find((c) => c.key === selectedKey) ?? candidates[0] ?? null;

  const canModel = spot != null && sigma != null && selectedExpiry != null;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 pt-2">
        <span className="eyebrow inline-flex items-center gap-2">
          <Wand2 size={13} className="text-[var(--brass)]" />
          Strategy builder
        </span>
        <span className="h-px flex-1 bg-line" />
        {selectedExpiry && (
          <span className="text-xs text-[var(--muted)]">
            {formatOptionExpiry(selectedExpiry)} · {dte}d
          </span>
        )}
      </div>

      {!canModel ? (
        <Card className="p-8 text-center">
          <p className="text-sm text-[var(--muted)]">
            Need a live spot price and implied vol on the selected expiry to model strategies. Pick an
            expiry with quoted options above.
          </p>
        </Card>
      ) : (
        <>
          <Card className="space-y-5 p-5 sm:p-6">
            {/* View */}
            <div className="flex flex-wrap items-end gap-x-6 gap-y-4">
              <div>
                <p className="eyebrow mb-2 inline-flex items-center gap-1.5">
                  <Compass size={12} className="text-[var(--brass)]" />
                  Your view
                </p>
                <Segmented
                  value={bias}
                  onChange={(v) => {
                    setBias(v as Bias);
                    setTargetOverride(null);
                  }}
                  options={BIASES}
                />
              </div>
              <label className="block">
                <span className="eyebrow mb-2 block">
                  {bias === "neutral" ? "Pin price" : bias === "volatile" ? "Center" : "Price target"}
                </span>
                <div className="flex items-center gap-2">
                  <div className="flex items-center rounded-lg border border-line bg-[var(--panel)] px-3 py-1.5">
                    <span className="mono text-sm text-[var(--muted)]">$</span>
                    <input
                      type="number"
                      value={target ?? ""}
                      onChange={(e) => setTargetOverride(e.target.value === "" ? null : Number(e.target.value))}
                      className="w-24 bg-transparent px-1 text-sm text-[var(--paper)] outline-none"
                      step="0.5"
                    />
                  </div>
                  {em != null && spot != null && (
                    <span className="text-xs text-[var(--muted)]">
                      ±1σ {formatCurrency(em, currency)} · spot {formatStrike(Number(spot.toFixed(2)))}
                    </span>
                  )}
                </div>
              </label>
            </div>

            {/* Risk appetite */}
            <div className="flex flex-wrap items-end gap-x-6 gap-y-4 border-t border-line/60 pt-5">
              <div>
                <p className="eyebrow mb-2 inline-flex items-center gap-1.5">
                  <Shield size={12} className="text-[var(--brass)]" />
                  Risk appetite
                </p>
                <Segmented
                  value={preset}
                  onChange={(v) => applyPreset(v as PresetKey)}
                  options={(Object.keys(PRESETS) as PresetKey[]).map((k) => ({ key: k, label: PRESETS[k].label }))}
                />
              </div>
              <NumberField label="Capital budget" value={budget} onChange={setBudget} currency={currency} />
              <NumberField label="Max loss" value={maxLoss} onChange={setMaxLoss} currency={currency} />
              <label className="flex cursor-pointer items-center gap-2 pb-1.5 text-sm text-[var(--muted)]">
                <input
                  type="checkbox"
                  checked={definedOnly}
                  onChange={(e) => setDefinedOnly(e.target.checked)}
                  className="h-4 w-4 accent-[var(--jade)]"
                />
                Defined risk only
              </label>
            </div>
          </Card>

          {candidates.length === 0 ? (
            <Card className="p-8 text-center">
              <p className="text-sm text-[var(--muted)]">
                No priceable strategies for this view on {formatOptionExpiry(selectedExpiry!)} — the chain may
                be missing quotes near your target. Try another expiry or widen your budget.
              </p>
            </Card>
          ) : (
            <>
              {/* Ranked suggestions */}
              <div className="grid gap-3 sm:grid-cols-2">
                {candidates.map((c) => (
                  <SuggestionCard
                    key={c.key}
                    c={c}
                    active={selected?.key === c.key}
                    currency={currency}
                    spot={spot!}
                    onSelect={() => setSelectedKey(c.key)}
                  />
                ))}
              </div>

              {/* Safety panel for the chosen strategy */}
              {selected && (
                <SafetyPanel
                  title={`${selected.name} · safety`}
                  legs={selected.payoffLegs}
                  analysis={selected.analysis}
                  pop={selected.pop}
                  capital={selected.capital}
                  netDebit={selected.netDebit}
                  expiryContracts={expiryContracts}
                  spot={spot!}
                  sigma={sigma!}
                  T={T}
                  currency={currency}
                />
              )}
            </>
          )}

          {/* Manual builder */}
          <ManualBuilder
            expiryContracts={expiryContracts}
            spot={spot!}
            sigma={sigma!}
            T={T}
            ticker={ticker}
            expiry={selectedExpiry!}
            currency={currency}
          />
        </>
      )}
    </div>
  );
}

// ── Suggestion card ──────────────────────────────────────────────────────────

function SuggestionCard({
  c,
  active,
  currency,
  spot,
  onSelect,
}: {
  c: StrategyCandidate;
  active: boolean;
  currency: string;
  spot: number;
  onSelect: () => void;
}) {
  const rr =
    c.analysis.maxProfitUnbounded
      ? "∞"
      : c.analysis.maxProfit != null && c.analysis.maxLoss != null && c.analysis.maxLoss > 0
        ? `${(c.analysis.maxProfit / c.analysis.maxLoss).toFixed(2)}×`
        : "—";
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`rounded-[var(--radius)] border p-4 text-left transition-colors ${
        active
          ? "border-[var(--brass-dim)] bg-[var(--panel-2)]/50"
          : "border-line bg-[var(--panel)]/40 hover:border-[var(--brass-dim)]"
      }`}
    >
      <div className="flex items-center gap-2">
        <span className="font-medium text-[var(--paper)]">{c.name}</span>
        {!c.withinBudget && (
          <span className="rounded-full border border-[var(--coral)]/40 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-[var(--coral)]">
            over budget
          </span>
        )}
        <span className="ml-auto inline-flex items-center gap-1.5">
          <FitBar fit={c.fit} />
          <span className="mono text-[10px] text-[var(--muted)]">{Math.round(c.fit * 100)}</span>
        </span>
      </div>
      <p className="mono mt-0.5 text-xs text-[var(--muted)]">{c.summary}</p>

      <PayoffDiagram legs={c.payoffLegs} currentPrice={spot} breakevens={c.analysis.breakevens} className="mt-3" />

      <div className="mt-3 grid grid-cols-4 gap-2 text-center">
        <Mini label="Max P" tone="jade">
          {c.analysis.maxProfitUnbounded ? "∞" : c.analysis.maxProfit != null ? `+${compact(c.analysis.maxProfit, currency)}` : "—"}
        </Mini>
        <Mini label="Max L" tone="coral">
          {c.analysis.maxLossUnbounded ? "∞" : c.analysis.maxLoss != null ? `−${compact(c.analysis.maxLoss, currency)}` : "—"}
        </Mini>
        <Mini label="POP">{c.pop != null ? `${Math.round(c.pop * 100)}%` : "—"}</Mini>
        <Mini label="R:R">{rr}</Mini>
      </div>
      <div className="mt-2 flex items-center justify-between text-[11px] text-[var(--muted)]">
        <span>
          {c.netDebit >= 0 ? "Debit" : "Credit"} {compact(Math.abs(c.netDebit), currency)}
        </span>
        <span>
          Capital {compact(c.capital, currency)} · EV{" "}
          <span className={c.ev != null && c.ev >= 0 ? "text-[var(--jade)]" : "text-[var(--coral)]"}>
            {c.ev != null ? `${c.ev >= 0 ? "+" : "−"}${compact(Math.abs(c.ev), currency)}` : "—"}
          </span>
        </span>
      </div>
    </button>
  );
}

function FitBar({ fit }: { fit: number }) {
  return (
    <span className="inline-block h-1.5 w-14 overflow-hidden rounded-full bg-[var(--panel-2)]">
      <span
        className="block h-full rounded-full bg-[var(--jade)]"
        style={{ width: `${Math.round(fit * 100)}%` }}
      />
    </span>
  );
}

// ── Safety panel ─────────────────────────────────────────────────────────────

function SafetyPanel({
  title,
  legs,
  analysis,
  pop,
  capital,
  netDebit,
  expiryContracts,
  spot,
  sigma,
  T,
  currency,
}: {
  title: string;
  legs: PayoffLeg[];
  analysis: PayoffAnalysis;
  pop: number | null;
  capital: number;
  netDebit: number;
  expiryContracts: OptionQuote[];
  spot: number;
  sigma: number;
  T: number;
  currency: string;
}) {
  const ct = useChartTheme();
  // Score against the market-implied (smile) density recovered from the chain, so
  // multi-strike structures (butterflies/condors) aren't mispriced by a single
  // flat-vol lognormal. Falls back to the lognormal when the chain is too sparse.
  const density = useMemo(
    () => marketImpliedDensity(expiryContracts, spot, sigma, T),
    [expiryContracts, spot, sigma, T],
  );
  const dist = useMemo(
    () => pnlDistribution(legs, spot, sigma, T, { density }),
    [legs, spot, sigma, T, density],
  );
  const greeks = useMemo(
    () => netGreeks(legs, expiryContracts, spot, sigma),
    [legs, expiryContracts, spot, sigma],
  );

  // Probability of the worst case (finishing at/under the lowest breakeven for a
  // long-debit shape, i.e. the max-loss zone). Derived from the win probability.
  const pMaxLoss = dist ? Math.max(0, 1 - dist.pWin) : null;
  const cushion =
    analysis.breakevens.length && spot > 0
      ? Math.min(...analysis.breakevens.map((b) => Math.abs(b - spot))) / spot
      : null;

  return (
    <Card className="p-0">
      <div className="flex items-center justify-between border-b border-line px-6 py-4">
        <span className="eyebrow inline-flex items-center gap-2">
          <Shield size={13} className="text-[var(--brass)]" />
          {title}
        </span>
        <span className="text-xs text-[var(--muted)]">estimates · market-implied (lognormal)</span>
      </div>
      <div className="grid gap-6 p-6 lg:grid-cols-2">
        <div>
          <PayoffDiagram legs={legs} currentPrice={spot} breakevens={analysis.breakevens} />
          <p className="mt-2 eyebrow">P&amp;L distribution at expiry</p>
          {dist && dist.bins.length ? (
            <ResponsiveContainer width="100%" height={170}>
              <BarChart data={dist.bins} margin={{ left: 4, right: 8, top: 8, bottom: 4 }}>
                <CartesianGrid stroke={ct.grid} strokeDasharray="2 4" vertical={false} />
                <XAxis
                  dataKey="pnl"
                  type="number"
                  domain={["dataMin", "dataMax"]}
                  tick={ct.tick}
                  tickFormatter={(v) => compact(v, currency)}
                  tickLine={false}
                  axisLine={{ stroke: ct.grid }}
                />
                <YAxis tick={ct.tick} tickFormatter={(v) => `${(v * 100).toFixed(0)}%`} tickLine={false} axisLine={false} width={38} />
                <Tooltip
                  contentStyle={ct.tooltipStyle}
                  labelStyle={ct.labelStyle}
                  itemStyle={{ color: ct.paper }}
                  cursor={{ fill: "color-mix(in srgb, var(--paper) 8%, transparent)" }}
                  formatter={(value) => [`${(Number(value) * 100).toFixed(1)}%`, "Probability"]}
                  labelFormatter={(l) => `P&L ${compact(Number(l), currency)}`}
                />
                <ReferenceLine x={0} stroke={ct.gridStrong} />
                <Bar dataKey="prob" isAnimationActive={false}>
                  {dist.bins.map((b, i) => (
                    <Cell key={i} fill={b.pnl >= 0 ? ct.jade : ct.coral} fillOpacity={0.85} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p className="py-8 text-center text-sm text-[var(--muted)]">Not enough vol to model a distribution.</p>
          )}
        </div>

        <div className="space-y-1 text-sm">
          <SafetyRow label="Probability of profit" tone="jade">
            {pop != null ? `${(pop * 100).toFixed(0)}%` : "—"}
          </SafetyRow>
          <SafetyRow label="Expected value" tone={dist && dist.ev >= 0 ? "jade" : "coral"}>
            {dist ? `${dist.ev >= 0 ? "+" : "−"}${formatCurrency(Math.abs(dist.ev), currency)}` : "—"}
          </SafetyRow>
          <SafetyRow label="Chance of losing" tone="coral">
            {pMaxLoss != null ? `${(pMaxLoss * 100).toFixed(0)}%` : "—"}
          </SafetyRow>
          <SafetyRow label="Max loss">
            {analysis.maxLossUnbounded ? "Unlimited" : analysis.maxLoss != null ? `−${formatCurrency(analysis.maxLoss, currency)}` : "—"}
          </SafetyRow>
          <SafetyRow label="Capital at risk">{formatCurrency(capital, currency)}</SafetyRow>
          <SafetyRow label={netDebit >= 0 ? "Net debit" : "Net credit"}>
            {formatCurrency(Math.abs(netDebit), currency)}
          </SafetyRow>
          <SafetyRow label="Breakeven cushion">
            {cushion != null ? `${(cushion * 100).toFixed(1)}% from spot` : "—"}
          </SafetyRow>
          <div className="!mt-3 grid grid-cols-3 gap-2 border-t border-line/60 pt-3">
            <GreekStat label="Net Δ" value={greeks.delta} digits={0} />
            <GreekStat label="Θ / day" value={greeks.theta} digits={0} money currency={currency} />
            <GreekStat label="Vega" value={greeks.vega} digits={0} money currency={currency} />
          </div>
        </div>
      </div>
    </Card>
  );
}

// ── Manual builder ───────────────────────────────────────────────────────────

type ManualLeg = { id: number; right: "call" | "put"; strike: number; contracts: number };

function ManualBuilder({
  expiryContracts,
  spot,
  sigma,
  T,
  ticker,
  expiry,
  currency,
}: {
  expiryContracts: OptionQuote[];
  spot: number;
  sigma: number;
  T: number;
  ticker: string;
  expiry: string;
  currency: string;
}) {
  const strikes = useMemo(
    () => Array.from(new Set(expiryContracts.map((c) => c.strike))).sort((a, b) => a - b),
    [expiryContracts],
  );
  const atmStrike = useMemo(
    () => strikes.reduce((b, s) => (Math.abs(s - spot) < Math.abs(b - spot) ? s : b), strikes[0] ?? spot),
    [strikes, spot],
  );

  const [legs, setLegs] = useState<ManualLeg[]>([]);
  const [nextId, setNextId] = useState(1);

  function addLeg() {
    setLegs((l) => [...l, { id: nextId, right: "call", strike: atmStrike, contracts: 1 }]);
    setNextId((n) => n + 1);
  }
  function update(id: number, patch: Partial<ManualLeg>) {
    setLegs((l) => l.map((leg) => (leg.id === id ? { ...leg, ...patch } : leg)));
  }
  function remove(id: number) {
    setLegs((l) => l.filter((leg) => leg.id !== id));
  }

  const at = useMemo(() => {
    const m = new Map<number, { call: OptionQuote | null; put: OptionQuote | null }>();
    for (const c of expiryContracts) {
      const e = m.get(c.strike) ?? { call: null, put: null };
      if (c.right === "call") e.call = c;
      else e.put = c;
      m.set(c.strike, e);
    }
    return m;
  }, [expiryContracts]);

  const built = useMemo(() => {
    const payoffLegs: PayoffLeg[] = [];
    for (const leg of legs) {
      const q = leg.right === "call" ? at.get(leg.strike)?.call : at.get(leg.strike)?.put;
      if (!q || leg.contracts === 0) continue;
      const mid = midQuote(q, spot, T);
      if (mid == null) continue;
      const quantity = leg.contracts * CONTRACT_SIZE;
      payoffLegs.push({
        parsed: { occ: `${ticker}${expiry}${leg.right}${leg.strike}`, underlying: ticker, expiry, right: leg.right, strike: leg.strike },
        quantity,
        costBasis: mid * quantity,
      });
    }
    if (!payoffLegs.length) return null;
    const analysis = analyzePayoff(payoffLegs);
    const density = marketImpliedDensity(expiryContracts, spot, sigma, T);
    const pop = probabilityOfProfit(payoffLegs, analysis, spot, sigma, T, density);
    const capital = analysis.maxLoss ?? Math.abs(analysis.netDebit);
    return { payoffLegs, analysis, pop, capital };
  }, [legs, at, spot, sigma, T, ticker, expiry, expiryContracts]);

  return (
    <Card className="p-0">
      <div className="flex items-center justify-between border-b border-line px-6 py-4">
        <span className="eyebrow inline-flex items-center gap-2">
          <Sparkles size={13} className="text-[var(--brass)]" />
          Build your own
        </span>
        <button
          type="button"
          onClick={addLeg}
          className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs text-[var(--muted)] transition-colors hover:border-[var(--brass-dim)] hover:text-[var(--paper)]"
        >
          <Plus size={13} />
          Add leg
        </button>
      </div>
      <div className="space-y-2 p-4 sm:p-6">
        {legs.length === 0 ? (
          <p className="py-4 text-center text-sm text-[var(--muted)]">
            Add legs from the {formatOptionExpiry(expiry)} chain to sketch any position and see its payoff + safety.
          </p>
        ) : (
          legs.map((leg) => (
            <div key={leg.id} className="flex flex-wrap items-center gap-2">
              <Segmented
                value={leg.contracts >= 0 ? "long" : "short"}
                onChange={(v) => update(leg.id, { contracts: (v === "long" ? 1 : -1) * Math.abs(leg.contracts || 1) })}
                options={[
                  { key: "long", label: "Long" },
                  { key: "short", label: "Short" },
                ]}
              />
              <input
                type="number"
                min={1}
                value={Math.abs(leg.contracts)}
                onChange={(e) =>
                  update(leg.id, { contracts: Math.sign(leg.contracts || 1) * Math.max(1, Number(e.target.value)) })
                }
                className="w-14 rounded-lg border border-line bg-[var(--panel)] px-2 py-1.5 text-sm text-[var(--paper)] outline-none"
              />
              <select
                value={leg.right}
                onChange={(e) => update(leg.id, { right: e.target.value as "call" | "put" })}
                className="rounded-lg border border-line bg-[var(--panel)] px-2 py-1.5 text-sm text-[var(--paper)] outline-none"
              >
                <option value="call">Call</option>
                <option value="put">Put</option>
              </select>
              <select
                value={leg.strike}
                onChange={(e) => update(leg.id, { strike: Number(e.target.value) })}
                className="rounded-lg border border-line bg-[var(--panel)] px-2 py-1.5 text-sm text-[var(--paper)] outline-none"
              >
                {strikes.map((s) => (
                  <option key={s} value={s}>
                    {formatStrike(s)}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => remove(leg.id)}
                className="rounded-lg p-1.5 text-[var(--faint)] transition-colors hover:text-[var(--coral)]"
                aria-label="Remove leg"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))
        )}
      </div>

      {built && (
        <SafetyPanel
          title="Custom position · safety"
          legs={built.payoffLegs}
          analysis={built.analysis}
          pop={built.pop}
          capital={built.capital}
          netDebit={built.analysis.netDebit}
          expiryContracts={expiryContracts}
          spot={spot}
          sigma={sigma}
          T={T}
          currency={currency}
        />
      )}
    </Card>
  );
}

// ── Shared bits ──────────────────────────────────────────────────────────────

/** Net position greeks summed across legs (per-share greeks × signed shares). */
function netGreeks(legs: PayoffLeg[], expiryContracts: OptionQuote[], spot: number, sigma: number) {
  let delta = 0;
  let theta = 0;
  let vega = 0;
  for (const l of legs) {
    const q = expiryContracts.find(
      (c) => c.strike === l.parsed.strike && c.right === l.parsed.right,
    );
    const iv = q?.iv ?? sigma;
    const g = q?.greeks?.delta != null ? q.greeks : computeGreeks(l.parsed, spot, iv);
    const shares = l.quantity ?? 0;
    if (g.delta != null) delta += g.delta * shares;
    if (g.theta != null) theta += g.theta * shares;
    if (g.vega != null) vega += g.vega * shares;
  }
  return { delta, theta, vega };
}

function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { key: T; label: string; hint?: string }[];
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
            title={o.hint}
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

function NumberField({
  label,
  value,
  onChange,
  currency,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  currency: string;
}) {
  return (
    <label className="block">
      <span className="eyebrow mb-2 block">{label}</span>
      <div className="flex items-center rounded-lg border border-line bg-[var(--panel)] px-3 py-1.5">
        <span className="mono text-sm text-[var(--muted)]">{currency === "USD" ? "$" : ""}</span>
        <input
          type="number"
          min={0}
          value={value}
          onChange={(e) => onChange(Math.max(0, Number(e.target.value)))}
          className="w-24 bg-transparent px-1 text-sm text-[var(--paper)] outline-none"
        />
      </div>
    </label>
  );
}

function Mini({ label, tone, children }: { label: string; tone?: "jade" | "coral"; children: React.ReactNode }) {
  const color = tone === "jade" ? "text-[var(--jade)]" : tone === "coral" ? "text-[var(--coral)]" : "text-[var(--paper)]";
  return (
    <div>
      <p className="text-[9px] uppercase tracking-wide text-[var(--faint)]">{label}</p>
      <p className={`mono mt-0.5 text-xs ${color}`}>{children}</p>
    </div>
  );
}

function SafetyRow({ label, tone, children }: { label: string; tone?: "jade" | "coral"; children: React.ReactNode }) {
  const color = tone === "jade" ? "text-[var(--jade)]" : tone === "coral" ? "text-[var(--coral)]" : "text-[var(--paper)]";
  return (
    <div className="flex items-center justify-between border-b border-line/40 py-1.5 last:border-0">
      <span className="text-[var(--muted)]">{label}</span>
      <span className={`mono ${color}`}>{children}</span>
    </div>
  );
}

function GreekStat({
  label,
  value,
  digits,
  money,
  currency,
}: {
  label: string;
  value: number;
  digits: number;
  money?: boolean;
  currency?: string;
}) {
  return (
    <div className="rounded-lg border border-line/60 bg-[var(--panel)]/40 px-2 py-2 text-center">
      <p className="text-[9px] uppercase tracking-wide text-[var(--faint)]">{label}</p>
      <p className="mono mt-0.5 text-sm text-[var(--paper)]">
        {money && currency ? `${value >= 0 ? "" : "−"}${formatCurrency(Math.abs(value), currency)}` : value.toFixed(digits)}
      </p>
    </div>
  );
}

/** Compact signed currency for tight metric cells: "$1.2K". */
function compact(n: number, currency: string): string {
  const abs = Math.abs(n);
  if (abs >= 1000) return `${currency === "USD" ? "$" : ""}${(n / 1000).toFixed(1)}K`;
  return formatCurrency(n, currency);
}
