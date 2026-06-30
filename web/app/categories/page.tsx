import { PageHead } from "@/components/page-head";
import { CategoryManager } from "@/components/category-manager";
import { getArchivedCategories, getCategories } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default function CategoriesPage() {
  const categories = getCategories();
  const archived = getArchivedCategories();

  return (
    <div className="space-y-7">
      <PageHead title="Categories" />
      <p className="-mt-3 max-w-xl text-sm text-[var(--muted)]">
        Rename, add, or archive the categories your spending rolls up into. Every transaction maps
        through these — overrides set per-transaction take precedence. Click a category to see its
        transactions broken down by month.
      </p>
      <CategoryManager categories={categories} archived={archived} />
    </div>
  );
}
