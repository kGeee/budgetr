import { parseOccSymbol } from "@/lib/options";
import { getCboeOptionChain } from "@/lib/cboe";
import { getOptionChain, type OptionQuote } from "@/lib/yahoo";

/**
 * The live-chain context every options view needs: implied vol per OCC symbol,
 * the underlying's spot, and the raw contracts for the underlyings you hold.
 *
 * Extracted from the investments page so the Portfolio desk and the Options desk
 * assemble it identically. Only the expiries actually held are fetched, so an
 * SPY-sized chain doesn't get pulled in to price two legs.
 *
 * CBOE is primary — free, no auth, and it ships real Greeks. Yahoo now requires
 * an auth crumb (401 headless), so it's a best-effort fallback per symbol.
 */
export type OptionChainContext = {
  ivByOcc: Record<string, number>;
  underlyingPrices: Record<string, number>;
  chainByUnderlying: Record<string, OptionQuote[]>;
};

const EMPTY: OptionChainContext = { ivByOcc: {}, underlyingPrices: {}, chainByUnderlying: {} };

/** Build the context for a set of OCC-tickered legs (non-OCC entries ignored). */
export async function loadOptionChainContext(
  occSymbols: (string | null | undefined)[],
): Promise<OptionChainContext> {
  const expiriesByUnderlying = new Map<string, Set<string>>();
  for (const symbol of occSymbols) {
    const p = parseOccSymbol(symbol);
    if (!p) continue;
    const set = expiriesByUnderlying.get(p.underlying) ?? new Set<string>();
    set.add(p.expiry);
    expiriesByUnderlying.set(p.underlying, set);
  }
  if (expiriesByUnderlying.size === 0) return EMPTY;

  const chains = await Promise.all(
    [...expiriesByUnderlying.entries()].map(async ([underlying, expiries]) => {
      const list = [...expiries];
      const chain =
        (await getCboeOptionChain(underlying, list)) ?? (await getOptionChain(underlying, list));
      return [underlying, chain] as const;
    }),
  );

  const ctx: OptionChainContext = { ivByOcc: {}, underlyingPrices: {}, chainByUnderlying: {} };
  for (const [underlying, chain] of chains) {
    if (!chain) continue;
    Object.assign(ctx.ivByOcc, chain.ivByOcc);
    if (chain.underlyingPrice != null) ctx.underlyingPrices[underlying] = chain.underlyingPrice;
    if (chain.contracts.length) ctx.chainByUnderlying[underlying] = chain.contracts;
  }
  return ctx;
}
