import Link from "next/link";
import { ArrowUpRight, Search } from "lucide-react";

/**
 * Symbol switcher for the desks that are scoped to one ticker — the options
 * chain, fixed-strike vol, fundamentals.
 *
 * A plain GET form, no client JS: submitting navigates to `?ticker=SYM` on the
 * given desk. That's the same shape Fundamentals already used, lifted out so
 * every symbol-scoped desk carries the symbol the same way and can hand off to
 * the next one through the query string.
 */
export function TickerSwitcher({
  action,
  ticker,
  hidden,
  placeholder = "Ticker (e.g. AAPL)",
}: {
  /** Desk to submit to, e.g. "/investments/options/chain". */
  action: string;
  /** Current symbol, prefilled so it can be edited rather than retyped. */
  ticker?: string | null;
  /** Extra query params to preserve across the switch (e.g. an expiry). */
  hidden?: Record<string, string | undefined>;
  placeholder?: string;
}) {
  return (
    <form action={action} method="get" className="flex items-center gap-2">
      {Object.entries(hidden ?? {}).map(([name, value]) =>
        value ? <input key={name} type="hidden" name={name} value={value} /> : null,
      )}
      <div className="flex items-center gap-2 rounded-full border border-line bg-[var(--panel)] px-3.5 py-1.5 focus-within:border-[var(--brass-dim)]">
        <Search size={14} className="text-[var(--muted)]" aria-hidden />
        <input
          name="ticker"
          defaultValue={ticker ?? ""}
          placeholder={placeholder}
          aria-label="Ticker symbol"
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          className="mono w-28 bg-transparent text-sm uppercase outline-none placeholder:normal-case placeholder:text-[var(--faint)]"
        />
      </div>
      <button
        type="submit"
        className="rounded-full border border-line px-3 py-1.5 text-xs text-[var(--muted)] transition hover:border-[var(--brass-dim)] hover:text-[var(--paper)]"
      >
        Go
      </button>
    </form>
  );
}

/**
 * Hands the current symbol to the fundamentals desk. Fundamentals sits outside
 * the Options tool bar (it's a section desk, and the bar's tabs can't know a
 * symbol they weren't given), so without this the symbol would have to be typed
 * again on arrival — the handoff the query-string convention exists to avoid.
 */
export function FundamentalsHandoff({ ticker }: { ticker: string }) {
  return (
    <Link
      href={`/fundamentals?ticker=${encodeURIComponent(ticker)}`}
      className="inline-flex items-center gap-0.5 text-xs text-[var(--faint)] transition-colors hover:text-[var(--brass)]"
    >
      {ticker} fundamentals
      <ArrowUpRight size={11} aria-hidden />
    </Link>
  );
}
