import { Card } from "@/components/ui/card";
import { PlaidLink } from "@/components/plaid-link";
import { PageHead } from "@/components/page-head";
import { getAccounts } from "@/lib/queries";
import { formatCurrency, isLiability, signedBalance } from "@/lib/utils";

export const dynamic = "force-dynamic";

const TYPE_LABEL: Record<string, string> = {
  depository: "Cash",
  credit: "Credit",
  investment: "Investments",
  loan: "Loans",
};

export default function AccountsPage() {
  const accounts = getAccounts();

  const byInstitution = new Map<string, typeof accounts>();
  for (const a of accounts) {
    const key = a.institutionName ?? "Other";
    if (!byInstitution.has(key)) byInstitution.set(key, []);
    byInstitution.get(key)!.push(a);
  }

  const net = accounts.reduce((s, a) => s + signedBalance(a.type, a.currentBalance), 0);

  return (
    <div className="space-y-7">
      <PageHead title="Accounts" action={<PlaidLink />} />

      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-display text-3xl tabular">{formatCurrency(net)}</span>
        <span className="text-sm text-[var(--muted)]">
          net across {accounts.length} {accounts.length === 1 ? "account" : "accounts"}
        </span>
      </div>

      {accounts.length === 0 && (
        <Card>
          <p className="text-sm text-[var(--muted)]">
            No accounts connected yet. Use “Connect account” to link your card, brokerage, and bank.
          </p>
        </Card>
      )}

      <div className="space-y-5">
        {[...byInstitution.entries()].map(([institution, accts]) => {
          const subtotal = accts.reduce(
            (s, a) => s + signedBalance(a.type, a.currentBalance),
            0,
          );
          return (
            <Card key={institution} className="p-0">
              <div className="flex items-center justify-between border-b border-line px-6 py-4">
                <div className="flex items-center gap-3">
                  <span className="grid h-8 w-8 place-items-center rounded-lg border border-line bg-[var(--panel-2)] font-display text-sm text-[var(--brass)]">
                    {institution.charAt(0)}
                  </span>
                  <span className="font-medium">{institution}</span>
                </div>
                <span className="mono text-sm text-[var(--muted)]">{formatCurrency(subtotal)}</span>
              </div>
              <ul>
                {accts.map((a) => (
                  <li
                    key={a.id}
                    className="flex items-center justify-between gap-4 px-6 py-4 transition-colors hover:bg-[var(--panel-2)]"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {a.name}
                        {a.mask && (
                          <span className="ml-1.5 mono text-xs text-[var(--muted)]">••{a.mask}</span>
                        )}
                      </p>
                      <p className="mt-0.5 text-xs text-[var(--muted)]">
                        <span className="text-[var(--brass)]">
                          {TYPE_LABEL[a.type] ?? a.type}
                        </span>
                        {a.subtype ? ` · ${a.subtype}` : ""}
                      </p>
                    </div>
                    <span
                      className={`mono shrink-0 text-sm ${
                        isLiability(a.type) ? "text-[var(--coral)]" : "text-[var(--paper)]"
                      }`}
                    >
                      {formatCurrency(a.currentBalance ?? 0, a.currency ?? "USD")}
                    </span>
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
