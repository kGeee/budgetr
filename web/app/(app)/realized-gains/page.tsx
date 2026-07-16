import { PageHead } from "@/components/page-head";
import { RealizedGainsView } from "@/components/realized-gains-view";
import {
  getCostBasisMethods,
  getInvestmentTransactions,
  getRealizedGains,
  getTaxLotOverrides,
} from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function RealizedGainsPage() {
  // Full history — the client filters by year in-memory, and summaries/years
  // come straight off the reconstructed lots.
  const { lots, years } = getRealizedGains();
  const transactions = getInvestmentTransactions();
  const methods = getCostBasisMethods();
  const overrides = getTaxLotOverrides();

  return (
    <div className="space-y-7">
      <PageHead title="Realized gains" />
      <RealizedGainsView
        lots={lots}
        years={years}
        transactions={transactions}
        methods={methods}
        overrides={overrides}
      />
    </div>
  );
}
