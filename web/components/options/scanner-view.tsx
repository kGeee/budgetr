"use client";

/**
 * Wheel scanner — a research desk for cash-secured puts. Ranked candidates
 * across a liquid universe with an explicit trade plan (entry / stop / dollars
 * at risk), client-side refine + sort, and a per-row payoff drawer. The heavy
 * lifting (chains, IV rank, earnings, scoring) is done server-side in
 * lib/wheel-scanner*.ts; this only presents and filters what came back.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronDown, AlertTriangle } from "lucide-react";
import { Hero, Mark } from "@/components/ui/statement";
import { HeroLine, pill, ruled, RuledFooter, SideFigure } from "@/components/portfolio/ruled";
import { scanVerdict } from "@/lib/investments-verdict";
import { PayoffDiagram } from "@/components/options/payoff-diagram";
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
  const verdict = scanVerdict({
    universe: result.universe.length,
    best: best && { ...best, strike: formatStrike(best.strike) },
  });

  // The headline is the richest yield on offer; `best` (top score) is the pick
  // the sentence recommends. They are often, but not always, the same contract.
  const topYield = result.candidates.reduce<PutCandidate | null>(
    (top, c) => (top == null || c.annualizedPct > top.annualizedPct ? c : top),
    null,
  );
  const total = result.candidates.length;

  return (
    <div className="space-y-9">
      <section aria-label="Scan summary">
        <HeroLine
          hero={
            <Hero
              eyebrow={topYield ? `Top annualized · ${topYield.ticker}` : "Top annualized"}
              figure={topYield ? `${topYield.annualizedPct.toFixed(1)}%` : "—"}
              verdict={
                <>
                  {verdict.lead}
                  {verdict.pick && (
                    <>
                      {" "}
                      <Mark tone={verdict.tone}>{verdict.pick}</Mark> {verdict.tail}
                    </>
                  )}
                </>
              }
            />
          }
        >
          <SideFigure label="Universe" value={String(result.universe.length)} sub={`${result.scanned} with chains`} />
          <SideFigure label="Candidates" value={String(total)} sub="ranked" />
          <SideFigure
            label="Top score"
            tone="brass"
            value={best ? String(best.score) : "—"}
            sub={best ? `${best.ticker} ${formatStrike(best.strike)}p` : undefined}
          />
          <SideFigure
            label="Scan window"
            value={`${result.criteria.dteMin}–${result.criteria.dteMax}d`}
            sub={`Δ ${result.criteria.deltaMin}–${result.criteria.deltaMax}`}
          />
        </HeroLine>
      </section>

      {/* Filters: one ruled control row, straight on the canvas. */}
      <section
        aria-label="Filters"
        className="flex flex-wrap items-end gap-x-7 gap-y-4 border-y border-line py-4"
      >
        <Field label="Ticker">
          <input
            value={filters.q}
            onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))}
            placeholder="all"
            className="mono min-h-10 w-28 rounded-full border border-[var(--line-strong)] bg-transparent px-4 text-sm text-[var(--paper)] outline-none placeholder:text-[var(--muted)] focus:border-[var(--brass-dim)]"
          />
        </Field>
        <Slider label="Min annualized" value={filters.minAnnualized} min={0} max={60} step={2} suffix="%" onChange={(v) => setFilters((f) => ({ ...f, minAnnualized: v }))} />
        <Slider label="Max Δ" value={filters.maxDelta} min={0.05} max={0.5} step={0.05} onChange={(v) => setFilters((f) => ({ ...f, maxDelta: v }))} />
        <Slider label="Min OI" value={filters.minOi} min={0} max={5000} step={250} onChange={(v) => setFilters((f) => ({ ...f, minOi: v }))} />
        <label className="flex min-h-10 items-center gap-2 text-sm text-[var(--muted)]">
          <input
            type="checkbox"
            checked={filters.hideEarnings}
            onChange={(e) => setFilters((f) => ({ ...f, hideEarnings: e.target.checked }))}
            className="accent-[var(--coral)]"
          />
          Hide earnings-in-window
        </label>
        <button onClick={() => setFilters(DEFAULT_FILTERS)} className={`${pill} ml-auto`}>
          Reset
        </button>
      </section>

      {!result.earningsAvailable && (
        <p className="flex items-center gap-2 text-xs text-[var(--muted)]">
          <AlertTriangle size={13} className="text-[var(--brass)]" />
          No Finnhub key configured — earnings-risk flags are unavailable. IV rank fills in as tickers accrue snapshot history.
        </p>
      )}

      {/* Desk table */}
      <section aria-label="Candidates" className="space-y-3">
        <div className={ruled.scroll}>
          <table className={`${ruled.table} min-w-[940px]`}>
            <thead>
              <tr className={`${ruled.headRow} align-bottom`}>
                <th className="pb-2.5 pr-5 text-left font-normal">
                  <h2 className="font-display text-lg tracking-tight text-[var(--paper)]">
                    Candidates
                    <span className="mono ml-2 text-xs font-normal text-[var(--muted)]">
                      {rows.length === total ? total : `${rows.length} of ${total}`} · sell 1 contract each
                    </span>
                  </h2>
                </th>
                <Th sortKey="dte" sort={sort} setSort={setSort}>DTE</Th>
                <Th>Δ</Th>
                <Th>Credit</Th>
                <Th sortKey="annualizedPct" sort={sort} setSort={setSort}>Ann.</Th>
                <Th sortKey="ivRank" sort={sort} setSort={setSort}>IV rk</Th>
                <Th sortKey="pop" sort={sort} setSort={setSort}>PoP</Th>
                <Th sortKey="cushionPct" sort={sort} setSort={setSort}>Cushion</Th>
                <Th>Entry</Th>
                <Th>Stop</Th>
                <Th sortKey="maxAtRisk" sort={sort} setSort={setSort}>At risk</Th>
                <Th sortKey="score" sort={sort} setSort={setSort}>Score</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <CandidateRow key={c.occ} c={c} open={open === c.occ} onToggle={() => setOpen(open === c.occ ? null : c.occ)} />
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={12} className="py-10 text-center text-sm text-[var(--muted)]">
                    No candidates match. Loosen the filters, or the universe chains may be unavailable right now.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <RuledFooter
          className="border-t-0 pt-0"
          note={
            <>
              Credit, Entry and Stop are per share; one contract is 100 shares. PoP is approximately
              1 − Δ. Stop is the buy-to-close price at {result.criteria.stopMultiple}× credit.
              Cash-secured puts, {result.criteria.dteMin}–{result.criteria.dteMax} DTE, Δ{" "}
              {result.criteria.deltaMin}–{result.criteria.deltaMax}, ≥
              {result.criteria.minAnnualizedPct}% annualized, OI ≥ {result.criteria.minOpenInterest}.
              Prices are ~15m delayed; estimates only, not advice.
            </>
          }
        />
      </section>
    </div>
  );
}

