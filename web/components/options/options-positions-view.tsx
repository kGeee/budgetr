"use client";

/**
 * Options › Positions — the Options desk's landing view.
 *
 * Answers "what am I actually in?" before offering any tool: open contracts, the
 * cash a short put would need if it were assigned, what expires this week, and
 * which legs are close to the money — then every leg as one ruled table with
 * its Greeks. The selected position's payoff, the expiry calendar and the chain
 * around held strikes are the OptionsAnalytics panel, reused below.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Radar, LineChart, Activity, RotateCw } from "lucide-react";
import { Hero, Mark, SectionHead } from "@/components/ui/statement";
import { HeroLine, ruled, SideFigure } from "@/components/portfolio/ruled";
import { optionsBookVerdict } from "@/lib/investments-verdict";
import { OptionsAnalytics, type PositionFocus } from "@/components/options/options-analytics";
import { useLivePrices } from "@/components/portfolio/live-prices";
import { effectiveValue } from "@/components/portfolio/valuation";
import { formatCurrency } from "@/lib/utils";
import {
  daysToExpiry,
  formatOptionExpiry,
  formatStrike,
  isItmCall,
  isItmPut,
  optionRiskFlag,
  parseOccSymbol,
  riskLevel,
  type ParsedOption,
  type RiskLevel,
} from "@/lib/options";
import { computeGreeks, type Greeks } from "@/lib/greeks";
import { CONTRACT_SIZE } from "@/lib/payoff";
import type { HoldingRow } from "@/components/portfolio/portfolio-view";
import type { OptionQuote } from "@/lib/yahoo";

type Leg = { h: HoldingRow; p: ParsedOption; contracts: number; dte: number };

/** A leg with everything its table row prints, priced off the live chain. */
type LegFigures = Leg & {
  spot: number | null;
  quote: OptionQuote | undefined;
  iv: number | null;
  g: Pick<Greeks, "delta" | "gamma" | "theta" | "vega">;
  /** Per-share delta × shares held (holdings store ±100 per contract). */
  posDelta: number | null;
  /** Per-share daily theta × shares held: dollars of decay per day for the position. */
  posTheta: number | null;
  pnl: number | null;
};

const RISK_LABEL: Record<RiskLevel, { label: string; cls: string }> = {
  expired: { label: "Expired", cls: "text-[var(--coral)]" },
  high: { label: "≤7d", cls: "text-[var(--coral)]" },
  medium: { label: "≤30d", cls: "text-[var(--brass)]" },
  ok: { label: "OK", cls: "text-[var(--muted)]" },
};

const TOOLS = [
  {
    href: "/investments/options/chain",
    label: "Chain",
    icon: LineChart,
    blurb: "Any listed symbol — every expiry, strike, Greek and the IV surface.",
    needsPosition: false,
  },
  {
    href: "/investments/options/wheel?tab=scan",
    label: "Scanner",
    icon: Radar,
    blurb: "Ranked cash-secured puts across a liquid universe, with a trade plan.",
    needsPosition: false,
  },
  {
    href: "/investments/options/chain?mode=vol",
    label: "Fixed-strike vol",
    icon: Activity,
    blurb: "Whether a strike's implied vol is rich or cheap against its own history.",
    needsPosition: false,
  },
  {
    href: "/investments/options/wheel",
    label: "Wheel & premium",
    icon: RotateCw,
    blurb: "Your put→assignment→call cycles and the premium they've paid.",
    needsPosition: true,
  },
] as const;

