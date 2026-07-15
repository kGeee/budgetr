import { db } from "@/db";
import {
  accounts,
  holdings,
  investmentTransactions,
  items,
  securities,
  transactions,
  balanceSnapshots,
  recurringStreams,
} from "@/db/schema";
import { getPlaidClient, getPlaidEnv } from "@/lib/plaid";
import { decrypt } from "@/lib/crypto";
import { applyTagRules } from "@/lib/tag-rules";
import { signedBalance } from "@/lib/utils";
import { eq, inArray } from "drizzle-orm";
import type { Item } from "@/db/schema";
import type { TransactionStream } from "plaid";

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Pull account metadata + live balances, upsert accounts, write a daily snapshot. */
async function refreshAccounts(item: Item, accessToken: string) {
  const res = await getPlaidClient().accountsBalanceGet({ access_token: accessToken });
  const now = new Date();
  const date = todayStr();

  for (const a of res.data.accounts) {
    const row = {
      id: a.account_id,
      itemId: item.id,
      name: a.name,
      officialName: a.official_name ?? null,
      mask: a.mask ?? null,
      type: String(a.type),
      subtype: a.subtype ? String(a.subtype) : null,
      currentBalance: a.balances.current ?? null,
      availableBalance: a.balances.available ?? null,
      isoCurrencyCode: a.balances.iso_currency_code ?? null,
      updatedAt: now,
    };

    db.insert(accounts)
      .values(row)
      .onConflictDoUpdate({
        target: accounts.id,
        set: {
          name: row.name,
          officialName: row.officialName,
          mask: row.mask,
          type: row.type,
          subtype: row.subtype,
          currentBalance: row.currentBalance,
          availableBalance: row.availableBalance,
          isoCurrencyCode: row.isoCurrencyCode,
          updatedAt: row.updatedAt,
        },
      })
      .run();

    // One signed snapshot per account per day (assets +, liabilities -).
    db.insert(balanceSnapshots)
      .values({
        accountId: a.account_id,
        date,
        balance: signedBalance(row.type, row.currentBalance),
        type: row.type,
        isoCurrencyCode: row.isoCurrencyCode,
      })
      .onConflictDoUpdate({
        target: [balanceSnapshots.accountId, balanceSnapshots.date],
        set: { balance: signedBalance(row.type, row.currentBalance), type: row.type },
      })
      .run();
  }
}

/** Cursor-based transaction sync. Handles added / modified / removed. */
async function syncTransactions(item: Item, accessToken: string) {
  let cursor = item.transactionsCursor ?? undefined;
  let hasMore = true;
  const added = [];
  const modified = [];
  const removed: string[] = [];

  while (hasMore) {
    const res = await getPlaidClient().transactionsSync({
      access_token: accessToken,
      cursor,
      count: 500,
    });
    added.push(...res.data.added);
    modified.push(...res.data.modified);
    removed.push(...res.data.removed.map((r) => r.transaction_id));
    hasMore = res.data.has_more;
    cursor = res.data.next_cursor;
  }

  for (const t of [...added, ...modified]) {
    const row = {
      id: t.transaction_id,
      accountId: t.account_id,
      amount: t.amount,
      isoCurrencyCode: t.iso_currency_code ?? null,
      date: t.date,
      name: t.name,
      merchantName: t.merchant_name ?? null,
      category: t.personal_finance_category?.primary ?? null,
      categoryDetailed: t.personal_finance_category?.detailed ?? null,
      pending: t.pending,
      paymentChannel: t.payment_channel ?? null,
    };
    db.insert(transactions)
      .values(row)
      .onConflictDoUpdate({
        target: transactions.id,
        set: {
          amount: row.amount,
          date: row.date,
          name: row.name,
          merchantName: row.merchantName,
          category: row.category,
          categoryDetailed: row.categoryDetailed,
          pending: row.pending,
          paymentChannel: row.paymentChannel,
        },
      })
      .run();
  }

  for (const id of removed) {
    db.delete(transactions).where(eq(transactions.id, id)).run();
  }

  db.update(items)
    .set({ transactionsCursor: cursor ?? null, updatedAt: new Date() })
    .where(eq(items.id, item.id))
    .run();

  // Auto-tag the rows we just touched.
  const touched = [...added, ...modified].map((t) => t.transaction_id);
  applyTagRules(touched);

  return { added: added.length, modified: modified.length, removed: removed.length };
}

