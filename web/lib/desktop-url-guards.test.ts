// Guards for the desktop Plaid setup pane (desktop/electron/url-guards.js). The
// test lives here rather than beside it so it never ships in the app bundle
// (electron-builder packs desktop/electron/**).
import { describe, expect, it } from "vitest";
import guards from "../desktop/electron/url-guards.js";

const { isDashboardUrl, isPlaidHost, routeUrl, routeNavigation, sanitizeBounds } = guards;

describe("isDashboardUrl (what the app may point the pane at)", () => {
  it("allows only https dashboard.plaid.com", () => {
    expect(isDashboardUrl("https://dashboard.plaid.com/signup")).toBe(true);
    expect(isDashboardUrl("https://DASHBOARD.plaid.com/developers/keys")).toBe(true);
    expect(isDashboardUrl("http://dashboard.plaid.com/signup")).toBe(false);
    expect(isDashboardUrl("https://plaid.com/docs")).toBe(false);
    expect(isDashboardUrl("https://dashboard.plaid.com.evil.io/")).toBe(false);
    expect(isDashboardUrl("https://evil.io/?u=https://dashboard.plaid.com")).toBe(false);
    expect(isDashboardUrl("javascript:alert(1)")).toBe(false);
    expect(isDashboardUrl(undefined as unknown as string)).toBe(false);
  });
});

describe("isPlaidHost", () => {
  it("matches plaid.com and subdomains only", () => {
    expect(isPlaidHost("plaid.com")).toBe(true);
    expect(isPlaidHost("cdn.plaid.com.")).toBe(true);
    expect(isPlaidHost("notplaid.com")).toBe(false);
    expect(isPlaidHost("plaid.com.evil.io")).toBe(false);
    expect(isPlaidHost("")).toBe(false);
  });
});

describe("routeUrl (page-initiated navigation and popups)", () => {
  it("keeps Plaid pages in the pane", () => {
    expect(routeUrl("https://dashboard.plaid.com/overview")).toBe("pane");
    expect(routeUrl("https://plaid.com/docs/quickstart")).toBe("pane");
  });

  it("stops Google sign-in for an explanation", () => {
    expect(routeUrl("https://accounts.google.com/o/oauth2/v2/auth?x=1")).toBe("google");
  });

  it("sends every other site to the user's browser", () => {
    expect(routeUrl("https://example.com/help")).toBe("external");
    expect(routeUrl("https://plaid.com.evil.io/")).toBe("external");
    expect(routeUrl("http://dashboard.plaid.com/")).toBe("external");
    expect(routeUrl("mailto:support@plaid.com")).toBe("external");
  });

  it("drops anything that isn't a web or mail address", () => {
    for (const raw of ["javascript:alert(1)", "file:///etc/passwd", "data:text/html,x", "about:blank", "nope"]) {
      expect(routeUrl(raw)).toBe("drop");
    }
  });
});

describe("routeNavigation (will-navigate / will-redirect main-frame gate)", () => {
  it("ignores subframe navigations and redirects so iframes don't trip the guard", () => {
    expect(routeNavigation({ url: "https://example.com/widget", isMainFrame: false })).toBe("ignore");
    expect(routeNavigation({ url: "https://accounts.google.com/gsi/iframe", isMainFrame: false })).toBe("ignore");
    expect(routeNavigation({ url: "about:blank", isMainFrame: false })).toBe("ignore");
    expect(routeNavigation(null)).toBe("ignore");
    expect(routeNavigation({ url: "https://example.com" })).toBe("ignore");
  });

  it("routes main-frame navigations and redirects with routeUrl", () => {
    expect(routeNavigation({ url: "https://dashboard.plaid.com/signin", isMainFrame: true })).toBe("pane");
    expect(routeNavigation({ url: "https://accounts.google.com/o/oauth2/v2/auth", isMainFrame: true })).toBe("google");
    expect(routeNavigation({ url: "https://example.com/docs", isMainFrame: true })).toBe("external");
    expect(routeNavigation({ url: "javascript:alert(1)", isMainFrame: true })).toBe("drop");
  });
});

describe("sanitizeBounds", () => {
  it("rounds, clamps negatives and zeroes junk", () => {
    expect(sanitizeBounds({ x: 10.6, y: -4, width: 300.2, height: NaN })).toEqual({
      x: 11,
      y: 0,
      width: 300,
      height: 0,
    });
    expect(sanitizeBounds(null)).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });
});
