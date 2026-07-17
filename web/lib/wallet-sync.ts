/**
 * Wallet sync: read on-chain balances, price + junk-filter them against
 * CoinGecko, and persist the survivors as `manual_holdings` rows tagged with the
 * wallet id. Re-syncing replaces that wallet's rows atomically.
 *
 * Junk filter: a token is kept only if (a) CoinGecko tracks its contract/mint
 * (i.e. it has a real market — see getContractIdMap) and (b) its USD value is at
 * or above MIN_TOKEN_USD. Airdrop spam has no CoinGecko listing and is dropped.
 *
 * Storage flavour mirrors user-entered manual holdings:
 *  - Curated majors (BTC/ETH/SOL/…): stored tickered (`${SYM}-USD`) so they get
 *    live day-change on the investments page and count toward "priced today".
 *  - Everything else: stored fixed-value at the synced USD snapshot, refreshed
 *    on the next sync.
 */

import { db } from "@/db";
import { manualHoldings, wallets } from "@/db/schema";
import { eq } from "drizzle-orm";
import {
  getContractIdMap,
  getUsdPricesByIds,
  hasCuratedSymbol,
  NATIVE_COIN_ID,
  type CgPlatform,
  type CoinRef,
} from "@/lib/coingecko";
import { fetchWalletBalances, type Chain } from "@/lib/onchain";

/** Drop priced tokens worth less than this — kills dust + surviving low-value spam. */
const MIN_TOKEN_USD = 1;

export type SyncedToken = { symbol: string; amount: number; usd: number };
export type WalletSyncResult = {
  kept: number;
  droppedJunk: number;
  droppedDust: number;
  totalUsd: number;
  tokens: SyncedToken[];
};

export async function syncWallet(wallet: {
  id: string;
  chain: string;
  address: string;
}): Promise<WalletSyncResult> {
  const chain = wallet.chain as Chain;
  const balances = await fetchWalletBalances(chain, wallet.address);

  // Resolve each balance to a CoinGecko coin id (native → known id, token →
  // contract map). Tokens absent from the map are junk and get dropped here.
  const contractMap = await getContractIdMap();
  const platformMap: Map<string, CoinRef> | undefined =
    chain === "ethereum" || chain === "solana"
      ? contractMap[chain as CgPlatform]
      : undefined;

  type Resolved = { symbol: string; contract: string | null; amount: number; coinId: string };
  const resolved: Resolved[] = [];
  let droppedJunk = 0;
  for (const b of balances) {
    if (b.kind === "native") {
      const coinId = NATIVE_COIN_ID[chain];
      if (coinId) resolved.push({ symbol: b.symbol, contract: null, amount: b.amount, coinId });
      continue;
    }
    const ref = b.contract ? platformMap?.get(b.contract.toLowerCase()) : undefined;
    if (!ref) {
      droppedJunk++;
      continue;
    }
    resolved.push({
      symbol: b.symbol || ref.symbol,
      contract: b.contract ?? null,
      amount: b.amount,
      coinId: ref.id,
    });
  }

  // Preserve any user-set cost basis across the destructive re-sync. Rows have
  // stable ids (`${walletId}:${contract|symbol}`), so we carry costBasis forward
  // by id rather than letting the delete+insert wipe it.
  const priorCostBasis = new Map<string, number>();
  for (const row of db
    .select({ id: manualHoldings.id, costBasis: manualHoldings.costBasis })
    .from(manualHoldings)
    .where(eq(manualHoldings.walletId, wallet.id))
    .all()) {
    if (row.costBasis != null) priorCostBasis.set(row.id, row.costBasis);
  }

  // Price the survivors in one batched call, then apply the dust threshold.
  const prices = await getUsdPricesByIds(resolved.map((r) => r.coinId));

  // Guard against wiping holdings on a transient price-feed failure: if we found
  // priceable tokens on-chain but got zero prices back (e.g. CoinGecko 429),
  // that's a fetch failure, not a genuinely empty wallet. Abort before the
  // destructive replace so the wallet's existing rows are preserved.
  if (resolved.length > 0 && Object.keys(prices).length === 0) {
    throw new Error("Price service unavailable (rate limited). Existing balances kept — try again shortly.");
  }

  const now = new Date();
  const rows: (typeof manualHoldings.$inferInsert)[] = [];
  const tokens: SyncedToken[] = [];
  let droppedDust = 0;
  let totalUsd = 0;

  for (const r of resolved) {
    const p = prices[r.coinId];
    if (!p) {
      droppedJunk++; // tracked contract but no live price → treat as junk
      continue;
    }
    const usd = r.amount * p.price;
    if (usd < MIN_TOKEN_USD) {
      droppedDust++;
      continue;
    }
    totalUsd += usd;
    tokens.push({ symbol: r.symbol || r.coinId, amount: r.amount, usd });

    const tickered = hasCuratedSymbol(r.symbol);
    const rowId = `${wallet.id}:${r.contract ?? (r.symbol || r.coinId)}`;
    rows.push({
      id: rowId,
      symbol: tickered ? `${r.symbol.toUpperCase()}-USD` : null,
      name: r.symbol || r.coinId,
      type: "crypto",
      quantity: r.amount,
      costBasis: priorCostBasis.get(rowId) ?? null,
      manualValue: tickered ? null : usd,
      isoCurrencyCode: "USD",
      walletId: wallet.id,
      contractAddress: r.contract,
      createdAt: now,
      updatedAt: now,
    });
  }

  // Replace this wallet's holdings atomically.
  db.transaction((tx) => {
    tx.delete(manualHoldings).where(eq(manualHoldings.walletId, wallet.id)).run();
    if (rows.length > 0) tx.insert(manualHoldings).values(rows).run();
    tx.update(wallets)
      .set({
        lastSyncedAt: now,
        lastValueUsd: totalUsd,
        lastTokenCount: rows.length,
        lastError: null,
        updatedAt: now,
      })
      .where(eq(wallets.id, wallet.id))
      .run();
  });

  tokens.sort((a, b) => b.usd - a.usd);
  return { kept: rows.length, droppedJunk, droppedDust, totalUsd, tokens };
}
