"use client";

/**
 * Opinion-driven strategy builder for the per-ticker options desk.
 *
 * Two columns on the canvas. Left: the legs you are building (by hand, from a
 * template, or by clicking a bid/ask in the chain above) and the payoff of the
 * position in focus. Right: that position's safety numbers, then the suggester —
 * a view (direction + price target), a risk appetite (preset or explicit budget
 * / max-loss + a defined-risk toggle) and the candidates it ranks off the live
 * chain. One position is in focus at a time: your own legs once you have any,
 * or a suggested candidate when you pick one. All math lives in
 * `lib/strategy.ts` (pure + tested); this is inputs, wiring, and presentation.
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
import { Plus, X } from "lucide-react";
import { ChoicePill, DeskHead, DeskNote, FigureRow } from "@/components/options/desk-ui";
import { Segmented, pill, ruled } from "@/components/portfolio/ruled";
import { PayoffDiagram } from "@/components/options/payoff-diagram";
import { PnlMatrix, type MatrixMode } from "@/components/options/pnl-matrix";
import { formatCurrency } from "@/lib/utils";
import { classifyOptionLegs, daysToExpiry, formatOptionExpiry, formatStrike } from "@/lib/options";
import { computeGreeks } from "@/lib/greeks";
import { probabilityOfProfit } from "@/lib/option-analytics";
import {
  analyzePayoff,
  CONTRACT_SIZE,
  payoffCurve,
  type PayoffAnalysis,
  type PayoffLeg,
} from "@/lib/payoff";
import { positionPnl, pnlMatrix, type SigmaFor } from "@/lib/strategy-value";
import { STRATEGY_TEMPLATES, buildTemplate, type TemplateKey } from "@/lib/strategy-templates";
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


const BIASES: { value: Bias; label: string }[] = [
  { value: "bullish", label: "Bullish" },
  { value: "bearish", label: "Bearish" },
  { value: "neutral", label: "Neutral" },
  { value: "volatile", label: "Volatile" },
];

type PresetKey = "conservative" | "balanced" | "aggressive";
const PRESETS: Record<PresetKey, { label: string; budget: number; maxLoss: number; definedOnly: boolean }> = {
  conservative: { label: "Conservative", budget: 1000, maxLoss: 300, definedOnly: true },
  balanced: { label: "Balanced", budget: 5000, maxLoss: 1500, definedOnly: true },
  aggressive: { label: "Aggressive", budget: 20000, maxLoss: 20000, definedOnly: false },
};

/**
 * One hand-built leg. `contracts` is signed whole CONTRACTS (+ long, − short);
 * it is multiplied by CONTRACT_SIZE (100 shares) only where the payoff engine
 * needs a share quantity.
 */
export type ManualLeg = { id: number; right: "call" | "put"; strike: number; contracts: number };

type PayoffView = "payoff" | MatrixMode;

/** The one position the payoff and safety columns are describing. */
type Focus = {
  title: string;
  legs: PayoffLeg[];
  analysis: PayoffAnalysis;
  pop: number | null;
  capital: number;
  netDebit: number;
};

const legsSig = (legs: ManualLeg[]) =>
  legs.map((l) => `${l.right}:${l.strike}:${l.contracts}`).join("|");

const fieldCls =
  "rounded-lg border border-line bg-[var(--panel)] px-2.5 py-1.5 text-sm text-[var(--paper)] outline-none focus:border-[var(--brass-dim)]";

