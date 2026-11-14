/**
 * The /investments `?tab=` values. A plain module (not the client tab bar) so
 * the server page can parse the param with the same list the bar links to.
 */
export const INVESTMENTS_TABS = [
  { key: "holdings", label: "Holdings" },
  { key: "allocation", label: "Allocation" },
  { key: "income", label: "Income & gains" },
] as const;

export type InvestmentsTab = (typeof INVESTMENTS_TABS)[number]["key"];

/** Unknown or missing values fall back to Holdings, the default tab. */
export function parseInvestmentsTab(raw: string | null | undefined): InvestmentsTab {
  return INVESTMENTS_TABS.find((t) => t.key === raw)?.key ?? "holdings";
}

/** Holdings is the bare URL, so the default tab has one address, not two. */
export function investmentsTabHref(key: InvestmentsTab): string {
  return key === "holdings" ? "/investments" : `/investments?tab=${key}`;
}
