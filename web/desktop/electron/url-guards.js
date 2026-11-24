// Pure URL / bounds guards for the Plaid setup pane (plaid-guide.js). Kept free
// of any `electron` import so they can be unit-tested with vitest.

const DASHBOARD_HOST = "dashboard.plaid.com";

function parse(raw) {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

/** plaid.com and its subdomains — not look-alikes such as notplaid.com. */
function isPlaidHost(host) {
  const h = String(host || "").toLowerCase().replace(/\.$/, "");
  return h === "plaid.com" || h.endsWith(".plaid.com");
}

function isGoogleSignInHost(host) {
  const h = String(host || "").toLowerCase().replace(/\.$/, "");
  return h === "accounts.google.com" || h.endsWith(".accounts.google.com");
}

/** Only Plaid's dashboard, over https, may be opened by the app itself. */
function isDashboardUrl(raw) {
  const u = parse(raw);
  return Boolean(u && u.protocol === "https:" && u.hostname.toLowerCase() === DASHBOARD_HOST);
}

/**
 * Where a page-initiated navigation or popup in the pane goes:
 *  - "pane":     a Plaid page over https — load it in the pane
 *  - "google":   Google sign-in, which Google refuses in embedded browsers —
 *                stop it and explain
 *  - "external": any other web or mailto address — the user's own browser
 *  - "drop":     anything else (about:, data:, file:, javascript:, garbage)
 */
function routeUrl(raw) {
  const u = parse(raw);
  if (!u) return "drop";
  if (u.protocol === "https:" && isGoogleSignInHost(u.hostname)) return "google";
  if (u.protocol === "https:" && isPlaidHost(u.hostname)) return "pane";
  if (u.protocol === "https:" || u.protocol === "http:" || u.protocol === "mailto:") return "external";
  return "drop";
}

/**
 * Route `will-navigate` / `will-redirect` event details. Both events also fire
 * for subframes; non-main-frame navigations and redirects return "ignore" so
 * embedded iframes (captcha, analytics, widgets) don't trip the guard.
 */
function routeNavigation(details) {
  if (!details || details.isMainFrame !== true) return "ignore";
  return routeUrl(details.url);
}

function sanitizeBounds(b) {
  const n = (v) => (Number.isFinite(v) ? Math.max(0, Math.round(v)) : 0);
  return { x: n(b && b.x), y: n(b && b.y), width: n(b && b.width), height: n(b && b.height) };
}

module.exports = {
  DASHBOARD_HOST,
  parse,
  isPlaidHost,
  isGoogleSignInHost,
  isDashboardUrl,
  routeUrl,
  routeNavigation,
  sanitizeBounds,
};
