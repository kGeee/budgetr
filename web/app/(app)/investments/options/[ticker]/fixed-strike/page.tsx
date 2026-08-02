import { permanentRedirect } from "next/navigation";

/** Legacy route — fixed-strike vol is now `/investments/options/vol?ticker=…`.
 * See the sibling `[ticker]/page.tsx` for why the symbol left the path. */
export default async function LegacyFixedStrikeVolPage({
  params,
}: {
  params: Promise<{ ticker: string }>;
}) {
  const { ticker } = await params;
  const sym = decodeURIComponent(ticker).trim().toUpperCase();
  permanentRedirect(`/investments/options/vol?ticker=${encodeURIComponent(sym)}`);
}
