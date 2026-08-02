import { permanentRedirect } from "next/navigation";

/**
 * Legacy route. The options chain moved from `/investments/options/[ticker]` to
 * `/investments/options/chain?ticker=…` when Options became a desk with its own
 * tools — the symbol is now a parameter of one tool rather than the parent of
 * all of them. Kept as a redirect so old links, bookmarks and any holding chip
 * that hasn't been updated still land in the right place.
 *
 * Static siblings (`chain`, `vol`, `wheel`, `scanner`) take precedence over this
 * dynamic segment in Next's matcher, so they never fall through to here.
 */
export default async function LegacyOptionsTickerPage({
  params,
}: {
  params: Promise<{ ticker: string }>;
}) {
  const { ticker } = await params;
  const sym = decodeURIComponent(ticker).trim().toUpperCase();
  permanentRedirect(`/investments/options/chain?ticker=${encodeURIComponent(sym)}`);
}
