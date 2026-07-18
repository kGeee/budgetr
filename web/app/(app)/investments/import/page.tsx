import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHead } from "@/components/page-head";
import { TradeImport } from "@/components/import/trade-import";
import { StockSplits } from "@/components/import/stock-splits";
import { ImportHistory } from "@/components/import/import-history";
import { listManualAccounts } from "@/lib/import/account";
import { listStockSplits, listImportBatches } from "@/lib/import/import-service";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Import trades — budgetr",
};

export default function ImportTradesPage() {
  const accounts = listManualAccounts();
  const splits = listStockSplits();
  const batches = [...listImportBatches()].reverse(); // newest first

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-5 py-8 sm:px-8">
      <PageHead
        title="Import trades"
        action={
          <Link
            href="/investments"
            className="inline-flex items-center gap-1.5 text-sm text-[var(--muted)] transition hover:text-[var(--paper)]"
          >
            <ArrowLeft size={15} /> Investments
          </Link>
        }
      />

      <TradeImport accounts={accounts} />

      {batches.length > 0 && <ImportHistory batches={batches} />}

      <StockSplits splits={splits} />
    </div>
  );
}
