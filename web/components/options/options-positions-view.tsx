"use client";

/**
 * Options › Positions — the Options desk's landing view.
 *
 * Answers "what am I actually in?" before offering any tool: open contracts, the
 * cash a short put would need if it were assigned, what expires this week, and
 * which legs are close to the money. The deep per-leg work (expiry calendar,
 * Greeks, spread P&L) is the existing OptionsAnalytics panel, reused verbatim
 * below rather than reimplemented.
 */

import { useMemo } from "react";
import Link from "next/link";
import { ArrowUpRight, Radar, LineChart, Activity, RotateCw } from "lucide-react";
import { Card } from "@/components/ui/card";
import { OptionsAnalytics } from "@/components/options/options-analytics";
import { useLivePrices } from "@/components/live-prices";
import { formatCurrency } from "@/lib/utils";
import {
  daysToExpiry,
  formatOptionExpiry,
  formatStrike,
  isItmCall,
  isItmPut,
  optionRiskFlag,
  parseOccSymbol,
  type ParsedOption,
} from "@/lib/options";
import { CONTRACT_SIZE } from "@/lib/payoff";
import type { HoldingRow } from "@/components/portfolio-view";
import type { OptionQuote } from "@/lib/yahoo";

type Leg = { h: HoldingRow; p: ParsedOption; contracts: number; dte: number };

const TOOLS = [
  {
    href: "/investments/options/chain",
    label: "Chain",
    icon: LineChart,
    blurb: "Any listed symbol — every expiry, strike, Greek and the IV surface.",
    needsPosition: false,
  },
  {
    href: "/investments/options/scanner",
    label: "Scanner",
    icon: Radar,
    blurb: "Ranked cash-secured puts across a liquid universe, with a trade plan.",
    needsPosition: false,
  },
  {
    href: "/investments/options/vol",
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

  const currency = legs[0]?.currency ?? "USD";

  if (parsed.length === 0) return <EmptyDesk />;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Open contracts" value={String(round(stats.open))} sub={`${stats.underlyings} underlying${stats.underlyings === 1 ? "" : "s"}`} />
        <Kpi
          label="Cash if assigned"
          value={formatCurrency(stats.ifAssigned, currency, { maximumFractionDigits: 0 })}
          sub="short puts at strike"
        />
        <Kpi
          label="Expiring ≤ 7d"
          value={String(stats.soon)}
          sub={stats.soonItm > 0 ? `${stats.soonItm} in the money` : "none in the money"}
          tone={stats.soonItm > 0 ? "coral" : undefined}
        />
        <Kpi label="Underlyings" value={String(stats.underlyings)} sub="with open legs" />
      </div>

      <Card className="overflow-hidden p-0">
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <span className="eyebrow">Your legs</span>
          <span className="text-xs text-[var(--muted)]">soonest expiry first</span>
        </div>
        <ul className="divide-y divide-line/60">
          {parsed.map((l) => (
            <LegRow key={l.h.id} leg={l} spot={spotOf(l.p.underlying)} currency={currency} />
          ))}
        </ul>
      </Card>

      <ToolGrid hasPositions />

      <OptionsAnalytics
        legs={legs}
        quotes={quotes}
        ivByOcc={ivByOcc}
        underlyingPrices={underlyingPrices}
        chainByUnderlying={chainByUnderlying}
        currency={currency}
      />
    </div>
  );
}

