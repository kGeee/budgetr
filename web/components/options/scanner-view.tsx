"use client";

/**
 * Wheel scanner — a research desk for cash-secured puts. Ranked candidates
 * across a liquid universe with an explicit trade plan (entry / stop / dollars
 * at risk), client-side refine + sort, and a per-row payoff drawer. The heavy
 * lifting (chains, IV rank, earnings, scoring) is done server-side in
 * lib/wheel-scanner*.ts; this only presents and filters what came back.
 */

import { useMemo, useState } from "react";
import { ChevronDown, TrendingUp, AlertTriangle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { PayoffDiagram } from "@/components/payoff-diagram";
import { formatCurrency } from "@/lib/utils";
import { formatOptionExpiry, formatStrike, parseOccSymbol } from "@/lib/options";
import type { PutCandidate } from "@/lib/wheel-scanner";
import type { ScanResult } from "@/lib/wheel-scanner-data";

const money = (n: number) => formatCurrency(n, "USD", { maximumFractionDigits: 0 });
const money2 = (n: number) => formatCurrency(n, "USD", { maximumFractionDigits: 2 });
const pct = (n: number | null, d = 1) => (n == null ? "—" : `${n.toFixed(d)}%`);

type SortKey = "score" | "annualizedPct" | "ivRank" | "pop" | "cushionPct" | "dte" | "maxAtRisk";

type Filters = {
  q: string;
  minAnnualized: number;
  maxDelta: number;
  minOi: number;
  hideEarnings: boolean;
};

const DEFAULT_FILTERS: Filters = { q: "", minAnnualized: 0, maxDelta: 1, minOi: 0, hideEarnings: false };

export function ScannerView({ result }: { result: ScanResult }) {
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [sort, setSort] = useState<SortKey>("score");
  const [open, setOpen] = useState<string | null>(null);

  const rows = useMemo(() => {
    const q = filters.q.trim().toUpperCase();
    const filtered = result.candidates.filter((c) => {
      if (q && !c.ticker.includes(q)) return false;
      if (c.annualizedPct < filters.minAnnualized) return false;
      if (c.delta != null && c.delta > filters.maxDelta) return false;
      if ((c.openInterest ?? 0) < filters.minOi) return false;
      if (filters.hideEarnings && c.earningsInWindow) return false;
      return true;
    });
    const val = (c: PutCandidate): number => {
      const v = c[sort];
      return typeof v === "number" ? v : -Infinity;
    };
    return [...filtered].sort((a, b) => val(b) - val(a));
  }, [result.candidates, filters, sort]);

  const best = result.candidates[0];

  return (
    <div className="space-y-6">
      {/* KPI band */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5">
        <Kpi label="Universe" value={String(result.universe.length)} sub={`${result.scanned} with chains`} />
        <Kpi label="Candidates" value={String(result.candidates.length)} sub="ranked" />
        <Kpi label="Top annualized" value={best ? pct(best.annualizedPct, 0) : "—"} sub={best?.ticker} accent="jade" />
        <Kpi label="Top score" value={best ? String(best.score) : "—"} sub={best ? `${best.ticker} ${formatStrike(best.strike)}p` : undefined} accent="brass" />
        <Kpi
          label="Scan window"
          value={`${result.criteria.dteMin}–${result.criteria.dteMax}d`}
          sub={`Δ ${result.criteria.deltaMin}–${result.criteria.deltaMax}`}
        />
      </div>

      {/* Filters */}
      <Card className="p-4">
        <div className="flex flex-wrap items-end gap-4">
          <Field label="Ticker">
            <input
              value={filters.q}
              onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))}
              placeholder="all"
              className="w-24 rounded-md border border-line bg-[var(--panel-2)] px-2 py-1 text-sm text-[var(--paper)] outline-none focus:border-[var(--brass-dim)]"
            />
          </Field>
          <Slider label="Min annualized" value={filters.minAnnualized} min={0} max={60} step={2} suffix="%" onChange={(v) => setFilters((f) => ({ ...f, minAnnualized: v }))} />
          <Slider label="Max Δ" value={filters.maxDelta} min={0.05} max={0.5} step={0.05} onChange={(v) => setFilters((f) => ({ ...f, maxDelta: v }))} />
          <Slider label="Min OI" value={filters.minOi} min={0} max={5000} step={250} onChange={(v) => setFilters((f) => ({ ...f, minOi: v }))} />
          <label className="flex items-center gap-2 text-sm text-[var(--muted)]">
            <input
              type="checkbox"
              checked={filters.hideEarnings}
              onChange={(e) => setFilters((f) => ({ ...f, hideEarnings: e.target.checked }))}
              className="accent-[var(--coral)]"
            />
            Hide earnings-in-window
          </label>
          <button
            onClick={() => setFilters(DEFAULT_FILTERS)}
            className="ml-auto text-xs text-[var(--muted)] underline-offset-2 hover:text-[var(--paper)] hover:underline"
          >
            Reset
          </button>
        </div>
      </Card>

      {!result.earningsAvailable && (
        <p className="flex items-center gap-2 text-xs text-[var(--muted)]">
          <AlertTriangle size={13} className="text-[var(--brass)]" />
          No Finnhub key configured — earnings-risk flags are unavailable. IV rank fills in as tickers accrue snapshot history.
        </p>
      )}

      {/* Desk table */}
      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[880px] text-sm">
            <thead>
              <tr className="border-b border-line text-[11px] uppercase tracking-wide text-[var(--muted)]">
                <Th>Contract</Th>
                <Th sortKey="dte" sort={sort} setSort={setSort} align="right">DTE</Th>
                <Th align="right">Δ</Th>
                <Th align="right">Credit</Th>
                <Th sortKey="annualizedPct" sort={sort} setSort={setSort} align="right">Ann.</Th>
                <Th sortKey="ivRank" sort={sort} setSort={setSort} align="right">IV rk</Th>
                <Th sortKey="pop" sort={sort} setSort={setSort} align="right">PoP</Th>
                <Th sortKey="cushionPct" sort={sort} setSort={setSort} align="right">Cushion</Th>
                <Th align="right">Entry</Th>
                <Th align="right">Stop</Th>
                <Th sortKey="maxAtRisk" sort={sort} setSort={setSort} align="right">At risk</Th>
                <Th sortKey="score" sort={sort} setSort={setSort} align="right">Score</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <CandidateRow key={c.occ} c={c} open={open === c.occ} onToggle={() => setOpen(open === c.occ ? null : c.occ)} />
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={12} className="px-6 py-10 text-center text-sm text-[var(--muted)]">
                    No candidates match. Loosen the filters, or the universe chains may be unavailable right now.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <p className="text-xs text-[var(--muted)]">
        Cash-secured puts, {result.criteria.dteMin}–{result.criteria.dteMax} DTE, Δ {result.criteria.deltaMin}–
        {result.criteria.deltaMax}, ≥{result.criteria.minAnnualizedPct}% annualized, OI ≥ {result.criteria.minOpenInterest}. Stop =
        buy-to-close at {result.criteria.stopMultiple}× credit. Prices are ~15m delayed; estimates only, not advice.
      </p>
    </div>
  );
}