export function StrategyBuilder({
  ticker,
  contracts,
  selectedExpiry,
  spot,
  currency = "USD",
  legs: controlledLegs,
  onLegsChange,
}: {
  ticker: string;
  contracts: OptionQuote[];
  selectedExpiry: string | null;
  spot: number | null;
  currency?: string;
  /** Hand-built legs, when the parent owns them (the chain adds legs by click). */
  legs?: ManualLeg[];
  onLegsChange?: (legs: ManualLeg[]) => void;
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
  const selected = candidates.find((c) => c.key === selectedKey) ?? candidates[0] ?? null;

  // ── Hand-built legs ────────────────────────────────────────────────────────
  const [ownLegs, setOwnLegs] = useState<ManualLeg[]>([]);
  const legs = controlledLegs ?? ownLegs;
  const setLegs = (next: ManualLeg[]) => (onLegsChange ? onLegsChange(next) : setOwnLegs(next));
  const nextId = legs.reduce((mx, l) => Math.max(mx, l.id), 0) + 1;
  const sig = legsSig(legs);
  // Picking a suggestion puts it in focus until the hand-built legs change again.
  const [suggestedAtSig, setSuggestedAtSig] = useState<string | null>(null);
  const [template, setTemplate] = useState<{ key: TemplateKey; sig: string } | null>(null);

  const strikes = useMemo(
    () => Array.from(new Set(expiryContracts.map((c) => c.strike))).sort((a, b) => a - b),
    [expiryContracts],
  );
  const atmStrike = useMemo(
    () =>
      spot == null
        ? (strikes[0] ?? 0)
        : strikes.reduce((b, s) => (Math.abs(s - spot) < Math.abs(b - spot) ? s : b), strikes[0] ?? spot),
    [strikes, spot],
  );

  function addLeg() {
    setLegs([...legs, { id: nextId, right: "call", strike: atmStrike, contracts: 1 }]);
  }
  // Drop in a named strategy (bull-call, iron condor, …), replacing the legs with
  // strikes chosen off the live grid relative to spot.
  function applyTemplate(key: TemplateKey) {
    if (spot == null) return;
    const specs = buildTemplate(key, strikes, spot);
    if (!specs) return;
    let id = nextId;
    const next = specs.map((s) => ({ id: id++, right: s.right, strike: s.strike, contracts: s.contracts }));
    setLegs(next);
    setTemplate({ key, sig: legsSig(next) });
  }
  function update(id: number, patch: Partial<ManualLeg>) {
    setLegs(legs.map((leg) => (leg.id === id ? { ...leg, ...patch } : leg)));
  }
  function remove(id: number) {
    setLegs(legs.filter((leg) => leg.id !== id));
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

  const midFor = (leg: ManualLeg): number | null => {
    const q = leg.right === "call" ? at.get(leg.strike)?.call : at.get(leg.strike)?.put;
    return q && spot != null ? midQuote(q, spot, T) : null;
  };

  const built = useMemo(() => {
    if (spot == null || sigma == null || !selectedExpiry) return null;
    const payoffLegs: PayoffLeg[] = [];
    for (const leg of legs) {
      const q = leg.right === "call" ? at.get(leg.strike)?.call : at.get(leg.strike)?.put;
      if (!q || leg.contracts === 0) continue;
      const mid = midQuote(q, spot, T);
      if (mid == null) continue;
      const quantity = leg.contracts * CONTRACT_SIZE;
      payoffLegs.push({
        parsed: {
          occ: `${ticker}${selectedExpiry}${leg.right}${leg.strike}`,
          underlying: ticker,
          expiry: selectedExpiry,
          right: leg.right,
          strike: leg.strike,
        },
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
  }, [legs, at, spot, sigma, T, ticker, selectedExpiry, expiryContracts]);

  const canModel = spot != null && sigma != null && selectedExpiry != null;

  if (!canModel) {
    return (
      <section aria-label="Strategy builder" className="space-y-3">
        <DeskHead
          title="Build a strategy"
          sub={selectedExpiry ? `${formatOptionExpiry(selectedExpiry)} · ${dte}d` : undefined}
        />
        <DeskNote className="border-t-0 pt-0">
          Need a live spot price and implied vol on the selected expiry to model strategies. Pick an
          expiry with quoted options above.
        </DeskNote>
      </section>
    );
  }

  // What the hand-built legs amount to, in the desk's own vocabulary.
  const customName = (() => {
    if (!built) return null;
    const structures = classifyOptionLegs(built.payoffLegs);
    return structures.length === 1 ? structures[0].label : "Custom position";
  })();

  const showCustom = built != null && suggestedAtSig !== sig;
  const focus: Focus | null = showCustom
    ? {
        title: customName ?? "Custom position",
        legs: built.payoffLegs,
        analysis: built.analysis,
        pop: built.pop,
        capital: built.capital,
        netDebit: built.analysis.netDebit,
      }
    : selected
      ? {
          title: selected.name,
          legs: selected.payoffLegs,
          analysis: selected.analysis,
          pop: selected.pop,
          capital: selected.capital,
          netDebit: selected.netDebit,
        }
      : null;

  return (
    <section aria-label="Strategy builder" className="grid gap-x-12 gap-y-9 lg:grid-cols-5">
      <div className="min-w-0 space-y-5 lg:col-span-3">
        <div>
          <DeskHead
            title="Build a strategy"
            sub={
              <>
                {legs.length > 0
                  ? `${customName ?? "Unpriced"} · ${legs.length} ${legs.length === 1 ? "leg" : "legs"} · `
                  : ""}
                {formatOptionExpiry(selectedExpiry!)} · {dte}d
              </>
            }
            action={
              <button type="button" onClick={addLeg} className={pill}>
                <Plus size={14} />
                Add leg
              </button>
            }
          />
          {legs.length === 0 ? (
            <p className="border-b border-line py-4 text-sm text-[var(--muted)]">
              Add legs from the {formatOptionExpiry(selectedExpiry!)} chain — click a bid or ask
              above, start from a strategy below, or use Add leg — to sketch any position and see
              its payoff and safety.
            </p>
          ) : (
            legs.map((leg) => {
              const mid = midFor(leg);
              const long = leg.contracts >= 0;
              const n = Math.abs(leg.contracts);
              return (
                <div
                  key={leg.id}
                  className="mono flex flex-wrap items-center gap-2 border-b border-line py-2 text-[13px]"
                >
                  <Segmented
                    label="Side"
                    value={long ? "long" : "short"}
                    onChange={(v) =>
                      update(leg.id, { contracts: (v === "long" ? 1 : -1) * Math.abs(leg.contracts || 1) })
                    }
                    options={[
                      { value: "long", label: "Long" },
                      { value: "short", label: "Short" },
                    ]}
                  />
                  <select
                    aria-label="Type"
                    value={leg.right}
                    onChange={(e) => update(leg.id, { right: e.target.value as "call" | "put" })}
                    className={fieldCls}
                  >
                    <option value="call">Call</option>
                    <option value="put">Put</option>
                  </select>
                  <select
                    aria-label="Strike"
                    value={leg.strike}
                    onChange={(e) => update(leg.id, { strike: Number(e.target.value) })}
                    className={fieldCls}
                  >
                    {strikes.map((s) => (
                      <option key={s} value={s}>
                        {formatStrike(s)}
                      </option>
                    ))}
                  </select>
                  <span className="px-1 text-[var(--muted)]">{formatOptionExpiry(selectedExpiry!)}</span>
                  <label className="inline-flex items-center gap-1.5 text-[var(--muted)]">
                    <input
                      type="number"
                      min={1}
                      aria-label="Contracts"
                      value={n}
                      onChange={(e) =>
                        update(leg.id, {
                          contracts: Math.sign(leg.contracts || 1) * Math.max(1, Number(e.target.value)),
                        })
                      }
                      className={`${fieldCls} w-16`}
                    />
                    {n === 1 ? "contract" : "contracts"}
                  </label>
                  <span className="grow text-right text-[var(--muted)]">
                    {mid != null ? `${mid.toFixed(2)} mid` : "no quote"}
                  </span>
                  <button
                    type="button"
                    onClick={() => remove(leg.id)}
                    className="grid h-10 w-10 place-items-center rounded-full text-[var(--muted)] transition-colors hover:text-[var(--coral)]"
                    aria-label="Remove leg"
                  >
                    <X size={16} />
                  </button>
                </div>
              );
            })
          )}
        </div>

        {/* One-click strategy templates — build a structure off the live grid */}
        <div className="space-y-2">
          <p className="text-xs text-[var(--muted)]">Start from a strategy</p>
          <div className="flex flex-wrap gap-1.5">
            {STRATEGY_TEMPLATES.map((t) => (
              <ChoicePill
                key={t.key}
                mono={false}
                on={template?.key === t.key && template.sig === sig}
                disabled={buildTemplate(t.key, strikes, spot!) == null}
                onClick={() => applyTemplate(t.key)}
                title={t.note}
              >
                {t.label}
              </ChoicePill>
            ))}
          </div>
        </div>

        {focus ? (
          <PayoffBlock
            // Remount per position so the days slider and view start fresh.
            key={showCustom ? "custom" : `s:${selected?.key}`}
            focus={focus}
            expiryContracts={expiryContracts}
            spot={spot!}
            sigma={sigma!}
            T={T}
            currency={currency}
          />
        ) : (
          <p className="text-sm text-[var(--muted)]">
            Nothing to chart yet — add a leg or pick a suggestion.
          </p>
        )}
      </div>

      <div className="min-w-0 space-y-7 lg:col-span-2">
        {focus && (
          <SafetyList
            focus={focus}
            expiryContracts={expiryContracts}
            spot={spot!}
            sigma={sigma!}
            T={T}
            currency={currency}
          />
        )}

        <div>
          <DeskHead title="Or have one suggested" />
          <div className="flex flex-col gap-2.5 border-b border-line py-3">
            <Segmented
              label="Outlook"
              className="self-start"
              value={bias}
              onChange={(v) => {
                setBias(v);
                setTargetOverride(null);
              }}
              options={BIASES}
            />
            <Segmented
              label="Risk profile"
              className="self-start"
              value={preset}
              onChange={applyPreset}
              options={(Object.keys(PRESETS) as PresetKey[]).map((k) => ({ value: k, label: PRESETS[k].label }))}
            />
            <div className="flex flex-wrap items-end gap-3">
              <NumberField
                label={bias === "neutral" ? "Pin price" : bias === "volatile" ? "Center" : "Price target"}
                value={target}
                onChange={setTargetOverride}
                step={0.5}
                nullable
              />
              <NumberField label="Capital budget" value={budget} onChange={(v) => setBudget(v ?? 0)} currency={currency} />
              <NumberField label="Max loss" value={maxLoss} onChange={(v) => setMaxLoss(v ?? 0)} currency={currency} />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs text-[var(--muted)]">
              <label className="flex min-h-9 cursor-pointer items-center gap-2 text-[13px]">
                <input
                  type="checkbox"
                  checked={definedOnly}
                  onChange={(e) => setDefinedOnly(e.target.checked)}
                  className="h-4 w-4 accent-[var(--jade)]"
                />
                Defined risk only
              </label>
              {em != null && (
                <span className="mono">
                  ±1σ {formatCurrency(em, currency)} · spot {formatStrike(Number(spot!.toFixed(2)))}
                </span>
              )}
            </div>
          </div>

          {candidates.length === 0 ? (
            <p className="py-4 text-sm text-[var(--muted)]">
              No priceable strategies for this view on {formatOptionExpiry(selectedExpiry!)} — the
              chain may be missing quotes near your target. Try another expiry or widen your budget.
            </p>
          ) : (
            <div className={ruled.scroll}>
              <table className="w-full min-w-[420px] text-[13px]">
                <thead>
                  <tr className="text-left">
                    {["Candidate", "Fit", "Max P", "Max L", "POP", "R:R"].map((h, i) => (
                      <th
                        key={h}
                        className={`py-2.5 pr-3 text-xs font-normal text-[var(--muted)] last:pr-0 ${i ? "text-right" : ""}`}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {candidates.map((c) => (
                    <CandidateRow
                      key={c.key}
                      c={c}
                      active={!showCustom && selected?.key === c.key}
                      currency={currency}
                      onSelect={() => {
                        setSelectedKey(c.key);
                        setSuggestedAtSig(sig);
                      }}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

// ── Suggested candidate row ──────────────────────────────────────────────────

function CandidateRow({
  c,
  active,
  currency,
  onSelect,
}: {
  c: StrategyCandidate;
  active: boolean;
  currency: string;
  onSelect: () => void;
}) {
  const rr = c.analysis.maxProfitUnbounded
    ? "∞"
    : c.analysis.maxProfit != null && c.analysis.maxLoss != null && c.analysis.maxLoss > 0
      ? `${(c.analysis.maxProfit / c.analysis.maxLoss).toFixed(2)}×`
      : "—";
  const cell = "mono py-2.5 pr-3 text-right align-top last:pr-0";
  return (
    <tr
      onClick={onSelect}
      aria-selected={active}
      className={`cursor-pointer border-t border-line transition-colors ${
        active ? "bg-[var(--panel)]" : "hover:bg-[var(--panel)]/60"
      }`}
    >
      <td className="py-2.5 pr-3 align-top">
        <button type="button" onClick={onSelect} className="text-left">
          <span className={active ? "text-[var(--brass)]" : "text-[var(--paper)]"}>{c.name}</span>
          {!c.withinBudget && (
            <span className="ml-2 rounded-full border border-[var(--coral)]/40 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-[var(--coral)]">
              over budget
            </span>
          )}
          <span className="mono block text-xs text-[var(--muted)]">{c.summary}</span>
          <span className="mono block text-xs text-[var(--muted)]">
            {c.netDebit >= 0 ? "Debit" : "Credit"} {compact(Math.abs(c.netDebit), currency)} · capital{" "}
            {compact(c.capital, currency)} · EV{" "}
            <span className={c.ev != null && c.ev >= 0 ? "text-[var(--jade)]" : "text-[var(--coral)]"}>
              {c.ev != null ? `${c.ev >= 0 ? "+" : "−"}${compact(Math.abs(c.ev), currency)}` : "—"}
            </span>
          </span>
        </button>
      </td>
      <td className={cell} title="How well this fits your view and risk inputs, 0–100">
        {Math.round(c.fit * 100)}
      </td>
      <td className={`${cell} text-[var(--jade)]`}>
        {c.analysis.maxProfitUnbounded
          ? "∞"
          : c.analysis.maxProfit != null
            ? compact(c.analysis.maxProfit, currency)
            : "—"}
      </td>
      <td className={`${cell} text-[var(--coral)]`}>
        {c.analysis.maxLossUnbounded
          ? "∞"
          : c.analysis.maxLoss != null
            ? compact(c.analysis.maxLoss, currency)
            : "—"}
      </td>
      <td className={cell}>{c.pop != null ? `${Math.round(c.pop * 100)}%` : "—"}</td>
      <td className={cell}>{rr}</td>
    </tr>
  );
}

// ── Payoff: today and at expiry, or the price × date heatmap ────────────────

function PayoffBlock({
  focus,
  expiryContracts,
  spot,
  sigma,
  T,
  currency,
}: {
  focus: Focus;
  expiryContracts: OptionQuote[];
  spot: number;
  sigma: number;
  T: number;
  currency: string;
}) {
  const ct = useChartTheme();
  const { legs, analysis, capital } = focus;
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

  // ── OptionStrat-style time dimension: value the position before expiry ──
  const dte = Math.max(0, Math.round(T * 365));
  const [daysFromNow, setDaysFromNow] = useState(0);
  const dNow = Math.min(daysFromNow, dte);
  const [view, setView] = useState<PayoffView>("payoff");

  // Per-leg implied vol (own IV, ATM fallback) — stable for the memos below.
  const sigmaFor: SigmaFor = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of expiryContracts) {
      if (c.iv != null && c.iv > 0) m.set(`${c.right}:${c.strike}`, c.iv);
    }
    return (leg) => m.get(`${leg.parsed.right}:${leg.parsed.strike}`) ?? sigma;
  }, [expiryContracts, sigma]);

  const domain = useMemo(() => payoffCurve(legs, { center: spot }), [legs, spot]);
  const theoFn = useMemo(() => {
    const Tnow = Math.max(0, dte - dNow) / 365;
    return (S: number) => positionPnl(legs, S, Tnow, sigmaFor);
  }, [legs, dte, dNow, sigmaFor]);
  const matrix = useMemo(
    () => pnlMatrix(legs, { min: domain.min, max: domain.max, dte, sigmaFor }),
    [legs, domain.min, domain.max, dte, sigmaFor],
  );
  const hasMatrix = dte > 0 && matrix.maxAbs > 0;
  const shown: PayoffView = hasMatrix ? view : "payoff";

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-xs text-[var(--muted)]">
          {shown === "payoff" ? "Payoff · today and at expiry" : "P&L over time · price × date"}
        </span>
        <div className="flex flex-wrap items-center gap-3 text-[13px] text-[var(--muted)]">
          {dte > 0 && shown === "payoff" && (
            <label className="inline-flex items-center gap-2">
              Days from now
              <input
                type="range"
                min={0}
                max={dte}
                value={dNow}
                onChange={(e) => setDaysFromNow(Number(e.target.value))}
                className="w-28 accent-[var(--brass)]"
              />
            </label>
          )}
          {hasMatrix && (
            <Segmented
              label="View"
              value={shown}
              onChange={setView}
              options={[
                { value: "payoff", label: "Payoff" },
                { value: "pnl", label: "Heatmap P/L ($)" },
                { value: "pct", label: "P/L (%)" },
              ]}
            />
          )}
        </div>
      </div>

      {shown === "payoff" ? (
        <>
          <PayoffDiagram
            legs={legs}
            currentPrice={spot}
            breakevens={analysis.breakevens}
            theoFn={dte > 0 ? theoFn : null}
            currency={currency}
          />
          {dte > 0 && (
            <div className="flex items-center justify-between text-xs text-[var(--muted)]">
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block w-4 border-t-2 border-dashed border-[var(--brass)]" />
                Value {dNow <= 0 ? "now" : dNow >= dte ? "at expiry" : `in ${dNow}d`}
              </span>
              <span>solid = expiry</span>
            </div>
          )}
        </>
      ) : (
        <>
          <PnlMatrix
            matrix={matrix}
            dte={dte}
            spot={spot}
            breakevens={analysis.breakevens}
            currency={currency}
            mode={shown}
            capital={capital}
          />
          <div className="flex items-center gap-4 text-xs text-[var(--muted)]">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm bg-[color-mix(in_srgb,var(--jade)_55%,transparent)]" />
              profit
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm bg-[color-mix(in_srgb,var(--coral)_55%,transparent)]" />
              loss
            </span>
          </div>
        </>
      )}

      <p className="pt-3 text-xs text-[var(--muted)]">P&amp;L distribution at expiry</p>
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
  );
}

// ── Safety: the numbers for the position in focus ────────────────────────────

function SafetyList({
  focus,
  expiryContracts,
  spot,
  sigma,
  T,
  currency,
}: {
  focus: Focus;
  expiryContracts: OptionQuote[];
  spot: number;
  sigma: number;
  T: number;
  currency: string;
}) {
  const { legs, analysis, pop, capital, netDebit } = focus;
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
    <div>
      <DeskHead title={`${focus.title} · safety`} />
      <FigureRow label="Probability of profit" tone="jade">
        {pop != null ? `${(pop * 100).toFixed(0)}%` : "—"}
      </FigureRow>
      <FigureRow label="Expected value" tone={dist && dist.ev >= 0 ? "jade" : "coral"}>
        {dist ? `${dist.ev >= 0 ? "+" : "−"}${formatCurrency(Math.abs(dist.ev), currency)}` : "—"}
      </FigureRow>
      <FigureRow label="Chance of losing" tone="coral">
        {pMaxLoss != null ? `${(pMaxLoss * 100).toFixed(0)}%` : "—"}
      </FigureRow>
      <FigureRow label="Max loss">
        {analysis.maxLossUnbounded
          ? "Unlimited"
          : analysis.maxLoss != null
            ? `−${formatCurrency(analysis.maxLoss, currency)}`
            : "—"}
      </FigureRow>
      <FigureRow label="Capital at risk">{formatCurrency(capital, currency)}</FigureRow>
      <FigureRow label={netDebit >= 0 ? "Net debit" : "Net credit"}>
        {formatCurrency(Math.abs(netDebit), currency)}
      </FigureRow>
      <FigureRow label="Breakeven cushion">
        {cushion != null ? `${(cushion * 100).toFixed(1)}% from spot` : "—"}
      </FigureRow>
      <div className="mono flex flex-wrap gap-x-4 gap-y-1 py-3 text-[13px]">
        <GreekStat label="Net Δ" value={greeks.delta} digits={0} />
        <GreekStat label="Γ" value={greeks.gamma} digits={1} />
        <GreekStat label="Θ / day" value={greeks.theta} digits={0} money currency={currency} />
        <GreekStat label="Vega" value={greeks.vega} digits={0} money currency={currency} />
      </div>
      <p className="text-xs text-[var(--muted)]">Estimates · market-implied (lognormal).</p>
    </div>
  );
}

// ── Shared bits ──────────────────────────────────────────────────────────────

/** Net position greeks summed across legs (per-share greeks × signed shares). */
function netGreeks(legs: PayoffLeg[], expiryContracts: OptionQuote[], spot: number, sigma: number) {
  let delta = 0;
  let gamma = 0;
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
    if (g.gamma != null) gamma += g.gamma * shares;
    if (g.theta != null) theta += g.theta * shares;
    if (g.vega != null) vega += g.vega * shares;
  }
  return { delta, gamma, theta, vega };
}

function NumberField({
  label,
  value,
  onChange,
  currency = "USD",
  step,
  nullable,
}: {
  label: string;
  value: number | null;
  onChange: (v: number | null) => void;
  currency?: string;
  step?: number;
  /** An emptied field reports null (re-anchor to the default) instead of 0. */
  nullable?: boolean;
}) {
  return (
    <label className="flex min-w-[7rem] flex-1 flex-col gap-1 text-xs text-[var(--muted)]">
      {label}
      <span className="flex items-center rounded-lg border border-line bg-[var(--panel)] px-3 py-1.5">
        <span className="mono text-sm">{currency === "USD" ? "$" : ""}</span>
        <input
          type="number"
          min={0}
          step={step}
          value={value ?? ""}
          onChange={(e) =>
            onChange(
              e.target.value === ""
                ? nullable
                  ? null
                  : 0
                : nullable
                  ? Number(e.target.value)
                  : Math.max(0, Number(e.target.value)),
            )
          }
          className="mono w-full min-w-0 bg-transparent px-1 text-sm text-[var(--paper)] outline-none"
        />
      </span>
    </label>
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
    <span className="flex-1 whitespace-nowrap">
      <span className="text-[var(--muted)]">{label} </span>
      {money && currency
        ? `${value >= 0 ? "" : "−"}${formatCurrency(Math.abs(value), currency)}`
        : value.toFixed(digits)}
    </span>
  );
}

/** Compact signed currency for tight metric cells: "$1.2K". */
function compact(n: number, currency: string): string {
  const abs = Math.abs(n);
  if (abs >= 1000) return `${currency === "USD" ? "$" : ""}${(n / 1000).toFixed(1)}K`;
  return formatCurrency(n, currency);
}
