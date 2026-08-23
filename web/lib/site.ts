/**
 * Public marketing-site config. Purchase + download are driven by env so the
 * same build works before and after the Polar product exists:
 *
 *   NEXT_PUBLIC_CHECKOUT_URL  — Polar hosted checkout link (the "Buy" CTA).
 *                               When unset, the CTA falls back to the free
 *                               GitHub download so the page is never a dead end.
 *   NEXT_PUBLIC_DOWNLOAD_URL  — direct DMG link (defaults to the latest GitHub
 *                               Release asset).
 *   NEXT_PUBLIC_PRICE         — display price, e.g. "$29".
 *   NEXT_PUBLIC_SITE_URL      — canonical origin, for OpenGraph/metadataBase.
 */

const repo = "https://github.com/kGeee/budgetr";

export const SITE = {
  name: "budgetr",
  tagline: "Your whole financial life — private, on your Mac.",
  description:
    "Net worth, spending, income, investments and options — read-only and stored on your own machine. No cloud account, no data resale.",
  repoUrl: repo,
  checkoutUrl: process.env.NEXT_PUBLIC_CHECKOUT_URL ?? "",
  /** The releases listing — for "all versions" links, not for a Download button. */
  downloadUrl: `${repo}/releases/latest`,
  directDmgUrl: `${repo}/releases/latest/download/budgetr-mac.dmg`,
  price: process.env.NEXT_PUBLIC_PRICE ?? "$29",
  siteUrl: process.env.NEXT_PUBLIC_SITE_URL ?? "https://budgetr.dev",
};

/** True when a paid checkout is configured (vs. the free-download fallback). */
export function hasCheckout(): boolean {
  return SITE.checkoutUrl.trim().length > 0;
}

/**
 * Where a download button should point.
 *
 * The direct asset, not the releases page. "Download" that opens a GitHub
 * releases listing asks the visitor to work out which of five files they want;
 * this URL redirects straight to the current DMG, so the click downloads the app
 * the way the word promises. NEXT_PUBLIC_DOWNLOAD_URL still overrides for
 * self-hosted or mirrored builds.
 */
export function downloadHref(): string {
  return process.env.NEXT_PUBLIC_DOWNLOAD_URL || SITE.directDmgUrl;
}

/**
 * Where the primary marketing CTA points: always the download.
 *
 * It used to jump straight to Polar whenever checkout was configured, which
 * asked a stranger to pay $29 for a finance app they had not yet run. The funnel
 * is now download → 14-day trial → the in-app licence gate, so the money is
 * asked for once the app has had a chance to earn it. Buying is still one click
 * from /pricing for someone who has already decided.
 */
export function primaryCtaHref(): string {
  return downloadHref();
}

/** Where the "try the live demo" CTA points — the read-only demo dashboard. */
export const DEMO_HREF = "/overview";

/**
 * True on the read-only web-demo build: the marketing deploy sets DEMO_DB=1 to
 * serve a live, in-memory demo dashboard (see db/index.ts). Server-only — the
 * flag isn't exposed to the client (reads false there), so only call this from
 * server components deciding whether to surface the live-demo CTA. */
export function demoEnabled(): boolean {
  return Boolean(process.env.DEMO_DB);
}

/**
 * Where "buy a licence" should point — the checkout itself.
 *
 * Used by the in-app licence gate, which is the one place a purchase is the
 * right next step. Falls back to the pricing page when no checkout is
 * configured, so the button is never a dead link.
 */
export function checkoutHref(): string {
  return hasCheckout() ? SITE.checkoutUrl : `${SITE.siteUrl}/pricing`;
}
