import { PageHead } from "@/components/page-head";
import { CategoryManager } from "@/components/category-manager";
import { CategoriesSpendChart } from "@/components/categories-spend-chart";
import { Card } from "@/components/ui/card";
import { getArchivedCategories, getCategories, getDailySpend } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default function CategoriesPage() {
  const categories = getCategories();
  const archived = getArchivedCategories();
  const daily = getDailySpend(30);

  return (
    <div className="space-y-7">
      <PageHead title="Categories" />
      <p className="-mt-3 max-w-xl text-sm text-[var(--muted)]">
        Rename, add, or archive the categories your spending rolls up into. Every transaction maps
        through these — overrides set per-transaction take precedence. Click a category to see its
        transactions broken down by month.
      </p>
      <Card className="p-0">
        <div className="border-b border-line px-6 py-4">
          <span className="eyebrow">Daily spending · 30d</span>
        </div>
        <div className="px-2 py-4 sm:px-4">
          <CategoriesSpendChart daily={daily} categories={categories} />
        </div>
      </Card>
      <CategoryManager categories={categories} archived={archived} />
    </div>
  );
}
