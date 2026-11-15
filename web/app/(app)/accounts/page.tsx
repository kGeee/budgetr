import Link from "next/link";
import { PlaidLink } from "@/components/onboarding/plaid-link";
import { PageHead } from "@/components/page-head";
import { Hero, Mark } from "@/components/ui/statement";
import { AccountVisibilityToggle } from "@/components/account-visibility-toggle";
import {
  ConnectWalletButton,
  WalletConnectionRows,
} from "@/components/portfolio/connect-wallet-dialog";
import { ConnectionAlert, ConnectionState } from "@/components/connection-status";
import { DisconnectInstitution } from "@/components/disconnect-institution";
import { getConnectionSummary, type ConnectionHealth } from "@/lib/connection-health";
import { hasPlaidCredentials } from "@/lib/plaid";
import { getAccounts, getHiddenWalletTokens, getWallets } from "@/lib/queries";
import { formatCurrency, formatMoney, isLiability, signedBalance } from "@/lib/utils";
import { convertToDisplay, getDisplayCurrency } from "@/lib/currency";
import { demoEnabled } from "@/lib/site";
import { accountsVerdict } from "@/lib/accounts-verdict";
import { groupAccountsByKind, type AccountKind } from "@/lib/account-groups";

export const dynamic = "force-dynamic";

/** Shown in a group's place when nothing of that kind is linked. */
const EMPTY_COPY: Record<AccountKind, string> = {
  cash: "Nothing linked. Connect a bank to track checking and savings.",
  investments: "Nothing linked. Connect a brokerage or retirement account to track it here.",
  cards: "Nothing linked. Connect a card to track what is owed on it.",
  loans: "Nothing linked. Connect an account to track a mortgage, car or student loan.",
  other: "Nothing here.",
};

// One column template per list, shared by its header rule and every row so the
// figures line up without a <table> (the rows hold buttons and wrap on mobile
// inside an overflow box instead).
const ACCOUNT_GRID =
  "grid grid-cols-[minmax(200px,1.5fr)_minmax(170px,1.2fr)_minmax(150px,1fr)_130px_108px] gap-5";
const CONNECTION_GRID =
  "grid grid-cols-[minmax(200px,1.5fr)_minmax(170px,1.2fr)_minmax(150px,1fr)_280px] gap-5";

