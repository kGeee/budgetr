import { format, parseISO } from "date-fns";
import { Figure } from "@/components/ui/statement";
import { categoryHue } from "@/lib/category-tint";
import { cn, formatCurrency } from "@/lib/utils";

/**
 * The pieces every ledger row shares, wherever it appears (the Transactions
 * table, Home's recent activity, the review inbox): a short mono date, a small
 * square in the category's colour, and a signed amount.
 */

/** "Jul 15", with the year added once the row is from a different one. */
export function shortDate(iso: string): string {
  const d = parseISO(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return format(d, d.getFullYear() === new Date().getFullYear() ? "MMM d" : "MMM d, yy");
}

/** "Wednesday, July 15" — the long form the detail panel leads with. */
export function longDate(iso: string): string {
  const d = parseISO(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return format(d, d.getFullYear() === new Date().getFullYear() ? "EEEE, MMMM d" : "EEEE, MMMM d, yyyy");
}

/** Category colours by id, for rows that only carry the category's id. */
export function categoryColors(
  categories: { id: string; color: string | null }[],
): Map<string, string> {
  const map = new Map<string, string>();
  for (const c of categories) if (c.color) map.set(c.id, c.color);
  return map;
}

/**
 * A category's identity dot: the colour stored on the category when it has one,
 * otherwise the stable hue every other page gives that category (see
 * lib/category-tint), so a category is the same colour wherever it's listed.
 */
export function CategoryDot({
  id,
  color,
  className,
}: {
  /** Category id, or its name for uncategorized rows. */
  id?: string | null;
  color?: string | null;
  className?: string;
}) {
  // The colour is data (the user's palette, or a hue derived from the id), so
  // it has to be an inline style rather than a class.
  const style = color
    ? { background: color }
    : id
      ? ({ "--tint-h": categoryHue(id), background: "var(--tint)" } as React.CSSProperties)
      : undefined;
  return (
    <span
      aria-hidden
      style={style}
      className={cn(
        "h-2 w-2 shrink-0 rounded-[3px]",
        !color && id && "tint",
        !style && "bg-[var(--muted)]",
        className,
      )}
    />
  );
}

/**
 * A signed ledger amount. Plaid's sign convention: positive is money out.
 * Income is jade; `quiet` (a transfer, not spending) is muted.
 */
export function Amount({
  amount,
  currency,
  quiet = false,
  cents = false,
  className,
}: {
  amount: number;
  currency?: string | null;
  quiet?: boolean;
  /** Set the cents one rank quieter — for a display-size figure. */
  cents?: boolean;
  className?: string;
}) {
  const income = amount < 0;
  const text = `${income ? "+" : "−"}${formatCurrency(Math.abs(amount), currency ?? "USD")}`;
  return (
    <span
      className={cn(
        "mono tabular whitespace-nowrap",
        quiet ? "text-[var(--muted)]" : income ? "text-[var(--jade)]" : "text-[var(--paper)]",
        className,
      )}
    >
      {cents ? <Figure value={text} /> : text}
    </span>
  );
}
