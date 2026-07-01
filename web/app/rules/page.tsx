import { PageHead } from "@/components/page-head";
import { RulesManager } from "@/components/rules-manager";
import { getAccounts, getCategories, getTagRules } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default function RulesPage() {
  const rules = getTagRules();
  const accounts = getAccounts().map((a) => ({ id: a.id, name: a.name }));
  const categories = getCategories().map((c) => ({ id: c.id, name: c.name }));

  return (
    <div className="space-y-7">
      <PageHead title="Auto-tag rules" />
      <p className="-mt-3 max-w-xl text-sm text-[var(--muted)]">
        Rules tag matching transactions automatically — applied to new transactions on every sync
        and backfilled across your history when you add them. Add amount, account, or regex
        conditions for finer control, and optionally set a category too.
      </p>
      <RulesManager rules={rules} accounts={accounts} categories={categories} />
    </div>
  );
}