/** "Jul 15, 9:41 AM" — when a balance or a link last actually reported. */
function formatSyncTime(at: Date): string {
  return at.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatSyncDay(at: Date): string {
  return at.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

const DOT: Record<ConnectionHealth["state"], string> = {
  live: "bg-[var(--jade)]",
  stale: "bg-[var(--brass)]",
  error: "bg-[var(--coral)]",
};

export default function AccountsPage() {
  const accounts = getAccounts();
  const wallets = getWallets();
  const hiddenWalletTokens = getHiddenWalletTokens();
  const connections = getConnectionSummary();
  // Health keyed by item, matching the Connections rows below — keying by name
  // would let two links to the same bank share one chip.
  const healthByItem = new Map<string, ConnectionHealth>(
    connections.all.map((c) => [c.itemId, c]),
  );
  const demo = demoEnabled();

  // Connections are keyed by the owning item, not by display name: two links
  // can carry the same institution name, and disconnect acts on one item — so
  // the row and the button have to agree on which link they mean.
  const byItem = new Map<string, { label: string; source: string | null; accts: typeof accounts }>();
  for (const a of accounts) {
    const key = a.itemId;
    const group = byItem.get(key);
    if (group) group.accts.push(a);
    else byItem.set(key, { label: a.institutionName ?? "Other", source: a.itemSource, accts: [a] });
  }
  // A Plaid link with no accounts (e.g. NO_ACCOUNTS) still needs a row — it's
  // the one that most needs disconnecting.
  for (const c of connections.all) {
    if (!byItem.has(c.itemId)) {
      byItem.set(c.itemId, { label: c.institutionName, source: "plaid", accts: [] });
    }
  }
  // The 'manual' container isn't a link — nothing syncs it and there is nothing
  // to revoke, so it feeds account rows but never appears under Connections.
  const links = [...byItem.entries()].filter(([, v]) => v.source === "plaid");

  // Mixed source currencies — convert each account into the display currency
  // before summing so the total is meaningful. Excluded accounts are hidden from
  // the net total (but still listed, dimmed, so they can be un-hidden).
  const displayCurrency = getDisplayCurrency();
  const visible = accounts.filter((a) => !a.excluded);
  const hiddenCount = accounts.length - visible.length;
  const net = visible.reduce(
    (s, a) => s + convertToDisplay(signedBalance(a.type, a.currentBalance), a.currency),
    0,
  );
  // The two halves of that net, for the sentence and the strip under the hero.
  // A liability's balance is what is owed, so it is summed unsigned.
  const assets = visible
    .filter((a) => !isLiability(a.type))
    .reduce((s, a) => s + convertToDisplay(a.currentBalance ?? 0, a.currency), 0);
  const liabilities = visible
    .filter((a) => isLiability(a.type))
    .reduce((s, a) => s + convertToDisplay(a.currentBalance ?? 0, a.currency), 0);
  const verdict = accountsVerdict({ count: visible.length, assets, liabilities });

  // Accounts by what the money is. The institution becomes a column.
  const groups = groupAccountsByKind(
    accounts.map((a) => ({ ...a, excluded: !!a.excluded })),
    (a) => convertToDisplay(signedBalance(a.type, a.currentBalance), a.currency),
  );
  const subtotalOf = (kind: AccountKind) => groups.find((g) => g.kind === kind)?.subtotal ?? 0;
  const cash = subtotalOf("cash");
  const invested = subtotalOf("investments");
  // Assets that are neither cash nor invested (Plaid's "other" type).
  const otherAssets = Math.max(0, assets - cash - invested);
  // What the bar under the hero is drawn against: everything held plus
  // everything owed, so each segment is a share of the whole picture.
  const gross = Math.max(0, cash) + Math.max(0, invested) + otherAssets + liabilities;
  const segments = [
    { key: "cash", value: Math.max(0, cash), className: "bg-[var(--brass)]" },
    { key: "invested", value: Math.max(0, invested), className: "bg-[var(--jade)]" },
    { key: "other", value: otherAssets, className: "bg-[var(--muted)]" },
    { key: "owed", value: liabilities, className: "bg-[var(--coral)]" },
  ].filter((seg) => seg.value > 0.005);

  const connectionCount = links.length + wallets.length;
  const nothingConnected = accounts.length === 0 && wallets.length === 0;

  return (
    <div className="space-y-9">
      <PageHead title="Accounts" />

      <ConnectionAlert summary={connections} />

      <section
        className="rise flex flex-wrap items-end justify-between gap-x-10 gap-y-6"
        aria-label="Net across your accounts"
      >
        <Hero
          className="flex-[1_1_380px]"
          eyebrow={`Net across ${visible.length} ${visible.length === 1 ? "account" : "accounts"}`}
          figure={formatCurrency(net, displayCurrency)}
          tone={net < 0 ? "coral" : "default"}
          verdict={
            (verdict || hiddenCount > 0) && (
              <>
                {verdict && (
                  <>
                    {verdict.lead}
                    {verdict.amount != null && (
                      <>
                        {" "}
                        <Mark tone={verdict.tone}>
                          {formatCurrency(verdict.amount, displayCurrency)}
                        </Mark>{" "}
                        {verdict.tail}
                      </>
                    )}
                  </>
                )}
                {hiddenCount > 0 && (
                  <span className="text-[var(--muted)]">
                    {verdict ? " " : ""}
                    {hiddenCount === 1
                      ? "One account is hidden and left out of this figure."
                      : `${hiddenCount} accounts are hidden and left out of this figure.`}
                  </span>
                )}
              </>
            )
          }
        >
          {gross > 0.005 && (
            <div className="flex max-w-[520px] flex-col gap-2.5">
              <div
                role="img"
                aria-label={`Assets ${formatCurrency(assets, displayCurrency)} against ${formatCurrency(liabilities, displayCurrency)} owed`}
                className="flex h-1 gap-0.5 overflow-hidden rounded-full"
              >
                {segments.map((seg) => (
                  <span
                    key={seg.key}
                    className={`min-w-1 ${seg.className}`}
                    style={{ width: `${(seg.value / gross) * 100}%` }}
                  />
                ))}
              </div>
              <dl className="mono flex flex-wrap gap-x-6 gap-y-2 text-[13px]">
                <div className="flex gap-1.5">
                  <dt className="text-[var(--muted)]">Cash</dt>
                  <dd>{formatCurrency(cash, displayCurrency)}</dd>
                </div>
                <div className="flex gap-1.5">
                  <dt className="text-[var(--muted)]">Invested</dt>
                  <dd>{formatCurrency(invested, displayCurrency)}</dd>
                </div>
                {otherAssets > 0.005 && (
                  <div className="flex gap-1.5">
                    <dt className="text-[var(--muted)]">Other</dt>
                    <dd>{formatCurrency(otherAssets, displayCurrency)}</dd>
                  </div>
                )}
                <div className="flex gap-1.5">
                  <dt className="text-[var(--muted)]">Owed</dt>
                  <dd className={liabilities > 0.005 ? "text-[var(--coral)]" : undefined}>
                    {formatCurrency(liabilities, displayCurrency)}
                  </dd>
                </div>
              </dl>
            </div>
          )}
        </Hero>

        {/* Read-only web demo: nothing to connect. */}
        {!demo && (
          <div className="flex max-w-full flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <PlaidLink />
              <ConnectWalletButton />
              <Link
                href="/investments"
                className="inline-flex min-h-11 items-center px-2 text-sm text-[var(--muted)] transition-colors hover:text-[var(--paper)]"
              >
                Manual holdings are added in Investments
              </Link>
            </div>
            {/* Plaid/Finnhub keys stay in Settings; say so where connecting needs them. */}
            <p className="text-[13px] text-[var(--muted)]">
              {hasPlaidCredentials() ? (
                <>
                  Plaid and Finnhub keys live in{" "}
                  <Link href="/settings#api-keys" className="text-[var(--brass)] hover:underline">
                    Settings → API keys
                  </Link>
                  .
                </>
              ) : (
                <>
                  <span className="text-[var(--coral)]">Plaid isn&apos;t configured</span> — add your
                  keys in{" "}
                  <Link href="/settings#api-keys" className="text-[var(--brass)] hover:underline">
                    Settings → API keys
                  </Link>{" "}
                  before connecting a bank.
                </>
              )}
            </p>
          </div>
        )}
      </section>

      {nothingConnected && (
        <p className="border-y border-line py-4 text-sm text-[var(--muted)]">
          No accounts connected yet. Use “Connect account” to link your card, brokerage, and bank,
          or “Connect wallet” to import an on-chain crypto address.
        </p>
      )}

      {accounts.length > 0 && (
        <section aria-label="Accounts by type">
          <div className="overflow-x-auto">
            <div className="min-w-[780px]">
              {groups.map((g, gi) => (
                <div key={g.kind} className={gi === 0 ? undefined : "pt-8"}>
                  <div
                    className={`${ACCOUNT_GRID} items-end border-b border-[var(--line-strong)] pb-2.5 text-xs text-[var(--muted)]`}
                  >
                    <h2 className="font-display text-lg tracking-tight text-[var(--paper)]">
                      {g.label}
                    </h2>
                    {/* Column names once, on the first rule; the grid carries them down. */}
                    <span>{gi === 0 ? "Source" : ""}</span>
                    <span>{gi === 0 ? "Balance as of" : ""}</span>
                    <span
                      className={`mono text-right text-[13px] ${
                        g.owed && g.subtotal < -0.005 ? "text-[var(--coral)]" : "text-[var(--paper)]"
                      }`}
                    >
                      {formatCurrency(g.subtotal, displayCurrency)}
                    </span>
                    <span />
                  </div>

                  {g.rows.length === 0 ? (
                    <p className="flex min-h-[58px] items-center border-b border-line text-sm text-[var(--muted)]">
                      {EMPTY_COPY[g.kind]}
                    </p>
                  ) : (
                    <ul>
                      {g.rows.map((a) => {
                        const health = healthByItem.get(a.itemId);
                        const manual = a.itemSource !== "plaid";
                        const frozen = health?.state === "error";
                        return (
                          <li
                            key={a.id}
                            className={`${ACCOUNT_GRID} min-h-[58px] items-center border-b border-line py-1.5`}
                          >
                            <span
                              className={`min-w-0 ${a.excluded ? "text-[var(--muted)]" : "text-[var(--paper)]"}`}
                            >
                              <span className="font-medium">{a.name}</span>
                              {a.mask && (
                                <span className="mono ml-1.5 text-xs text-[var(--muted)]">
                                  ••{a.mask}
                                </span>
                              )}
                              <span className="block text-xs capitalize text-[var(--muted)]">
                                {a.subtype ?? a.type}
                                {a.excluded && (
                                  <span className="normal-case"> · hidden from totals</span>
                                )}
                              </span>
                            </span>
                            <span className="min-w-0 truncate text-[13px] text-[var(--muted)]">
                              {manual ? "Added by hand" : `${a.institutionName ?? "Other"} · Plaid`}
                            </span>
                            {/* A frozen balance is still a real balance — say when
                                it stopped moving rather than hiding the row. */}
                            <span
                              className={`flex items-center gap-2 text-[13px] ${
                                frozen ? "text-[var(--coral)]" : "text-[var(--muted)]"
                              }`}
                            >
                              <span
                                aria-hidden
                                className={`h-[7px] w-[7px] shrink-0 rounded-full ${
                                  a.excluded || !health ? "bg-[var(--muted)]" : DOT[health.state]
                                }`}
                              />
                              {manual || !health
                                ? "Entered by hand"
                                : !health.lastSuccessAt
                                  ? "Never synced"
                                  : frozen
                                    ? `Frozen since ${formatSyncDay(health.lastSuccessAt)}`
                                    : formatSyncTime(health.lastSuccessAt)}
                            </span>
                            <span
                              className={`mono text-right ${
                                a.excluded
                                  ? "text-[var(--muted)]"
                                  : isLiability(a.type)
                                    ? "text-[var(--coral)]"
                                    : "text-[var(--paper)]"
                              }`}
                            >
                              {formatMoney(signedBalance(a.type, a.currentBalance), a.currency)}
                            </span>
                            <span className="flex justify-end">
                              <AccountVisibilityToggle id={a.id} excluded={a.excluded} />
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          </div>
          <p className="mt-3.5 text-[13px] text-[var(--muted)]">
            Hiding an account keeps its history but stops counting it toward net worth and the
            sidebar.
          </p>
        </section>
      )}

      {connectionCount > 0 && (
        <section aria-labelledby="connections-heading">
          <div className="overflow-x-auto">
            <div className="min-w-[780px]">
              <div
                className={`${CONNECTION_GRID} items-end border-b border-[var(--line-strong)] pb-2.5 text-xs text-[var(--muted)]`}
              >
                <h2
                  id="connections-heading"
                  className="font-display text-lg tracking-tight text-[var(--paper)]"
                >
                  Connections
                  {connections.total > 0 && (
                    <span className="mono ml-2 text-xs font-normal text-[var(--muted)]">
                      {connections.liveCount} of {connections.total} reporting
                    </span>
                  )}
                </h2>
                <span>Feeds</span>
                <span>Last successful sync</span>
                <span />
              </div>
              <ul>
                {links.map(([itemId, { label: institution, accts }]) => {
                  const health = healthByItem.get(itemId);
                  const broken = health?.state === "error";
                  return (
                    <li
                      key={itemId}
                      id={`conn-${itemId}`}
                      className="scroll-mt-24 border-b border-line"
                    >
                      <div className={`${CONNECTION_GRID} min-h-[58px] items-center py-1.5`}>
                        <span className="flex min-w-0 items-center gap-2.5">
                          <span className="truncate font-medium">{institution}</span>
                          {health && <ConnectionState health={health} />}
                        </span>
                        <span className="min-w-0 text-[13px] text-[var(--muted)]">
                          {accts.length === 0
                            ? "No accounts reported by this connection."
                            : accts.map((a) => a.name).join(", ")}
                        </span>
                        <span
                          className={`mono text-xs ${broken ? "text-[var(--coral)]" : "text-[var(--muted)]"}`}
                        >
                          {health?.lastSuccessAt ? formatSyncTime(health.lastSuccessAt) : "Never"}
                        </span>
                        <span className="flex items-center justify-end gap-2">
                          {/* Read-only demo: nothing to disconnect. */}
                          {!demo && (
                            <DisconnectInstitution
                              itemId={itemId}
                              institution={institution}
                              accountCount={accts.length}
                            />
                          )}
                        </span>
                      </div>
                      {/* The state word only carries the state; the why and the
                          fix belong in view whenever a link isn't healthy. There's
                          no Plaid update mode yet, so repair is disconnect +
                          Connect account. */}
                      {health && health.state !== "live" && (
                        <p
                          className={`pb-3 text-xs ${
                            broken ? "text-[var(--coral)]" : "text-[var(--muted)]"
                          }`}
                        >
                          {health.message}
                          {broken &&
                            !demo &&
                            " To repair it, disconnect this link and connect the bank again."}
                        </p>
                      )}
                    </li>
                  );
                })}
                <WalletConnectionRows
                  wallets={wallets}
                  hiddenTokens={hiddenWalletTokens}
                  gridClassName={CONNECTION_GRID}
                />
              </ul>
            </div>
          </div>
          <p className="mt-3.5 text-[13px] text-[var(--muted)]">
            If a connection breaks, its row turns coral and its accounts above read “Frozen since”
            with the date.
          </p>
        </section>
      )}
    </div>
  );
}
