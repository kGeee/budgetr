import { Card } from "@/components/ui/card";
import { DividendPanel } from "@/components/portfolio/dividend-panel";
import { RealizedGainsView } from "@/components/portfolio/realized-gains-view";
import {
  getCostBasisMethods,
  getDividendSummary,
  getInvestmentTransactions,
  getRealizedGains,
  getTaxLotOverrides,
} from "@/lib/queries";
import { getDividendCalendar } from "@/lib/yahoo";
import { heldSymbols } from "./holdings-data";

/**
 * Investments › Income & gains: what the book has paid out (dividends and the
 * ex-div calendar) and what selling out of it has realized (the old
 * /realized-gains page). Neither needs live prices or the value history.
 */
export async function IncomeTab() {
  const dividendSummary = getDividendSummary();

  // Only fetch Yahoo's ex-div calendar once we know some dividend income exists
  // (the panel is hidden otherwise, so the fetch would be wasted).
  const symbols = dividendSummary.payments.length > 0 ? heldSymbols() : [];
  const dividendCalendar = symbols.length > 0 ? await getDividendCalendar(symbols) : [];

  // Full history — the client filters by year in-memory, and summaries/years
  // come straight off the reconstructed lots.
  const { lots, years } = getRealizedGains();

  return (
    <div className="space-y-7">
      {dividendSummary.payments.length > 0 ? (
        <div id="dividends" className="scroll-mt-28">
          <DividendPanel summary={dividendSummary} calendar={dividendCalendar} />
        </div>
      ) : (
        <Card className="px-6 py-5 text-sm text-[var(--muted)]">
          No dividend income recorded yet. It shows up here once a brokerage sync or an
          import brings in a dividend payment.
        </Card>
      )}
      <div id="realized" className="scroll-mt-28 space-y-4">
        <span className="eyebrow">Realized gains</span>
        <RealizedGainsView
          lots={lots}
          years={years}
          transactions={getInvestmentTransactions()}
          methods={getCostBasisMethods()}
          overrides={getTaxLotOverrides()}
        />
      </div>
    </div>
  );
}
