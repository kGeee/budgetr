import Link from "next/link";
import { PageHead } from "@/components/page-head";
import { OptionsToolTabs, SubTabs } from "@/components/investments-tabs";
import { FundamentalsHandoff, TickerSwitcher } from "@/components/ticker-switcher";
import { getHoldings } from "@/lib/queries";
import { parseOccSymbol } from "@/lib/options";
import { ChainMode } from "./_modes/chain-mode";
import { VolMode } from "./_modes/vol-mode";
import { LeapsMode } from "./_modes/leaps-mode";

export const dynamic = "force-dynamic";
// Holdings come from the DB (fresh), but the option-chain fetch should hit the
// 30m Data Cache rather than being forced no-store by `force-dynamic`.
export const fetchCache = "default-cache";

type Mode = "chain" | "vol" | "leaps";

const MODES: { key: Mode; label: string; title: (t: string) => string; blurb: string }[] = [
  {
    key: "chain",
    label: "Chain",
    title: (t) => (t ? `${t} options` : "Options chain"),
    blurb: "Enter any listed symbol above — you don’t need to hold it.",
  },
  {
    key: "vol",
    label: "Vol",
    title: (t) => (t ? `${t} fixed-strike vol` : "Fixed-strike vol"),
    blurb:
      "Pick a symbol to see how each strike’s implied vol has moved. History builds up from the day you first open a chain for it — budgetr captures one snapshot per symbol per day.",
  },
  {
    key: "leaps",
    label: "LEAPS",
    title: (t) => (t ? `${t} LEAPS` : "LEAPS"),
    blurb:
      "Pick a symbol to compare a long-dated call against owning the shares — what the leverage costs, what it frees up, and where each position wins.",
  },
];

function chainHref(ticker: string, mode: Mode): string {
  const q = new URLSearchParams();
  if (ticker) q.set("ticker", ticker);
  if (mode !== "chain") q.set("mode", mode);
  const s = q.toString();
  return `/investments/options/chain${s ? `?${s}` : ""}`;
}

/**
 * Options › Chain — one listed symbol, three ways (`?mode=`): the full chain,
 * implied vol per fixed strike over time, and LEAPS against the shares. These
 * were three separate tools (Chain, Vol, LEAPS) that each took the same
 * `?ticker=` and did little else alike; as modes of one tool the symbol can't
 * be lost between them.
 *
 * The symbol lives in `?ticker=` rather than the path, so the desk works for any
 * listed name, not only the ones you already hold a leg in, and so the symbol
 * can travel to Fundamentals unchanged.
 */
export default async function OptionsChainPage({
  searchParams,
}: {
  searchParams: Promise<{ ticker?: string; mode?: string; margin?: string }>;
}) {
  const { ticker: raw, mode: rawMode, margin } = await searchParams;
  const ticker = (raw ?? "").trim().toUpperCase();
  const mode = MODES.find((m) => m.key === rawMode) ?? MODES[0];

  return (
    <div className="space-y-7">
      <OptionsToolTabs ticker={ticker} />
      <PageHead
        title={mode.title(ticker)}
        action={
          <div className="flex flex-wrap items-center gap-4">
            {ticker && <FundamentalsHandoff ticker={ticker} />}
            <TickerSwitcher
              action="/investments/options/chain"
              ticker={ticker}
              hidden={{ mode: mode.key === "chain" ? undefined : mode.key }}
            />
          </div>
        }
      />
      <SubTabs
        label="Chain views"
        active={mode.key}
        tabs={MODES.map((m) => ({ key: m.key, label: m.label, href: chainHref(ticker, m.key) }))}
      />
      {!ticker ? (
        <PickSymbol mode={mode.key} blurb={mode.blurb} />
      ) : mode.key === "vol" ? (
        <VolMode ticker={ticker} />
      ) : mode.key === "leaps" ? (
        <LeapsMode ticker={ticker} margin={margin} />
      ) : (
        <ChainMode ticker={ticker} />
      )}
    </div>
  );
}

/**
 * Landing state with no symbol chosen. Offers the underlyings you already have
 * legs in, then the equities and ETFs you hold — the two lists a person is most
 * likely to want a chain for.
 */
function PickSymbol({ mode, blurb }: { mode: Mode; blurb: string }) {
  const holdings = getHoldings();
  const held = [
    ...new Set(
      holdings.map((h) => parseOccSymbol(h.ticker)?.underlying).filter((u): u is string => !!u),
    ),
  ];
  const optionable = [
    ...new Set(
      holdings
        .filter((h) => h.ticker && !parseOccSymbol(h.ticker))
        .filter((h) => h.securityType === "equity" || h.securityType === "etf")
        .map((h) => h.ticker as string),
    ),
  ].filter((t) => !held.includes(t));

  return (
    <section className="max-w-[70ch] border-t border-line pt-5">
      <p className="font-display text-lg leading-snug">{blurb}</p>
      {held.length > 0 && <SymbolRow label="You have legs in" symbols={held} mode={mode} />}
      {optionable.length > 0 && (
        <SymbolRow label="You hold" symbols={optionable.slice(0, 12)} mode={mode} />
      )}
    </section>
  );
}

function SymbolRow({ label, symbols, mode }: { label: string; symbols: string[]; mode: Mode }) {
  return (
    <div className="mt-5">
      <p className="eyebrow">{label}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {symbols.map((s) => (
          <Link
            key={s}
            href={chainHref(s, mode)}
            className="mono inline-flex min-h-10 items-center rounded-full border border-[var(--line-strong)] px-4 text-sm text-[var(--paper)] transition hover:border-[var(--brass-dim)] hover:text-[var(--brass)]"
          >
            {s}
          </Link>
        ))}
      </div>
    </div>
  );
}
