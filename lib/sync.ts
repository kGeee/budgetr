import { db } from "@/db";
import { accounts, holdings, items, securities, transactions, balanceSnapshots } from "@/db/schema";
import { plaid } from "@/lib/plaid";
import { decrypt } from "@/lib/crypto";
import { signedBalance } from "@/lib/utils";
import { eq } from "drizzle-orm";
import type { Item } from "@/db/schema";

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Pull account metadata + live balances, upsert accounts, write a daily snapshot. */
async function refreshAccounts(item: Item, accessToken: string) {
  const res = await plaid.accountsBalanceGet({ access_token: accessToken });
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
    const res = await plaid.transactionsSync({
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

  return { added: added.length, modified: modified.length, removed: removed.length };
}

/** Pull investment holdings + securities (no-op for non-investment items). */
async function syncInvestments(accessToken: string) {
  try {
    const res = await plaid.investmentsHoldingsGet({ access_token: accessToken });
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
  } catch (err: unknown) {
    // Item has no investment accounts / product not enabled — that's fine.
    const code = (err as { response?: { data?: { error_code?: string } } })?.response?.data
      ?.error_code;
    if (code && code !== "PRODUCTS_NOT_SUPPORTED" && code !== "NO_INVESTMENT_ACCOUNTS") {
      console.warn(`investments sync skipped (${code})`);
    }
  }
}

export async function syncItem(item: Item) {
  const accessToken = decrypt(item.accessToken);
  // Accounts first so FK targets exist for transactions/holdings.
  await refreshAccounts(item, accessToken);
  const tx = await syncTransactions(item, accessToken);
  await syncInvestments(accessToken);

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
