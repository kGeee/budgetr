/**
 * Wheel & premium report — db glue over lib/wheel-math.ts. Reads the trade
 * tape (investment_transactions) and current holdings, returns one plain
 * serializable payload for the /investments/options/wheel page.
 *
 * Spread legs are excluded everywhere: income, cycles, stories, and open
 * positions all cover naked short premium (CSPs / covered calls) only.
 */

import { getHoldings, getInvestmentTransactions } from "@/lib/queries";
import { daysToExpiry } from "@/lib/options";
import {
  buildWheelLedger,
  buildWheelStories,
  cumulativeNet,
  mapTrades,
  monthlyPremium,
  openShortPositions,
  rollupByUnderlying,
  type MonthlyPremium,
  type ShortCycle,
  type UnderlyingRollup,
  type WheelStory,
} from "@/lib/wheel-math";

export type { WheelStory, WheelPhase, ShortCycle } from "@/lib/wheel-math";

export type OpenPosition = {
  occ: string;
  underlying: string;
  right: "call" | "put";
  strike: number;
  expiry: string;
  dte: number;
  contracts: number;
  credit: number | null;
  markToClose: number | null;
  collateral: number | null;
  covered: boolean | null;
  annualizedPct: number | null;
};

export type WheelReport = {
  months: MonthlyPremium[];
  cumulative: Array<{ month: string; cumulative: number }>;
  cycles: ShortCycle[];
  stories: WheelStory[];
  rollup: UnderlyingRollup[];
  open: OpenPosition[];
  spreadLegsExcluded: number;
  kpis: {
    netThisMonth: number;
    netYtd: number;
    netAllTime: number;
    netAllOptions: number; // every option trade incl. spreads — for reference
    openContracts: number;
    collateralAtRisk: number;
    uncoveredCalls: number;
  };
};

export function buildWheelReport(): WheelReport {
  const today = new Date().toISOString().slice(0, 10);
  const { events, stocks } = mapTrades(getInvestmentTransactions());
  const ledger = buildWheelLedger(events, stocks, today);
  const months = monthlyPremium(ledger.incomeEvents);
  const stories = buildWheelStories(ledger.cycles);

  const open: OpenPosition[] = openShortPositions(
    getHoldings().map((h) => ({ ticker: h.ticker, quantity: h.quantity, value: h.value, costBasis: h.costBasis })),
  )
    .map((p) => {
      const dte = daysToExpiry(p.expiry);
      const cycle = ledger.cycles.find((c) => c.occ === p.occ);
      const term = cycle ? Math.max(1, cycle.daysHeld + Math.max(0, dte)) : null;
      return {
        ...p,
        dte,
        annualizedPct:
          p.credit != null && p.collateral != null && p.collateral > 0 && term != null
            ? (p.credit / p.collateral / term) * 365 * 100
            : null,
      };
    })
    .filter((p) => p.dte >= 0)
    .sort((a, b) => a.dte - b.dte);

  const thisMonth = today.slice(0, 7);
  const thisYear = today.slice(0, 4);
  return {
    months,
    cumulative: cumulativeNet(months),
    cycles: ledger.cycles,
    stories,
    rollup: rollupByUnderlying(ledger.cycles),
    open,
    spreadLegsExcluded: ledger.spreadLegsExcluded,
    kpis: {
      netThisMonth: months.find((m) => m.month === thisMonth)?.net ?? 0,
      netYtd: months.filter((m) => m.month.startsWith(thisYear)).reduce((a, m) => a + m.net, 0),
      netAllTime: months.reduce((a, m) => a + m.net, 0),
      netAllOptions: monthlyPremium(events).reduce((a, m) => a + m.net, 0),
      openContracts: open.reduce((a, p) => a + p.contracts, 0),
      collateralAtRisk: open.reduce((a, p) => a + (p.collateral ?? 0), 0),
      uncoveredCalls: open.filter((p) => p.covered === false).length,
    },
  };
}
