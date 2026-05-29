import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { PlaidLink } from "@/components/plaid-link";
import { getAccounts } from "@/lib/queries";
import { formatCurrency, isLiability, signedBalance } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default function AccountsPage() {
  const accounts = getAccounts();

  // Group by institution for readability.
  const byInstitution = new Map<string, typeof accounts>();
  for (const a of accounts) {
    const key = a.institutionName ?? "Other";
    if (!byInstitution.has(key)) byInstitution.set(key, []);
    byInstitution.get(key)!.push(a);
  }

  const total = accounts.reduce((sum, a) => sum + signedBalance(a.type, a.currentBalance), 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Accounts</h1>
          <p className="text-sm text-[var(--muted)]">
            {accounts.length} accounts · net {formatCurrency(total)}
          </p>
        </div>
        <PlaidLink />
      </div>

      {accounts.length === 0 && (
        <Card>
          <p className="text-sm text-[var(--muted)]">
            No accounts connected yet. Use the connect button to link your Amex, brokerage, and
            bank via Plaid.
          </p>
        </Card>
      )}

      {[...byInstitution.entries()].map(([institution, accts]) => (
        <Card key={institution}>
          <CardHeader>
            <CardTitle>{institution}</CardTitle>
          </CardHeader>
          <ul className="divide-y">
            {accts.map((a) => (
              <li key={a.id} className="flex items-center justify-between py-3">
                <div>
                  <p className="font-medium">
                    {a.name}
                    {a.mask && <span className="text-[var(--muted)]"> ••{a.mask}</span>}
                  </p>
                  <p className="text-xs capitalize text-[var(--muted)]">
                    {a.type}
                    {a.subtype ? ` · ${a.subtype}` : ""}
                  </p>
                </div>
                <span
                  className={`tabular font-medium ${
                    isLiability(a.type) ? "text-[var(--negative)]" : ""
                  }`}
                >
                  {formatCurrency(a.currentBalance ?? 0, a.currency ?? "USD")}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ))}
    </div>
  );
}