/** Pull investment holdings + securities (no-op for non-investment items). */
async function syncInvestments(accessToken: string) {
  try {
    const res = await getPlaidClient().investmentsHoldingsGet({ access_token: accessToken });
    const now = new Date();

    for (const s of res.data.securities) {
      db.insert(securities)
        .values({
          id: s.security_id,
          name: s.name ?? null,
          tickerSymbol: s.ticker_symbol ?? null,
          type: s.type ? String(s.type) : null,
          closePrice: s.close_price ?? null,
          isoCurrencyCode: s.iso_currency_code ?? null,
        })
        .onConflictDoUpdate({
          target: securities.id,
          set: {
            name: s.name ?? null,
            tickerSymbol: s.ticker_symbol ?? null,
            closePrice: s.close_price ?? null,
          },
        })
        .run();
    }

    for (const h of res.data.holdings) {
      const id = `${h.account_id}:${h.security_id}`;
      db.insert(holdings)
        .values({
          id,
          accountId: h.account_id,
          securityId: h.security_id,
          quantity: h.quantity,
          costBasis: h.cost_basis ?? null,
          institutionPrice: h.institution_price ?? null,
          institutionValue: h.institution_value ?? null,
          isoCurrencyCode: h.iso_currency_code ?? null,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: holdings.id,
          set: {
            quantity: h.quantity,
            costBasis: h.cost_basis ?? null,
            institutionPrice: h.institution_price ?? null,
            institutionValue: h.institution_value ?? null,
            updatedAt: now,
          },
        })
        .run();
    }

    // Prune positions Plaid no longer reports (sold out, transferred away).
    // Scope the delete to this item's investment accounts so we never touch
    // another item's holdings, and key off the present holding ids.
    const presentIds = new Set(
      res.data.holdings.map((h) => `${h.account_id}:${h.security_id}`),
    );
    const investmentAccountIds = res.data.accounts.map((a) => a.account_id);
    if (investmentAccountIds.length > 0) {
      const existing = db
        .select({ id: holdings.id })
        .from(holdings)
        .where(inArray(holdings.accountId, investmentAccountIds))
        .all();
      for (const row of existing) {
        if (!presentIds.has(row.id)) {
          db.delete(holdings).where(eq(holdings.id, row.id)).run();
        }
      }
    }
  } catch (err: unknown) {
    // Item has no investment accounts / product not enabled — that's fine.
    const code = (err as { response?: { data?: { error_code?: string } } })?.response?.data
      ?.error_code;
    if (code && code !== "PRODUCTS_NOT_SUPPORTED" && code !== "NO_INVESTMENT_ACCOUNTS") {
      console.warn(`investments sync skipped (${code})`);
    }
  }
}

/**
 * Pull investment transactions (buys/sells/dividends/fees) over a trailing
 * 2-year window. This is the historical ledger powering accurate portfolio
 * reconstruction and per-ticker trade markers. Paginates via offset/count.
 */
async function syncInvestmentTransactions(accessToken: string) {
  try {
    const end = todayStr();
    const startDate = new Date();
    startDate.setFullYear(startDate.getFullYear() - 2);
    const start = startDate.toISOString().slice(0, 10);

    // FK safety: only persist transactions for accounts we already have.
    const knownAccounts = new Set(
      db.select({ id: accounts.id }).from(accounts).all().map((a) => a.id),
    );

    let offset = 0;
    let total = Infinity;
    while (offset < total) {
      const res = await getPlaidClient().investmentsTransactionsGet({
        access_token: accessToken,
        start_date: start,
        end_date: end,
        options: { count: 500, offset },
      });
      total = res.data.total_investment_transactions;

      // Upsert securities referenced here first (may include sold-out positions
      // absent from current holdings) so the security_id FK targets exist.
      for (const s of res.data.securities) {
        db.insert(securities)
          .values({
            id: s.security_id,
            name: s.name ?? null,
            tickerSymbol: s.ticker_symbol ?? null,
            type: s.type ? String(s.type) : null,
            closePrice: s.close_price ?? null,
            isoCurrencyCode: s.iso_currency_code ?? null,
          })
          .onConflictDoUpdate({
            target: securities.id,
            set: {
              name: s.name ?? null,
              tickerSymbol: s.ticker_symbol ?? null,
              closePrice: s.close_price ?? null,
            },
          })
          .run();
      }

      for (const it of res.data.investment_transactions) {
        if (!knownAccounts.has(it.account_id)) continue;
        const row = {
          id: it.investment_transaction_id,
          accountId: it.account_id,
          securityId: it.security_id ?? null,
          date: it.date,
          name: it.name,
          type: it.type ? String(it.type) : null,
          subtype: it.subtype ? String(it.subtype) : null,
          quantity: it.quantity ?? null,
          amount: it.amount ?? null,
          price: it.price ?? null,
          fees: it.fees ?? null,
          isoCurrencyCode: it.iso_currency_code ?? null,
        };
        db.insert(investmentTransactions)
          .values(row)
          .onConflictDoUpdate({
            target: investmentTransactions.id,
            set: {
              securityId: row.securityId,
              date: row.date,
              name: row.name,
              type: row.type,
              subtype: row.subtype,
              quantity: row.quantity,
              amount: row.amount,
              price: row.price,
              fees: row.fees,
            },
          })
          .run();
      }

      const fetched = res.data.investment_transactions.length;
      if (fetched === 0) break;
      offset += fetched;
    }
  } catch (err: unknown) {
    const code = (err as { response?: { data?: { error_code?: string } } })?.response?.data
      ?.error_code;
    if (code && code !== "PRODUCTS_NOT_SUPPORTED" && code !== "NO_INVESTMENT_ACCOUNTS") {
      console.warn(`investment transactions sync skipped (${code})`);
    }
  }
}