/** One open leg: what it is, how long it has, and where it can be inspected. */
function LegRow({ leg, spot, currency }: { leg: Leg; spot: number | null; currency: string }) {
  const { h, p, contracts, dte } = leg;
  const short = contracts < 0;
  const itm = spot != null && (p.right === "call" ? isItmCall(p.strike, spot) : isItmPut(p.strike, spot));
  const flag = optionRiskFlag(p, h.quantity, spot, dte);

  return (
    <li className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 py-3.5">
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-2 text-sm">
          <span className="mono font-semibold text-[var(--brass)]">{p.underlying}</span>
          <span className="mono">
            {formatOptionExpiry(p.expiry)} {formatStrike(p.strike)}
            {p.right === "call" ? "C" : "P"}
          </span>
          <span className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide ${
            short ? "border-[var(--brass-dim)] text-[var(--brass)]" : "border-line text-[var(--muted)]"
          }`}>
            {short ? "short" : "long"} {Math.abs(round(contracts))}
          </span>
          {itm && (
            <span className="rounded-full border border-[var(--coral)] px-2 py-0.5 text-[10px] uppercase tracking-wide text-[var(--coral)]">
              itm
            </span>
          )}
          {flag === "assignment" && (
            <span className="rounded-full border border-[var(--coral)] px-2 py-0.5 text-[10px] uppercase tracking-wide text-[var(--coral)]">
              assignment risk
            </span>
          )}
        </p>
        <p className="mt-1 text-xs text-[var(--muted)]">
          {dte < 0 ? "expired" : dte === 0 ? "expires today" : `${dte} days left`}
          {spot != null && ` · ${p.underlying} at ${formatCurrency(spot, currency)}`}
          {h.costBasis != null && ` · basis ${formatCurrency(Math.abs(h.costBasis), currency)}`}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <DeskLink href={`/investments/options/chain?ticker=${encodeURIComponent(p.underlying)}`}>Chain</DeskLink>
        <DeskLink href={`/investments/options/vol?ticker=${encodeURIComponent(p.underlying)}`}>Vol</DeskLink>
      </div>
    </li>
  );
}

function DeskLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-0.5 text-xs text-[var(--faint)] transition-colors hover:text-[var(--brass)]"
    >
      {children}
      <ArrowUpRight size={11} aria-hidden />
    </Link>
  );
}

/** The four tools, named on the page so none of them depends on a chip. */
function ToolGrid({ hasPositions }: { hasPositions: boolean }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {TOOLS.map(({ href, label, icon: Icon, blurb, needsPosition }) => {
        const dimmed = needsPosition && !hasPositions;
        return (
          <Link
            key={href}
            href={href}
            className={`group flex flex-col gap-1.5 rounded-xl border p-4 transition-colors ${
              dimmed
                ? "border-line text-[var(--muted)] hover:border-[var(--line-strong)]"
                : "border-line hover:border-[var(--brass-dim)]"
            }`}
          >
            <span className="flex items-center gap-2 text-sm font-medium">
              <Icon size={14} className="text-[var(--brass)]" aria-hidden />
              {label}
            </span>
            <span className="text-xs leading-relaxed text-[var(--muted)]">
              {dimmed ? "Fills in once a cycle starts." : blurb}
            </span>
          </Link>
        );
      })}
    </div>
  );
}

/**
 * No option legs. This is the case that had no entry point at all before — the
 * chip that opened the options tools only rendered on rows holding a leg — so
 * the desk has to say which tools work without a position.
 */
function EmptyDesk() {
  return (
    <div className="space-y-5">
      <Card className="p-8">
        <p className="eyebrow">No open option legs</p>
        <p className="mt-2 max-w-prose text-sm text-[var(--muted)]">
          Nothing to track yet. Three of these desks work on any listed symbol, with or
          without a position — start with the scanner if you&rsquo;re looking for a put to
          sell, or open a chain for a ticker you&rsquo;re watching.
        </p>
      </Card>
      <ToolGrid hasPositions={false} />
    </div>
  );
}

function Kpi({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "coral";
}) {
  return (
    <Card className="p-4">
      <p className="eyebrow">{label}</p>
      <p className={`mono mt-1.5 text-xl tabular ${tone === "coral" ? "text-[var(--coral)]" : ""}`}>
        {value}
      </p>
      {sub && <p className="mt-0.5 text-xs text-[var(--faint)]">{sub}</p>}
    </Card>
  );
}

/** Contracts are usually whole; show a fraction only when there genuinely is one. */
function round(n: number): number {
  return Number.isInteger(n) ? n : Number(n.toFixed(2));
}