export function OptionsPositionsView({
  legs,
  ivByOcc,
  underlyingPrices,
  chainByUnderlying,
}: {
  legs: HoldingRow[];
  ivByOcc: Record<string, number>;
  underlyingPrices: Record<string, number>;
  chainByUnderlying: Record<string, OptionQuote[]>;
}) {
  const { quotes } = useLivePrices();

  // Live quote first, chain spot second — the chain still prices the book when
  // the market is closed or Finnhub has no coverage for the underlying.
  const spotOf = (underlying: string): number | null =>
    quotes[underlying]?.price ?? underlyingPrices[underlying] ?? null;

  const parsed = useMemo<Leg[]>(() => {
    const now = new Date();
    return legs
      .map((h) => {
        const p = parseOccSymbol(h.ticker);
        if (!p) return null;
        // Quantity is stored in shares (100 per contract); everything a person
        // says about options is in contracts.
        return { h, p, contracts: (h.quantity ?? 0) / CONTRACT_SIZE, dte: daysToExpiry(p.expiry, now) };
      })
      .filter((l): l is Leg => l != null)
      .sort((a, b) => a.dte - b.dte);
  }, [legs]);

  const stats = useMemo(() => {
    const underlyings = new Set(parsed.map((l) => l.p.underlying));
    const open = parsed.reduce((n, l) => n + Math.abs(l.contracts), 0);
    // What assignment would cost: a short put obliges you to buy 100 shares at
    // the strike. Short calls are covered by shares you already hold, so they
    // carry no cash requirement here.
    const ifAssigned = parsed
      .filter((l) => l.contracts < 0 && l.p.right === "put" && l.dte >= 0)
      .reduce((sum, l) => sum + l.p.strike * CONTRACT_SIZE * Math.abs(l.contracts), 0);
    const soon = parsed.filter((l) => l.dte >= 0 && l.dte <= 7);
    const soonItm = soon.filter((l) => {
      const spot = spotOf(l.p.underlying);
      if (spot == null) return false;
      return l.p.right === "call" ? isItmCall(l.p.strike, spot) : isItmPut(l.p.strike, spot);
    });
    return { underlyings: underlyings.size, open, ifAssigned, soon: soon.length, soonItm: soonItm.length };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- spotOf closes over quotes
  }, [parsed, quotes, underlyingPrices]);

  // Greeks, IV and the bid/ask for every leg, off the same chain the analytics
  // below uses: the source's real Greeks first, Black-Scholes from IV second.
  const rows = useMemo<LegFigures[]>(() => {
    const byOcc: Record<string, OptionQuote> = {};
    for (const list of Object.values(chainByUnderlying)) for (const c of list) byOcc[c.occ] = c;
    return parsed.map((l) => {
      const spot = spotOf(l.p.underlying);
      const quote = byOcc[l.p.occ];
      const iv = quote?.iv ?? ivByOcc[l.p.occ] ?? null;
      const cg = quote?.greeks;
      const g = cg && cg.delta != null ? cg : computeGreeks(l.p, spot, iv);
      // Stored quantity is in SHARES (±100 per contract), which is exactly the
      // multiplier a per-share Greek needs to become a position figure.
      const shares = l.h.quantity ?? 0;
      return {
        ...l,
        spot,
        quote,
        iv,
        g,
        posDelta: g.delta != null ? g.delta * shares : null,
        posTheta: g.theta != null ? g.theta * shares : null,
        pnl: l.h.costBasis != null ? effectiveValue(l.h, quotes) - l.h.costBasis : null,
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- spotOf closes over quotes
  }, [parsed, chainByUnderlying, ivByOcc, quotes, underlyingPrices]);

  const book = useMemo(() => {
    const sum = (pick: (r: LegFigures) => number | null) => {
      const known = rows.map(pick).filter((v): v is number => v != null);
      return known.length ? known.reduce((a, b) => a + b, 0) : null;
    };
    return { delta: sum((r) => r.posDelta), theta: sum((r) => r.posTheta) };
  }, [rows]);

  const [focus, setFocus] = useState<PositionFocus | null>(null);

  const currency = legs[0]?.currency ?? "USD";

  if (parsed.length === 0) return <EmptyDesk />;

  const verdict = optionsBookVerdict(stats);
  const openContracts = round(stats.open);

  return (
    <div className="space-y-9">
      {/* Every count here is in CONTRACTS. Holdings store option quantity in
          shares (±100 per contract), so `stats.open` is that quantity ÷
          CONTRACT_SIZE — the trade tape, by contrast, already counts 1 per
          contract. */}
      <section aria-label="Open option positions">
        <HeroLine
          hero={
            <Hero
              eyebrow="Cash if assigned"
              figure={formatCurrency(stats.ifAssigned, currency)}
              verdict={
                <>
                  <Mark tone={verdict.tone}>{verdict.expiry}</Mark>{" "}
                  <span className="text-[var(--muted)]">
                    {verdict.assigned != null
                      ? "That is what the short puts would call for at their strikes."
                      : "No short puts are open, so nothing can be put to you."}
                  </span>
                </>
              }
            />
          }
        >
          <SideFigure
            label="Open contracts"
            value={`${openContracts} · ${stats.underlyings} ${stats.underlyings === 1 ? "underlying" : "underlyings"}`}
          />
          <SideFigure
            label="Expiring ≤ 7d"
            value={`${stats.soon} ${stats.soon === 1 ? "leg" : "legs"}`}
            tone={stats.soonItm > 0 ? "coral" : undefined}
            sub={stats.soonItm > 0 ? `${stats.soonItm} in the money` : "none in the money"}
          />
          <SideFigure
            label="Position Δ"
            value={book.delta != null ? `${signedNum(book.delta, 0)} shares` : "—"}
          />
          <SideFigure
            label="Θ per day"
            value={book.theta != null ? signedMoney(book.theta, currency) : "—"}
            tone={book.theta == null ? "muted" : book.theta >= 0 ? "jade" : "coral"}
          />
        </HeroLine>
      </section>

      <section aria-label="Your legs" className="space-y-3">
        <div className={ruled.scroll}>
          <table className={`${ruled.table} min-w-[1080px]`}>
            <thead>
              <tr className={`${ruled.headRow} align-bottom`}>
                <th className="pb-2.5 pr-5 text-left font-normal">
                  <h2 className="font-display text-lg tracking-tight text-[var(--paper)]">
                    Your legs
                    <span className="mono ml-2 text-xs font-normal text-[var(--muted)]">
                      soonest expiry first
                    </span>
                  </h2>
                </th>
                {["Contracts", "Expiry", "Δ", "Pos. Δ", "Θ / day", "IV", "Bid / Ask", "P&L"].map((h) => (
                  <th key={h} className={`${ruled.th} text-right`}>
                    {h}
                  </th>
                ))}
                <th className={ruled.th}>Assign</th>
                <th className={`${ruled.th} text-right`}>Γ</th>
                <th className={`${ruled.th} text-right`}>Vega</th>
                <th className={ruled.th}>
                  <span className="sr-only">Open in</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <LegRow
                  key={r.h.id}
                  row={r}
                  currency={currency}
                  selected={focus?.underlying === r.p.underlying && focus.expiry === r.p.expiry}
                  onSelect={() => setFocus({ underlying: r.p.underlying, expiry: r.p.expiry })}
                />
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[13px] text-[var(--muted)]">
          Contracts are whole contracts (1 = 100 shares), signed: negative is short. Pos. Δ is in
          share equivalents and Θ / day is dollars for the whole position. Δ, Γ and Vega are per
          share. Greeks and IV are live from the free CBOE chain. Pick a leg to see its payoff
          below.
        </p>
      </section>

      <OptionsAnalytics
        legs={legs}
        quotes={quotes}
        ivByOcc={ivByOcc}
        underlyingPrices={underlyingPrices}
        chainByUnderlying={chainByUnderlying}
        currency={currency}
        // Greeks are columns of the legs table above on this page.
        omit={["greeks"]}
        focus={focus}
        onFocus={setFocus}
      />

      <ToolGrid hasPositions />
    </div>
  );
}

/** One open leg: what it is, how long it has, its Greeks, and where it can be inspected. */
function LegRow({
  row,
  currency,
  selected,
  onSelect,
}: {
  row: LegFigures;
  currency: string;
  selected: boolean;
  onSelect: () => void;
}) {
  const { h, p, contracts, dte, spot, quote, iv, g, posDelta, posTheta, pnl } = row;
  const itm = spot != null && (p.right === "call" ? isItmCall(p.strike, spot) : isItmPut(p.strike, spot));
  const flag = optionRiskFlag(p, h.quantity, spot, dte);
  const risk = RISK_LABEL[riskLevel(dte)];
  const chainHref = `/investments/options/chain?ticker=${encodeURIComponent(p.underlying)}`;
  const dash = <span className="text-[var(--muted)]">—</span>;

  return (
    <tr className={`${ruled.row} ${selected ? "bg-[var(--panel-2)]/50" : ""}`}>
      <td className={ruled.td}>
        <button
          type="button"
          onClick={onSelect}
          aria-pressed={selected}
          title="Show this position's payoff"
          className="group flex flex-col items-start gap-0.5 text-left"
        >
          <span className="flex items-baseline gap-3">
            <span className="mono min-w-12 font-medium group-hover:text-[var(--brass)]">
              {p.underlying}
            </span>
            <span className="whitespace-nowrap text-[13px] text-[var(--muted)]">
              {formatStrike(p.strike)} {p.right}
              {itm && <span className="text-[var(--coral)]"> · in the money</span>}
            </span>
          </span>
          {(spot != null || h.costBasis != null) && (
            <span className="whitespace-nowrap pl-[3.75rem] text-xs text-[var(--muted)]">
              {[
                spot != null ? `${p.underlying} at ${formatCurrency(spot, currency)}` : null,
                h.costBasis != null ? `basis ${formatCurrency(Math.abs(h.costBasis), currency)}` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          )}
        </button>
      </td>
      <td
        className={`${ruled.td} ${ruled.num}`}
        title={`${contracts < 0 ? "Short" : "Long"} ${Math.abs(round(contracts))} ${Math.abs(contracts) === 1 ? "contract" : "contracts"}`}
      >
        {signedNum(round(contracts), 0, true)}
      </td>
      <td className={`${ruled.td} ${ruled.num}`}>
        {formatOptionExpiry(p.expiry)}{" "}
        <span className={dte <= 7 ? "text-[var(--coral)]" : "text-[var(--muted)]"}>
          {dte < 0 ? "expired" : dte === 0 ? "today" : `${dte}d`}
        </span>
      </td>
      <td className={`${ruled.td} ${ruled.num}`}>{g.delta != null ? g.delta.toFixed(2) : dash}</td>
      <td className={`${ruled.td} ${ruled.num}`}>{posDelta != null ? signedNum(posDelta, 0) : dash}</td>
      <td
        className={`${ruled.td} ${ruled.num} ${posTheta == null ? "" : posTheta >= 0 ? "text-[var(--jade)]" : "text-[var(--coral)]"}`}
        title={g.theta != null ? `${g.theta.toFixed(3)} per share per day` : undefined}
      >
        {posTheta != null ? signedMoney(posTheta, currency) : dash}
      </td>
      <td className={`${ruled.td} ${ruled.num}`}>{iv != null ? `${(iv * 100).toFixed(0)}%` : dash}</td>
      <td className={`${ruled.td} ${ruled.num} text-[var(--muted)]`}>
        {quote?.bid != null || quote?.ask != null
          ? `${quote?.bid != null ? quote.bid.toFixed(2) : "—"} / ${quote?.ask != null ? quote.ask.toFixed(2) : "—"}`
          : "—"}
      </td>
      <td
        className={`${ruled.td} ${ruled.num} ${pnl == null ? "" : pnl >= 0 ? "text-[var(--jade)]" : "text-[var(--coral)]"}`}
      >
        {pnl != null ? signedMoney(pnl, currency) : dash}
      </td>
      <td className={`${ruled.td} whitespace-nowrap text-[13px]`}>
        {flag ? (
          <span className="text-[var(--coral)]">
            {flag === "assignment" ? "Assignment risk" : "May expire worthless"}
          </span>
        ) : (
          <span className={risk.cls}>{risk.label}</span>
        )}
      </td>
      <td className={`${ruled.td} ${ruled.num} text-[var(--muted)]`}>
        {g.gamma != null ? g.gamma.toFixed(4) : "—"}
      </td>
      <td className={`${ruled.td} ${ruled.num} text-[var(--muted)]`}>
        {g.vega != null ? g.vega.toFixed(3) : "—"}
      </td>
      <td className={ruled.td}>
        <span className="flex items-center justify-end gap-3">
          <DeskLink href={chainHref}>Chain</DeskLink>
          <DeskLink href={`${chainHref}&mode=vol`}>Vol</DeskLink>
        </span>
      </td>
    </tr>
  );
}

function DeskLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-0.5 text-[13px] text-[var(--muted)] underline-offset-2 transition-colors hover:text-[var(--brass)] hover:underline"
    >
      {children}
      <ArrowUpRight size={11} aria-hidden />
    </Link>
  );
}

/** The four tools, named on the page so none of them depends on a chip. */
function ToolGrid({ hasPositions }: { hasPositions: boolean }) {
  return (
    <section aria-label="Options tools">
      <SectionHead title="Tools" />
      <ul>
        {TOOLS.map(({ href, label, icon: Icon, blurb, needsPosition }) => {
          const dimmed = needsPosition && !hasPositions;
          return (
            <li key={href} className="border-b border-line">
              <Link
                href={href}
                className="group grid grid-cols-[minmax(0,11rem)_minmax(0,1fr)_auto] items-center gap-x-5 py-3.5"
              >
                <span
                  className={`flex items-center gap-2 text-sm font-medium transition-colors group-hover:text-[var(--brass)] ${
                    dimmed ? "text-[var(--muted)]" : ""
                  }`}
                >
                  <Icon size={14} className="shrink-0 text-[var(--brass)]" aria-hidden />
                  {label}
                </span>
                <span className="text-[13px] text-[var(--muted)]">
                  {dimmed ? "Fills in once a cycle starts." : blurb}
                </span>
                <ArrowUpRight size={13} className="text-[var(--muted)]" aria-hidden />
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * No option legs. This is the case that had no entry point at all before — the
 * chip that opened the options tools only rendered on rows holding a leg — so
 * the desk has to say which tools work without a position.
 */
function EmptyDesk() {
  return (
    <div className="space-y-9">
      <Hero
        eyebrow="No open option legs"
        figure="0"
        verdict={
          <span className="text-[var(--muted)]">
            Nothing to track yet. Three of these desks work on any listed symbol, with or without
            a position — start with the scanner if you&rsquo;re looking for a put to sell, or open
            a chain for a ticker you&rsquo;re watching.
          </span>
        }
      />
      <ToolGrid hasPositions={false} />
    </div>
  );
}

/** Contracts are usually whole; show a fraction only when there genuinely is one. */
function round(n: number): number {
  return Number.isInteger(n) ? n : Number(n.toFixed(2));
}

/** "+42" / "−62" with a true minus. `keepFraction` leaves a fractional contract count alone. */
function signedNum(n: number, digits: number, keepFraction = false): string {
  const abs = Math.abs(n);
  const shown = keepFraction && !Number.isInteger(abs) ? String(abs) : abs.toFixed(digits);
  return `${n < 0 ? "−" : "+"}${shown}`;
}

function signedMoney(n: number, currency: string): string {
  return `${n < 0 ? "−" : "+"}${formatCurrency(Math.abs(n), currency)}`;
}
