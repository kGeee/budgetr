/**
 * Wallet junk filter + cost basis: the pieces that have to survive a re-sync.
 *
 * Wallet holdings are rebuilt by delete+insert on every sync, so everything the
 * user decides about a token (hide it, what it cost) lives in wallet_token_rules
 * and has to be re-applied by the next sync. These tests drive syncWallet against
 * a scratch DB (DEMO_DB gives an isolated temp file) with the chain + price feeds
 * mocked, and assert exactly that.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import type { OnchainBalance } from "@/lib/onchain";

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

/** Chain balances the mocked reader returns; swapped per test. */
const chainBalances: { current: OnchainBalance[] } = { current: [] };

vi.mock("@/lib/onchain", () => ({
  fetchWalletBalances: async () => chainBalances.current,
  isValidAddress: () => true,
}));

const USD_PER_COIN: Record<string, number> = { ethereum: 2000, realcoin: 5, dustcoin: 0.01 };

vi.mock("@/lib/coingecko", () => ({
  NATIVE_COIN_ID: { bitcoin: "bitcoin", ethereum: "ethereum", solana: "solana" },
  hasCuratedSymbol: (s: string) => s.toUpperCase() === "ETH",
  getContractIdMap: async () => ({
    ethereum: new Map([
      ["0xreal", { id: "realcoin", symbol: "REAL" }],
      ["0xdust", { id: "dustcoin", symbol: "DUST" }],
    ]),
    solana: new Map(),
  }),
  getUsdPricesByIds: async (ids: string[]) =>
    Object.fromEntries(
      ids.filter((id) => USD_PER_COIN[id] != null).map((id) => [id, { price: USD_PER_COIN[id], change24h: null }]),
    ),
}));

const WALLET = { id: "wallet:ethereum:0xabc", chain: "ethereum", address: "0xabc" };
const NATIVE_ID = `${WALLET.id}:ETH`;
const REAL_ID = `${WALLET.id}:0xreal`;

type Mod = {
  db: typeof import("@/db")["db"];
  schema: typeof import("@/db/schema");
  syncWallet: typeof import("@/lib/wallet-sync")["syncWallet"];
  actions: typeof import("@/lib/actions/core");
};
let m: Mod;

beforeAll(async () => {
  // DEMO_DB routes @/db at a throwaway temp file seeded with the full schema.
  process.env.DEMO_DB = "1";
  m = {
    db: (await import("@/db")).db,
    schema: await import("@/db/schema"),
    syncWallet: (await import("@/lib/wallet-sync")).syncWallet,
    actions: await import("@/lib/actions/core"),
  };
});

beforeEach(() => {
  const { db, schema } = m;
  db.delete(schema.manualHoldings).run();
  db.delete(schema.walletTokenRules).run();
  db.delete(schema.wallets).run();
  const now = new Date();
  db.insert(schema.wallets)
    .values({ ...WALLET, label: "Test wallet", createdAt: now, updatedAt: now })
    .run();
  chainBalances.current = [
    { kind: "native", symbol: "ETH", amount: 1 },
    { kind: "token", symbol: "REAL", contract: "0xreal", amount: 100 },
    { kind: "token", symbol: "DUST", contract: "0xdust", amount: 10 },
    { kind: "token", symbol: "SPAM", contract: "0xspam", amount: 1_000_000 },
  ];
});

const heldIds = () =>
  m.db
    .select({ id: m.schema.manualHoldings.id })
    .from(m.schema.manualHoldings)
    .all()
    .map((r) => r.id);

describe("syncWallet", () => {
  it("keeps priced tokens, drops untracked spam and sub-dollar dust", async () => {
    const res = await m.syncWallet(WALLET);
    expect(heldIds().sort()).toEqual([REAL_ID, NATIVE_ID].sort());
    expect(res.droppedJunk).toBe(1); // SPAM: no CoinGecko listing
    expect(res.droppedDust).toBe(1); // DUST: 10 × $0.01 = $0.10
    expect(res.totalUsd).toBe(2500);
  });

  it("skips hand-hidden tokens on every later sync", async () => {
    await m.syncWallet(WALLET);
    await m.actions.hideWalletToken(REAL_ID);
    expect(heldIds()).toEqual([NATIVE_ID]);

    const res = await m.syncWallet(WALLET);
    expect(heldIds()).toEqual([NATIVE_ID]);
    expect(res.droppedHidden).toBe(1);
    expect(res.totalUsd).toBe(2000); // the hidden $500 stays out of the total
  });

  it("re-applies a user-set cost basis to the rebuilt row", async () => {
    await m.syncWallet(WALLET);
    await m.actions.updateManualHolding(REAL_ID, { costBasis: 250 });
    await m.syncWallet(WALLET);
    const row = m.db
      .select()
      .from(m.schema.manualHoldings)
      .where(eq(m.schema.manualHoldings.id, REAL_ID))
      .get();
    expect(row?.costBasis).toBe(250);
    expect(row?.quantity).toBe(100); // quantity stays chain-authoritative
  });

  it("honours a raised per-wallet dust floor", async () => {
    const res = await m.syncWallet({ ...WALLET, minValueUsd: 1000 });
    expect(heldIds()).toEqual([NATIVE_ID]); // $500 REAL now reads as dust
    expect(res.droppedDust).toBe(2);
  });
});

describe("hideWalletToken", () => {
  it("recomputes the wallet's snapshot totals so Accounts isn't stale", async () => {
    await m.syncWallet(WALLET);
    await m.actions.hideWalletToken(REAL_ID);
    const w = m.db.select().from(m.schema.wallets).all()[0];
    expect(w.lastValueUsd).toBe(2000);
    expect(w.lastTokenCount).toBe(1);
  });

  it("records the hidden token so it can be un-hidden later", async () => {
    await m.syncWallet(WALLET);
    await m.actions.hideWalletToken(REAL_ID);
    const rule = m.db.select().from(m.schema.walletTokenRules).all()[0];
    expect(rule).toMatchObject({ holdingId: REAL_ID, hidden: true, label: "REAL", hiddenValueUsd: 500 });

    await m.actions.unhideWalletToken(REAL_ID);
    expect(heldIds().sort()).toEqual([REAL_ID, NATIVE_ID].sort());
  });
});
