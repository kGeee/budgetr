import Link from "next/link";
import { DividendPanel } from "@/components/portfolio/dividend-panel";
import { RealizedGainsView } from "@/components/portfolio/realized-gains-view";
import { pill } from "@/components/portfolio/ruled";
import { listImportBatches } from "@/lib/import/import-service";
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
 * Investments › Income & gains: what selling out of the book has realized (the
 * old /realized-gains page), what it has paid out (dividends and the ex-div
 * calendar), and the door to the trade import both depend on. Neither needs
 * live prices or the value history.
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

  // Most recent import that is still in the ledger, for the strip's one fact.
  const lastImport = listImportBatches()
    .filter((b) => b.status !== "reverted")
    .at(-1);

  return (
    <div className="space-y-9">
      <div id="realized" className="scroll-mt-28">
        <RealizedGainsView
          lots={lots}
          years={years}
          transactions={getInvestmentTransactions()}
          methods={getCostBasisMethods()}
          overrides={getTaxLotOverrides()}
        />
      </div>

      <div id="dividends" className="scroll-mt-28">
        {dividendSummary.payments.length > 0 ? (
          <DividendPanel summary={dividendSummary} calendar={dividendCalendar} />
        ) : (
          <section aria-label="Dividends">
            <h2 className="border-b border-[var(--line-strong)] pb-2.5 font-display text-lg tracking-tight">
              Dividend income
            </h2>
            <p className="pt-3 text-sm text-[var(--muted)]">
              No dividend income recorded yet. It shows up here once a brokerage sync or an
              import brings in a dividend payment.
            </p>
          </section>
        )}
      </div>

      <section
        id="import"
        aria-label="Import trades"
        className="flex scroll-mt-28 flex-wrap items-center justify-between gap-4 border-b border-t border-b-line border-t-[var(--line-strong)] py-[18px]"
      >
        <div className="min-w-0 flex-1 basis-[360px]">
          <h2 className="font-display text-lg tracking-tight">
            Bring in your broker&apos;s full record
          </h2>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Realized gains are only as complete as the trade history behind them.
            {lastImport && (
              <>
                {" "}
                Last import: {lastImport.broker ?? lastImport.fileName ?? "a file"},{" "}
                {lastImport.rowsImported} {lastImport.rowsImported === 1 ? "trade" : "trades"}.
              </>
            )}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/investments/import"
            className="inline-flex min-h-11 items-center rounded-full bg-[var(--jade)] px-[18px] text-sm font-semibold text-[var(--on-jade)] transition-opacity hover:opacity-90"
          >
            Import trade history · CSV or OFX/QFX
          </Link>
          <Link href="/investments/import" className={pill}>
            Import history &amp; stock splits
          </Link>
        </div>
      </section>
    </div>
  );
}
