/**
 * Pure logic for the guided Plaid setup (components/onboarding/plaid-guided-setup.tsx):
 * which checklist steps exist, and which of them a page in Plaid's dashboard
 * proves are done.
 *
 * The desktop app shows Plaid's dashboard in a browser pane inside budgetr and
 * reports each page the pane lands on. We only ever look at the page ADDRESS —
 * never the page's contents — so nothing here can read the user's keys. Steps
 * that an address can't prove (copying the keys) are ticked by hand, and every
 * step can be ticked by hand in case Plaid moves a page.
 */

export const PLAID_DASHBOARD = "https://dashboard.plaid.com";
export const PLAID_SIGNUP_URL = `${PLAID_DASHBOARD}/signup`;
export const PLAID_SIGNIN_URL = `${PLAID_DASHBOARD}/signin`;
export const PLAID_KEYS_URL = `${PLAID_DASHBOARD}/developers/keys`;

export type GuideStepId = "account" | "verify" | "keys-page" | "copy" | "paste";

export const GUIDE_STEPS: readonly { id: GuideStepId; title: string }[] = [
  { id: "account", title: "Create your Plaid account" },
  { id: "verify", title: "Verify your email and sign in" },
  { id: "keys-page", title: "Open Developers → Keys" },
  { id: "copy", title: "Copy your client ID and secret" },
  { id: "paste", title: "Paste them into budgetr" },
] as const;

/** Where in Plaid's dashboard a page address puts the user. */
export type PlaidPage =
  | "signup" //     filling in the sign-up form
  | "signin" //     the sign-in form (signed out)
  | "verify" //     a "check your email" / verification page — the account exists
  | "keys" //       Developers → Keys
  | "dashboard" //  any other dashboard page — signed in
  | "other"; //     not Plaid's dashboard at all (docs, marketing, a third party)

/** True for plaid.com and any of its subdomains (and nothing that merely ends in "plaid.com"). */
export function isPlaidHost(host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, "");
  return h === "plaid.com" || h.endsWith(".plaid.com");
}

/**
 * True when the address is Google's own sign-in. Google refuses to sign people
 * in inside an app's built-in browser, so the guide sends that step to the
 * user's real browser instead of letting it fail with Google's error page.
 */
export function isGoogleSignIn(raw: string): boolean {
  const u = parse(raw);
  if (!u) return false;
  const h = u.hostname.toLowerCase();
  return h === "accounts.google.com" || h.endsWith(".accounts.google.com");
}

/** Classify a page address. Unknown dashboard paths count as signed in. */
export function classifyPlaidUrl(raw: string): PlaidPage {
  const u = parse(raw);
  if (!u || u.protocol !== "https:" || u.hostname.toLowerCase() !== "dashboard.plaid.com") {
    return "other";
  }
  const p = u.pathname.toLowerCase().replace(/\/+$/, "") || "/";
  if (/(^|\/)verif(y|ication)(\/|-|$)|confirm-email|check-email/.test(p)) return "verify";
  if (p.startsWith("/signup")) return "signup";
  if (p.startsWith("/signin") || p.startsWith("/login") || p.startsWith("/sign-in")) return "signin";
  // The Keys page has lived at both of these over the years.
  if (p.startsWith("/developers/keys") || p.startsWith("/team/keys")) return "keys";
  return "dashboard";
}

/** Steps a page proves are finished (reaching a later page implies the earlier ones). */
export function stepsProvenBy(page: PlaidPage): GuideStepId[] {
  switch (page) {
    case "verify":
      return ["account"];
    case "dashboard":
      return ["account", "verify"];
    case "keys":
      return ["account", "verify", "keys-page"];
    default:
      return [];
  }
}

/** The first step not yet done — the one the guide opens. */
export function currentStep(done: ReadonlySet<GuideStepId>): GuideStepId {
  return GUIDE_STEPS.find((s) => !done.has(s.id))?.id ?? "paste";
}

/** A short, readable form of an address for the browser pane's location bar. */
export function displayUrl(raw: string): string {
  const u = parse(raw);
  if (!u) return raw;
  const path = u.pathname === "/" ? "" : u.pathname;
  return `${u.hostname}${path}`;
}

function parse(raw: string): URL | null {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}
