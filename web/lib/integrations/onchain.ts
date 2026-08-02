/**
 * On-chain balance readers (server-side only) for connected crypto wallets.
 *
 * Each `fetch*` returns the raw token balances at an address — native coin plus
 * any fungible tokens — as human-scaled amounts. Pricing and junk-token
 * filtering happen later in lib/wallet-sync.ts against CoinGecko; this module
 * only reads chain state.
 *
 * Keyless by default:
 *  - Bitcoin  — mempool.space (no key).
 *  - Ethereum — native ETH via a public RPC (no key); ERC-20 tokens require an
 *    ALCHEMY_API_KEY (free tier). Without it, ETH wallets import native-only.
 *  - Solana   — native SOL + SPL tokens via the public RPC (no key). A
 *    HELIUS_API_KEY, if set, is used instead for reliability/rate limits.
 */

export type Chain = "bitcoin" | "ethereum" | "solana";

/** One balance line read from a wallet, as a human-scaled amount. */
export type OnchainBalance = {
  /** "native" for BTC/ETH/SOL, "token" for ERC-20 / SPL tokens. */
  kind: "native" | "token";
  /** Best-known ticker symbol (may be empty for obscure tokens). */
  symbol: string;
  /** Contract (ETH) / mint (SOL) address; undefined for native coins. */
  contract?: string;
  /** Balance in whole units (already divided by decimals). */
  amount: number;
};

/** Basic per-chain address shape checks (cheap sanity gate, not full validation). */
export function isValidAddress(chain: Chain, address: string): boolean {
  const a = address.trim();
  switch (chain) {
    case "bitcoin":
      return /^(bc1[a-z0-9]{20,80}|[13][a-km-zA-HJ-NP-Z1-9]{25,39})$/.test(a);
    case "ethereum":
      return /^0x[0-9a-fA-F]{40}$/.test(a);
    case "solana":
      return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a);
  }
}

const SATS = 1e8;
const LAMPORTS = 1e9;
const WEI = 1e18;

/** JSON-RPC helper. */
async function rpc<T>(url: string, method: string, params: unknown[]): Promise<T | null> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { result?: T; error?: unknown };
    if (json.error || json.result === undefined) return null;
    return json.result;
  } catch {
    return null;
  }
}

// ── Bitcoin ──────────────────────────────────────────────────────────────────

export async function fetchBitcoin(address: string): Promise<OnchainBalance[]> {
  const res = await fetch(`https://mempool.space/api/address/${encodeURIComponent(address)}`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Bitcoin lookup failed (${res.status})`);
  const d = (await res.json()) as {
    chain_stats?: { funded_txo_sum?: number; spent_txo_sum?: number };
    mempool_stats?: { funded_txo_sum?: number; spent_txo_sum?: number };
  };
  const chain = (d.chain_stats?.funded_txo_sum ?? 0) - (d.chain_stats?.spent_txo_sum ?? 0);
  const mempool = (d.mempool_stats?.funded_txo_sum ?? 0) - (d.mempool_stats?.spent_txo_sum ?? 0);
  const btc = (chain + mempool) / SATS;
  return btc > 0 ? [{ kind: "native", symbol: "BTC", amount: btc }] : [];
}

// ── Ethereum ─────────────────────────────────────────────────────────────────

const ETH_RPC = "https://ethereum-rpc.publicnode.com";

export async function fetchEthereum(address: string): Promise<OnchainBalance[]> {
  const out: OnchainBalance[] = [];

  // Native ETH (public RPC, no key).
  const balHex = await rpc<string>(ETH_RPC, "eth_getBalance", [address, "latest"]);
  if (balHex) {
    const eth = Number(BigInt(balHex)) / WEI;
    if (eth > 0) out.push({ kind: "native", symbol: "ETH", amount: eth });
  }

  // ERC-20 tokens require Alchemy (free tier). Skipped gracefully without a key.
  const alchemyKey = process.env.ALCHEMY_API_KEY;
  if (!alchemyKey) return out;
  const alchemyUrl = `https://eth-mainnet.g.alchemy.com/v2/${alchemyKey}`;

  const balances = await rpc<{ tokenBalances?: Array<{ contractAddress: string; tokenBalance: string }> }>(
    alchemyUrl,
    "alchemy_getTokenBalances",
    [address, "erc20"],
  );
  const nonZero = (balances?.tokenBalances ?? []).filter(
    (t) => t.tokenBalance && /^0x0*[1-9a-f]/i.test(t.tokenBalance),
  );
  // Fetch decimals per token (metadata) so we can scale the raw balance.
  for (const t of nonZero) {
    const meta = await rpc<{ decimals?: number; symbol?: string }>(
      alchemyUrl,
      "alchemy_getTokenMetadata",
      [t.contractAddress],
    );
    const decimals = meta?.decimals ?? 18;
    const raw = BigInt(t.tokenBalance);
    const amount = Number(raw) / 10 ** decimals;
    if (amount > 0) {
      out.push({
        kind: "token",
        symbol: (meta?.symbol ?? "").toUpperCase(),
        contract: t.contractAddress.toLowerCase(),
        amount,
      });
    }
  }
  return out;
}

// ── Solana ───────────────────────────────────────────────────────────────────

const SOL_TOKEN_PROGRAMS = [
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", // SPL Token
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb", // Token-2022
];

function solRpcUrl(): string {
  const key = process.env.HELIUS_API_KEY;
  return key
    ? `https://mainnet.helius-rpc.com/?api-key=${key}`
    : "https://api.mainnet-beta.solana.com";
}

type SolTokenAccounts = {
  value?: Array<{
    account?: {
      data?: {
        parsed?: {
          info?: { mint?: string; tokenAmount?: { uiAmount?: number | null } };
        };
      };
    };
  }>;
};

export async function fetchSolana(address: string): Promise<OnchainBalance[]> {
  const url = solRpcUrl();
  const out: OnchainBalance[] = [];

  const bal = await rpc<{ value?: number }>(url, "getBalance", [address]);
  const sol = (bal?.value ?? 0) / LAMPORTS;
  if (sol > 0) out.push({ kind: "native", symbol: "SOL", amount: sol });

  for (const programId of SOL_TOKEN_PROGRAMS) {
    const accts = await rpc<SolTokenAccounts>(url, "getTokenAccountsByOwner", [
      address,
      { programId },
      { encoding: "jsonParsed" },
    ]);
    for (const acc of accts?.value ?? []) {
      const info = acc.account?.data?.parsed?.info;
      const mint = info?.mint;
      const amount = info?.tokenAmount?.uiAmount ?? 0;
      if (mint && amount > 0) {
        out.push({ kind: "token", symbol: "", contract: mint, amount });
      }
    }
  }
  return out;
}

/** Read all balances at an address for the given chain. */
export function fetchWalletBalances(chain: Chain, address: string): Promise<OnchainBalance[]> {
  switch (chain) {
    case "bitcoin":
      return fetchBitcoin(address);
    case "ethereum":
      return fetchEthereum(address);
    case "solana":
      return fetchSolana(address);
  }
}
