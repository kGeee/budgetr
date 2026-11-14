export type SpendingView = "category" | "vendor" | "trends";

export const SPENDING_VIEWS: { key: SpendingView; label: string }[] = [
  { key: "category", label: "By category" },
  { key: "vendor", label: "By vendor" },
  { key: "trends", label: "Trends" },
];

/**
 * Build a /spending URL, dropping defaults so the canonical link for the
 * landing view stays a bare "/spending". `period` is only carried when the user
 * chose one — the page's default falls back to the last complete month, and
 * pinning "this-month" into every link would defeat that.
 */
export function spendingHref({
  view,
  period,
  category,
  vendor,
  report,
  currency,
}: {
  view?: SpendingView;
  period?: string;
  category?: string;
  vendor?: string;
  report?: boolean;
  currency?: string;
}): string {
  const q = new URLSearchParams();
  if (report) q.set("report", "1");
  if (view && view !== "category") q.set("view", view);
  if (period) q.set("period", period);
  if (category) q.set("category", category);
  if (vendor) q.set("vendor", vendor);
  if (currency) q.set("currency", currency);
  const s = q.toString();
  return s ? `/spending?${s}` : "/spending";
}
