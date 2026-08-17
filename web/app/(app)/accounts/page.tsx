import { Card } from "@/components/ui/card";
import { PlaidLink } from "@/components/plaid-link";
import { PageHead } from "@/components/page-head";
import { AccountVisibilityToggle } from "@/components/account-visibility-toggle";
import { ConnectWalletButton, WalletsCard } from "@/components/connect-wallet-dialog";
import { ConnectionAlert, ConnectionChip } from "@/components/connection-status";
import { DisconnectInstitution } from "@/components/disconnect-institution";
import { getConnectionSummary, getHealthByInstitution } from "@/lib/connection-health";
import { getAccounts, getWallets } from "@/lib/queries";
import { formatCurrency, formatMoney, isLiability, signedBalance } from "@/lib/utils";
import { convertToDisplay, getDisplayCurrency } from "@/lib/currency";
import { demoEnabled } from "@/lib/site";

export const dynamic = "force-dynamic";

const TYPE_LABEL: Record<string, string> = {
  depository: "Cash",
  credit: "Credit",
  investment: "Investments",
  loan: "Loans",
};

export default function AccountsPage() {
  const accounts = getAccounts();
  const wallets = getWallets();
  const connections = getConnectionSummary();
  const healthByInstitution = getHealthByInstitution();

  // Grouped by the owning connection, not by display name: two links can carry
  // the same institution name, and disconnect acts on one item — so the card and
  // the button have to agree on which link they mean.
  const byItem = new Map<string, { label: string; source: string | null; accts: typeof accounts }>();
  for (const a of accounts) {
    const key = a.itemId;
    const group = byItem.get(key);
    if (group) group.accts.push(a);
    else byItem.set(key, { label: a.institutionName ?? "Other", source: a.itemSource, accts: [a] });
  }

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

  return (
    <div className="space-y-7">
      <PageHead
        title="Accounts"
        action={
          // Read-only web demo: nothing to connect.
          demoEnabled() ? undefined : (
            <div className="flex items-center gap-2">
              <ConnectWalletButton />
              <PlaidLink />
            </div>
          )
        }
      />

      <ConnectionAlert summary={connections} />

      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-display text-3xl tabular">
          {formatCurrency(net, displayCurrency)}
        </span>
        <span className="text-sm text-[var(--muted)]">
          net across {visible.length} {visible.length === 1 ? "account" : "accounts"}
          {hiddenCount > 0 && ` · ${hiddenCount} hidden`}
        </span>
      </div>

      {accounts.length === 0 && wallets.length === 0 && (
        <Card>
          <p className="text-sm text-[var(--muted)]">
            No accounts connected yet. Use “Connect account” to link your card, brokerage, and bank,
            or “Connect wallet” to import an on-chain crypto address.
          </p>
        </Card>
      )}

      <WalletsCard wallets={wallets} />

      <div className="space-y-5">
        {[...byItem.entries()].map(([itemId, { label: institution, source, accts }]) => {
          const subtotal = accts
            .filter((a) => !a.excluded)
            .reduce(
              (s, a) => s + convertToDisplay(signedBalance(a.type, a.currentBalance), a.currency),
              0,
            );
          const health = healthByInstitution.get(institution);
          return (
            <Card key={itemId} className="p-0">
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-line px-6 py-4">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-line bg-[var(--panel-2)] font-display text-sm text-[var(--brass)]">
                    {institution.charAt(0)}
                  </span>
                  <span className="truncate font-medium">{institution}</span>
                  {health && <ConnectionChip health={health} />}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="mono text-sm text-[var(--muted)]">
                    {formatCurrency(subtotal, displayCurrency)}
                  </span>
                  {/* Read-only demo: nothing to disconnect. The 'manual'
                      container isn't a link — its accounts are removed one by
                      one from where they were created. */}
                  {!demoEnabled() && source === "plaid" && (
                    <DisconnectInstitution
                      itemId={itemId}
                      institution={institution}
                      accountCount={accts.length}
                    />
                  )}
                </div>
              </div>
              <ul>
                {accts.map((a) => (
                  <li
                    key={a.id}
                    className="flex items-center justify-between gap-4 px-6 py-4 transition-colors hover:bg-[var(--panel-2)]"
                  >
                    <div className={`min-w-0 ${a.excluded ? "opacity-45" : ""}`}>
                      <p className="flex items-center gap-2 truncate text-sm font-medium">
                        <span className="truncate">
                          {a.name}
                          {a.mask && (
                            <span className="ml-1.5 mono text-xs text-[var(--muted)]">
                              ••{a.mask}
                            </span>
                          )}
                        </span>
                        {a.excluded && (
                          <span className="shrink-0 rounded-full border border-line px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-[var(--muted)]">
                            Hidden
                          </span>
                        )}
                      </p>
                      <p className="mt-0.5 text-xs text-[var(--muted)]">
                        <span className="text-[var(--brass)]">
                          {TYPE_LABEL[a.type] ?? a.type}
                        </span>
                        {a.subtype ? ` · ${a.subtype}` : ""}
                        {/* A frozen balance is still a real balance — say when
                            it stopped moving rather than hiding the row. */}
                        {health?.state === "error" && health.lastSuccessAt && (
                          <span className="text-[var(--coral)]">
                            {" · "}Frozen since{" "}
                            {health.lastSuccessAt.toLocaleDateString(undefined, {
                              month: "short",
                              day: "numeric",
                            })}
                          </span>
                        )}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <span
                        className={`mono text-sm ${a.excluded ? "opacity-45" : ""} ${
                          isLiability(a.type) ? "text-[var(--coral)]" : "text-[var(--paper)]"
                        }`}
                      >
                        {formatMoney(a.currentBalance ?? 0, a.currency)}
                      </span>
                      <AccountVisibilityToggle id={a.id} excluded={!!a.excluded} />
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