/** Pull recurring transaction streams (subscriptions, paychecks, bills). */
async function syncRecurring(accessToken: string) {
  try {
    const res = await getPlaidClient().transactionsRecurringGet({ access_token: accessToken });
    const now = new Date();

    // Only persist streams whose account we actually have (FK safety).
    const knownAccounts = new Set(
      db.select({ id: accounts.id }).from(accounts).all().map((a) => a.id),
    );

    const upsert = (s: TransactionStream, direction: "inflow" | "outflow") => {
      if (!knownAccounts.has(s.account_id)) return;
      const row = {
        id: s.stream_id,
        accountId: s.account_id,
        direction,
        description: s.description ?? null,
        merchantName: s.merchant_name ?? null,
        category: s.personal_finance_category?.primary ?? null,
        frequency: s.frequency ? String(s.frequency) : null,
        averageAmount: s.average_amount?.amount ?? null,
        lastAmount: s.last_amount?.amount ?? null,
        lastDate: s.last_date ?? null,
        predictedNextDate: s.predicted_next_date ?? null,
        isoCurrencyCode: s.average_amount?.iso_currency_code ?? null,
        isActive: s.is_active,
        status: s.status ? String(s.status) : null,
        updatedAt: now,
      };
      db.insert(recurringStreams)
        .values(row)
        .onConflictDoUpdate({ target: recurringStreams.id, set: row })
        .run();
    };

    for (const s of res.data.inflow_streams) upsert(s, "inflow");
    for (const s of res.data.outflow_streams) upsert(s, "outflow");
  } catch (err: unknown) {
    const code = (err as { response?: { data?: { error_code?: string } } })?.response?.data
      ?.error_code;
    if (code && code !== "PRODUCTS_NOT_SUPPORTED" && code !== "NO_ACCOUNTS") {
      console.warn(`recurring sync skipped (${code})`);
    }
  }
}

export async function syncItem(item: Item) {
  // Plaid access tokens are environment-scoped. If PLAID_ENV changed since this
  // item was linked (e.g. sandbox -> production), the stored token is invalid
  // and Plaid would return an opaque INVALID_ACCESS_TOKEN. Fail fast with a
  // clear, actionable message instead.
  const currentEnv = getPlaidEnv();
  if (item.plaidEnv && item.plaidEnv !== currentEnv) {
    throw new Error(
      `Item "${item.institutionName ?? item.id}" was linked under Plaid env "${item.plaidEnv}" ` +
        `but the app is now running Plaid env "${currentEnv}". Plaid access tokens do not carry ` +
        `over between environments — re-link this account (run "npm run db:reset-items" to clear ` +
        `stale links, then use Connect again).`,
    );
  }

  const accessToken = decrypt(item.accessToken);
  // Accounts first so FK targets exist for transactions/holdings.
  await refreshAccounts(item, accessToken);
  const tx = await syncTransactions(item, accessToken);
  await syncInvestments(accessToken);
  await syncInvestmentTransactions(accessToken);
  await syncRecurring(accessToken);

  db.update(items)
    .set({ status: "active", error: null, updatedAt: new Date() })
    .where(eq(items.id, item.id))
    .run();

  return tx;
}

export async function syncAllItems() {
  const all = db.select().from(items).all();
  const results: Record<string, unknown> = {};
  for (const item of all) {
    try {
      results[item.institutionName ?? item.id] = await syncItem(item);
    } catch (err: unknown) {
      const code =
        (err as { response?: { data?: { error_code?: string } } })?.response?.data?.error_code ??
        (err as Error)?.message;
      db.update(items)
        .set({ status: "error", error: String(code), updatedAt: new Date() })
        .where(eq(items.id, item.id))
        .run();
      results[item.institutionName ?? item.id] = { error: String(code) };
    }
  }
  return results;
}