function CandidateRow({ c, open, onToggle }: { c: PutCandidate; open: boolean; onToggle: () => void }) {
  const parsed = parseOccSymbol(c.occ);
  const chainHref = `/investments/options/chain?ticker=${encodeURIComponent(c.ticker)}`;
  return (
    <>
      <tr
        onClick={onToggle}
        className={`cursor-pointer transition-colors hover:bg-[var(--panel-2)]/40 ${open ? "" : ruled.row}`}
      >
        <td className={ruled.td}>
          <button
            type="button"
            aria-expanded={open}
            onClick={(e) => {
              e.stopPropagation();
              onToggle();
            }}
            className="flex items-center gap-3 text-left"
          >
            <ChevronDown size={14} className={`shrink-0 text-[var(--muted)] transition-transform ${open ? "rotate-180" : ""}`} />
            <span className="mono min-w-12 font-medium text-[var(--paper)]">{c.ticker}</span>
            <span className="whitespace-nowrap text-[13px] text-[var(--muted)]">
              {formatStrike(c.strike)} put · {formatOptionExpiry(c.expiry)}
            </span>
            {c.earningsInWindow && (
              <span
                title="Earnings before expiry"
                className="text-[11px] font-medium uppercase tracking-wide text-[var(--coral)]"
              >
                ER
              </span>
            )}
          </button>
        </td>
        <Td>{c.dte}</Td>
        <Td>{c.delta != null ? c.delta.toFixed(2) : "—"}</Td>
        <Td>{money2(c.credit)}</Td>
        <Td className="text-[var(--jade)]">{pct(c.annualizedPct, 0)}</Td>
        <Td>{c.ivRank != null ? c.ivRank.toFixed(0) : "—"}</Td>
        <Td>{c.pop != null ? `${(c.pop * 100).toFixed(0)}%` : "—"}</Td>
        <Td>{pct(c.cushionPct, 1)}</Td>
        <Td>{money2(c.entry)}</Td>
        <Td className="text-[var(--coral)]">{money2(c.stop)}</Td>
        <Td>{money(c.maxAtRisk)}</Td>
        <td className={`${ruled.td} text-right`}>
          <ScorePill score={c.score} />
        </td>
      </tr>
      {open && (
        <tr className={ruled.row}>
          <td colSpan={12} className="pb-6 pl-7 pt-1">
            <div className="grid gap-x-10 gap-y-6 lg:grid-cols-[minmax(0,1fr)_320px]">
              <div>
                <dl className="grid grid-cols-2 gap-x-8 sm:grid-cols-3 lg:grid-cols-4">
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
                </dl>
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-[13px]">
                  <span>
                    <span className="text-[var(--muted)]">Trade </span>
                    Sell 1 {c.ticker} {formatStrike(c.strike)} put · {formatOptionExpiry(c.expiry)}
                    <span className={c.earningsInWindow ? "text-[var(--coral)]" : "text-[var(--muted)]"}>
                      {" · Earnings: "}
                      {c.earningsDate
                        ? `${c.earningsDate}${c.earningsInWindow ? " — before expiry" : ""}`
                        : "none in window"}
                    </span>
                  </span>
                  <span className="flex flex-wrap gap-2" onClick={(e) => e.stopPropagation()}>
                    <Link href={chainHref} className={pill}>
                      Open {c.ticker} chain
                    </Link>
                    <Link href={`${chainHref}&mode=vol`} className={pill}>
                      Fixed-strike vol
                    </Link>
                  </span>
                </div>
              </div>
              {parsed && (
                <div>
                  <p className="mb-2 text-xs text-[var(--muted)]">Payoff at expiry</p>
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
  const cls =
    score >= 70 ? "text-[var(--jade)]" : score >= 45 ? "text-[var(--brass)]" : "text-[var(--muted)]";
  return <span className={`mono font-medium tabular ${cls}`}>{score}</span>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5 text-[13px] text-[var(--muted)]">
      {label}
      {children}
    </label>
  );
}

function Slider({ label, value, min, max, step, suffix = "", onChange }: { label: string; value: number; min: number; max: number; step: number; suffix?: string; onChange: (v: number) => void }) {
  return (
    <label className="flex min-w-36 flex-col gap-1.5 text-[13px] text-[var(--muted)]">
      <span className="flex items-baseline justify-between gap-3">
        <span>{label}</span>
        <span className="mono text-[var(--paper)]">{value.toLocaleString()}{suffix}</span>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="h-6 w-full accent-[var(--brass)]" />
    </label>
  );
}

/** Figure-column header; sortable ones are real buttons and say which way they sort. */
function Th({ children, sortKey, sort, setSort }: { children: React.ReactNode; sortKey?: SortKey; sort?: SortKey; setSort?: (k: SortKey) => void }) {
  const active = sortKey != null && sort === sortKey;
  return (
    <th className={`${ruled.th} text-right`} aria-sort={active ? "descending" : undefined}>
      {sortKey && setSort ? (
        <button
          type="button"
          onClick={() => setSort(sortKey)}
          className={`transition-colors hover:text-[var(--paper)] ${active ? "text-[var(--paper)]" : ""}`}
        >
          {children}
          {active ? " ↓" : ""}
        </button>
      ) : (
        children
      )}
    </th>
  );
}

function Td({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <td className={`${ruled.td} ${ruled.num} ${className}`}>{children}</td>;
}

function Detail({ label, value, accent }: { label: string; value: string; accent?: "jade" | "coral" }) {
  const color = accent === "jade" ? "text-[var(--jade)]" : accent === "coral" ? "text-[var(--coral)]" : "text-[var(--paper)]";
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-line py-2.5">
      <dt className="text-[13px] text-[var(--muted)]">{label}</dt>
      <dd className={`mono text-right text-[13px] ${color}`}>{value}</dd>
    </div>
  );
}
