/**
 * Wheel & premium report — db glue over lib/wheel-math.ts. Reads the trade
 * tape (investment_transactions) and current holdings, returns one plain
 * serializable payload for the /investments/options/wheel page.
 */

import { getHoldings, getInvestmentTransactions } from "@/lib/queries";
import { daysToExpiry, parseOccSymbol } from "@/lib/options";
import {
  buildShortCycles,
  cumulativeNet,
  mapTrades,
  monthlyPremium,
  rollupByUnderlying,
  type MonthlyPremium,
  type ShortCycle,
  type UnderlyingRollup,
} from "@/lib/wheel-math";

export type OpenShortPosition = {
  occ: string;
  underlying: string;
  right: "call" | "put";
  strike: number;
  expiry: string;
  dte: number;
  contracts: number;
  /** Credit received at open (from the holding's negative basis), if known. */
  credit: number | null;
  /** Current cost to close (abs of the short position's market value). */
  markToClose: number | null;
  /** Cash-secured collateral for puts: strike · 100 · contracts. */
  collateral: number | null;
  /** For calls: covered by ≥100 shares/contract of the underlying? */
  covered: boolean | null;
  /** credit / collateral annualized over the ORIGINAL term (puts only). */
  annualizedPct: number | null;
};

export type WheelReport = {
  months: MonthlyPremium[];
  cumulative: Array<{ month: string; cumulative: number }>;
  cycles: ShortCycle[];
  rollup: UnderlyingRollup[];
  open: OpenShortPosition[];
  kpis: {
    netThisMonth: number;
    netYtd: number;
    netAllTime: number;
    openContracts: number;
    collateralAtRisk: number;
    uncoveredCalls: number;
  };
};

export function buildWheelReport(): WheelReport {
  const today = new Date().toISOString().slice(0, 10);
  const { events, stocks } = mapTrades(getInvestmentTransactions());
  const cycles = buildShortCycles(events, stocks, today);
  const months = monthlyPremium(events);

  // Open short options from live holdings; shares per underlying for coverage.
  const holdings = getHoldings();
  const sharesByTicker = new Map<string, number>();
  for (const h of holdings) {
    if (h.ticker && !parseOccSymbol(h.ticker) && h.quantity != null) {
      const key = h.ticker.toUpperCase();
      sharesByTicker.set(key, (sharesByTicker.get(key) ?? 0) + h.quantity);
    }
  }

  const open: OpenShortPosition[] = holdings.flatMap((h) => {
    const parsed = parseOccSymbol(h.ticker);
    if (!parsed || h.quantity == null || h.quantity >= 0) return [];
    const contracts = Math.abs(h.quantity);
    const dte = daysToExpiry(parsed.expiry);
    if (dte < 0) return [];
    const credit = h.costBasis != null && h.costBasis < 0 ? -h.costBasis : null;
    const collateral = parsed.right === "put" ? parsed.strike * 100 * contracts : null;
    const cycle = cycles.find((c) => c.occ === parsed.occ);
    const term = cycle ? Math.max(1, cycle.daysHeld + dte) : null;
    return [
      {
        occ: parsed.occ,
        underlying: parsed.underlying,
        right: parsed.right,
        strike: parsed.strike,
        expiry: parsed.expiry,
        dte,
        contracts,
        credit,
        markToClose: h.value != null ? Math.abs(h.value) : null,
        collateral,
        covered:
          parsed.right === "call"
            ? (sharesByTicker.get(parsed.underlying) ?? 0) >= contracts * 100
            : null,
        annualizedPct:
          credit != null && collateral != null && term != null
            ? (credit / collateral / term) * 365 * 100
            : null,
      },
    ];
  });

  const thisMonth = today.slice(0, 7);
  const thisYear = today.slice(0, 4);
  return {
    months,
    cumulative: cumulativeNet(months),
    cycles,
    rollup: rollupByUnderlying(cycles),
    open: open.sort((a, b) => a.dte - b.dte),
    kpis: {
      netThisMonth: months.find((m) => m.month === thisMonth)?.net ?? 0,
      netYtd: months.filter((m) => m.month.startsWith(thisYear)).reduce((a, m) => a + m.net, 0),
      netAllTime: months.reduce((a, m) => a + m.net, 0),
      openContracts: open.reduce((a, p) => a + p.contracts, 0),
      collateralAtRisk: open.reduce((a, p) => a + (p.collateral ?? 0), 0),
      uncoveredCalls: open.filter((p) => p.covered === false).length,
    },
  };
}