function CandidateRow({ c, open, onToggle }: { c: PutCandidate; open: boolean; onToggle: () => void }) {
  const parsed = parseOccSymbol(c.occ);
  return (
    <>
      <tr onClick={onToggle} className="cursor-pointer border-b border-line/60 transition-colors hover:bg-[var(--panel-2)]/40">
        <td className="px-4 py-3">
          <div className="flex items-center gap-2">
            <ChevronDown size={14} className={`text-[var(--muted)] transition-transform ${open ? "rotate-180" : ""}`} />
            <div>
              <div className="font-medium text-[var(--paper)]">
                {c.ticker} <span className="text-[var(--muted)]">{formatStrike(c.strike)}p</span>
              </div>
              <div className="text-xs text-[var(--muted)]">
                {formatOptionExpiry(c.expiry)}
                {c.earningsInWindow && <span className="ml-1.5 rounded bg-[var(--coral)]/15 px-1 py-0.5 text-[10px] font-medium text-[var(--coral)]">ER</span>}
              </div>
            </div>
          </div>
        </td>
        <Td>{c.dte}</Td>
        <Td>{c.delta != null ? c.delta.toFixed(2) : "—"}</Td>
        <Td>{money2(c.credit)}</Td>
        <Td className="font-medium text-[var(--jade)]">{pct(c.annualizedPct, 0)}</Td>
        <Td>{c.ivRank != null ? c.ivRank.toFixed(0) : "—"}</Td>
        <Td>{c.pop != null ? `${(c.pop * 100).toFixed(0)}%` : "—"}</Td>
        <Td>{pct(c.cushionPct, 1)}</Td>
        <Td>{money2(c.entry)}</Td>
        <Td className="text-[var(--coral)]">{money2(c.stop)}</Td>
        <Td>{money(c.maxAtRisk)}</Td>
        <td className="px-4 py-3 text-right">
          <ScorePill score={c.score} />
        </td>
      </tr>
      {open && (
        <tr className="border-b border-line bg-[var(--panel-2)]/30">
          <td colSpan={12} className="px-6 py-5">
            <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
              <div className="grid grid-cols-2 gap-x-8 gap-y-3 sm:grid-cols-3">
                <Detail label="Trade" value={`Sell 1 ${c.ticker} ${formatStrike(c.strike)} put · ${formatOptionExpiry(c.expiry)}`} span />
                <Detail label="Entry (limit)" value={`${money2(c.entry)} credit`} accent="jade" />
                <Detail label="Stop (BTC)" value={money2(c.stop)} accent="coral" />
                <Detail label="Loss if stopped" value={`−${money(c.stopLossDollars)}`} accent="coral" />
                <Detail label="Collateral" value={money(c.collateral)} />
                <Detail label="Max at risk" value={money(c.maxAtRisk)} />
                <Detail label="Breakeven" value={formatStrike(c.breakeven)} />
                <Detail label="Credit / contract" value={money(c.creditTotal)} accent="jade" />
                <Detail label="Annualized" value={pct(c.annualizedPct, 1)} accent="jade" />
                <Detail label="PoP (≈1−Δ)" value={c.pop != null ? `${(c.pop * 100).toFixed(0)}%` : "—"} />
                <Detail label="Downside cushion" value={pct(c.cushionPct, 1)} />
                <Detail label="Liquidity" value={`OI ${c.openInterest ?? "—"} · vol ${c.volume ?? "—"}${c.spreadPct != null ? ` · ${c.spreadPct.toFixed(0)}% spr` : ""}`} />
                <Detail label="IV" value={c.iv != null ? `${(c.iv * 100).toFixed(0)}%${c.ivRank != null ? ` · rank ${c.ivRank.toFixed(0)}` : ""}` : "—"} />
                <Detail label="Earnings" value={c.earningsDate ? `${c.earningsDate}${c.earningsInWindow ? " ⚠ before expiry" : ""}` : "none in window"} accent={c.earningsInWindow ? "coral" : undefined} />
              </div>
              {parsed && (
                <div>
                  <div className="mb-2 flex items-center gap-1.5 text-xs uppercase tracking-wide text-[var(--muted)]">
                    <TrendingUp size={13} /> Payoff at expiry
                  </div>
                  <PayoffDiagram
                    legs={[{ parsed, quantity: -100, costBasis: -c.creditTotal }]}
                    currentPrice={c.spot}
                    breakevens={[c.breakeven]}
                  />
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function ScorePill({ score }: { score: number }) {
  const tone = score >= 70 ? "jade" : score >= 45 ? "brass" : "muted";
  const cls =
    tone === "jade"
      ? "bg-[var(--jade)]/12 text-[var(--jade)]"
      : tone === "brass"
        ? "bg-[var(--brass)]/15 text-[var(--brass)]"
        : "bg-[var(--panel-2)] text-[var(--muted)]";
  return <span className={`inline-block rounded-md px-2 py-0.5 text-xs font-semibold tabular-nums ${cls}`}>{score}</span>;
}

function Kpi({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: "jade" | "brass" }) {
  const color = accent === "jade" ? "text-[var(--jade)]" : accent === "brass" ? "text-[var(--brass)]" : "text-[var(--paper)]";
  return (
    <Card className="p-4">
      <div className="text-[11px] uppercase tracking-wide text-[var(--muted)]">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${color}`}>{value}</div>
      {sub && <div className="mt-0.5 truncate text-xs text-[var(--muted)]">{sub}</div>}
    </Card>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] uppercase tracking-wide text-[var(--muted)]">{label}</span>
      {children}
    </div>
  );
}

function Slider({ label, value, min, max, step, suffix = "", onChange }: { label: string; value: number; min: number; max: number; step: number; suffix?: string; onChange: (v: number) => void }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] uppercase tracking-wide text-[var(--muted)]">
        {label}: <span className="tabular-nums text-[var(--paper)]">{value}{suffix}</span>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-28 accent-[var(--brass)]" />
    </div>
  );
}

function Th({ children, sortKey, sort, setSort, align = "left" }: { children: React.ReactNode; sortKey?: SortKey; sort?: SortKey; setSort?: (k: SortKey) => void; align?: "left" | "right" }) {
  const active = sortKey && sort === sortKey;
  return (
    <th
      onClick={sortKey && setSort ? () => setSort(sortKey) : undefined}
      className={`px-4 py-2.5 font-medium ${align === "right" ? "text-right" : "text-left"} ${sortKey ? "cursor-pointer hover:text-[var(--paper)]" : ""} ${active ? "text-[var(--brass)]" : ""}`}
    >
      {children}
      {active ? " ↓" : ""}
    </th>
  );
}

function Td({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-4 py-3 text-right tabular-nums text-[var(--paper)] ${className}`}>{children}</td>;
}

function Detail({ label, value, accent, span }: { label: string; value: string; accent?: "jade" | "coral"; span?: boolean }) {
  const color = accent === "jade" ? "text-[var(--jade)]" : accent === "coral" ? "text-[var(--coral)]" : "text-[var(--paper)]";
  return (
    <div className={span ? "col-span-2 sm:col-span-3" : ""}>
      <div className="text-[11px] uppercase tracking-wide text-[var(--muted)]">{label}</div>
      <div className={`mt-0.5 text-sm font-medium ${color}`}>{value}</div>
    </div>
  );
}
