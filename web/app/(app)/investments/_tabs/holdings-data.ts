import type { HoldingRow } from "@/components/portfolio/valuation";
import {
  getHoldings,
  getImportedHoldings,
  getInvestmentSectors,
  getManualHoldings,
  sectorKeyFor,
} from "@/lib/queries";
import { getTickerHistories } from "@/lib/portfolio-history";
import { parseOccSymbol } from "@/lib/options";

/**
 * Every symbol with a Yahoo price history: Plaid holdings, symbol-priced manual
 * holdings (e.g. BTC-USD) and imported positions. Option (OCC) tickers are
 * skipped — Yahoo has no history for them. Cheap (DB only), so the Income tab
 * can use it for the dividend calendar without loading any prices.
 */
export function heldSymbols(): string[] {
  return [
    ...getHoldings()
      .map((h) => h.ticker)
      .filter((t): t is string => Boolean(t) && !parseOccSymbol(t)),
    ...getManualHoldings()
      .map((m) => m.symbol)
      .filter((s): s is string => Boolean(s)),
    ...getImportedHoldings()
      .map((h) => h.ticker)
      .filter((t) => !parseOccSymbol(t)),
  ];
}

/**
 * The whole book as holding rows — Plaid, manual and imported — each valued at
 * its best-known price. Shared by the Holdings and Allocation tabs, which both
 * need every position valued the same way; the price histories come back too,
 * since Holdings charts them and valuing a manual holding needs the last close.
 */
export async function loadHoldings() {
  const sectors = getInvestmentSectors();
  const manual = getManualHoldings();

  // Attach the symbol-scoped sector key + its current sector to every Plaid
  // holding so the row carries what the sector editor and allocation need.
  const plaidHoldings: HoldingRow[] = getHoldings().map((h) => {
    const sectorKey = sectorKeyFor(h.ticker, h.id);
    return { ...h, sectorKey, sector: sectors[sectorKey] ?? null };
  });

  // Current positions derived from imported broker trades (source:'import') so
  // they show alongside Plaid holdings and anchor the value curve.
  const importedRaw = getImportedHoldings();

  const symbols = heldSymbols();
  const histories = await getTickerHistories(symbols);
  const lastClose = (sym: string | null | undefined): number | null => {
    const hist = sym ? histories[sym.toUpperCase()] : undefined;
    return hist && hist.length > 0 ? hist[hist.length - 1].close : null;
  };

  // Map manual holdings into the holdings shape. Tickered ones are valued by
  // quantity × price (live → Yahoo last close); fixed-value ones carry their
  // user-set value directly.
  const manualHoldings: HoldingRow[] = manual.map((m) => {
    const sectorKey = sectorKeyFor(m.symbol, m.id);
    return {
      id: m.id,
      quantity: m.quantity,
      costBasis: m.costBasis,
      price: null,
      value: m.symbol ? null : m.manualValue, // fixed-value uses manualValue
      closePrice: m.symbol ? lastClose(m.symbol) : null,
      currency: m.currency ?? "USD",
      ticker: m.symbol,
      securityName: m.name,
      securityType: m.type,
      // Wallet-imported tokens group under the wallet's label as their own
      // "account"; hand-entered holdings stay under "Manual".
      accountName: m.walletLabel ?? "Manual",
      manual: true,
      fromWallet: Boolean(m.walletId),
      sectorKey,
      sector: sectors[sectorKey] ?? null,
    };
  });

  // Imported positions valued like tickered manual holdings: quantity × last
  // close. Grouped under their import account's name.
  const importedHoldings: HoldingRow[] = importedRaw.map((h) => {
    const sectorKey = sectorKeyFor(h.ticker, h.id);
    return {
      id: h.id,
      quantity: h.quantity,
      costBasis: h.costBasis,
      price: null,
      value: null,
      closePrice: lastClose(h.ticker),
      currency: h.currency ?? "USD",
      ticker: h.ticker,
      securityName: h.securityName,
      securityType: null,
      accountName: h.accountName ?? "Imported",
      manual: true,
      fromWallet: false,
      sectorKey,
      sector: sectors[sectorKey] ?? null,
    };
  });

  // Interleave manual + imported holdings with Plaid ones, ordered by best-known
  // value so they sort in by size rather than always landing at the bottom. Live
  // prices refine the figure client-side but don't reorder (avoids jumpiness).
  const estValue = (h: HoldingRow): number =>
    h.value ?? (h.price ?? h.closePrice ?? 0) * (h.quantity ?? 0);
  const holdings = [...plaidHoldings, ...manualHoldings, ...importedHoldings].sort(
    (a, b) => estValue(b) - estValue(a),
  );

  // Fixed-value manual assets (no symbol) have no price series; the value chart
  // folds them in as a constant so its line matches the headline market value.
  const fixedValueTotal = manual
    .filter((m) => !m.symbol)
    .reduce((s, m) => s + (m.manualValue ?? 0), 0);

  return { holdings, histories, fixedValueTotal };
}
