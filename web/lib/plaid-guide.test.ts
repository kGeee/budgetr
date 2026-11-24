import { describe, expect, it } from "vitest";
import {
  classifyPlaidUrl,
  currentStep,
  displayUrl,
  isGoogleSignIn,
  isPlaidHost,
  stepsProvenBy,
  type GuideStepId,
} from "./plaid-guide";

describe("isPlaidHost", () => {
  it("accepts plaid.com and its subdomains", () => {
    expect(isPlaidHost("plaid.com")).toBe(true);
    expect(isPlaidHost("dashboard.plaid.com")).toBe(true);
    expect(isPlaidHost("Dashboard.Plaid.com.")).toBe(true);
  });

  it("rejects look-alikes", () => {
    expect(isPlaidHost("notplaid.com")).toBe(false);
    expect(isPlaidHost("plaid.com.evil.io")).toBe(false);
    expect(isPlaidHost("plaid.co")).toBe(false);
  });
});

describe("isGoogleSignIn", () => {
  it("spots Google's sign-in host only", () => {
    expect(isGoogleSignIn("https://accounts.google.com/o/oauth2/v2/auth?client_id=x")).toBe(true);
    expect(isGoogleSignIn("https://www.google.com/search?q=plaid")).toBe(false);
    expect(isGoogleSignIn("not a url")).toBe(false);
  });
});

describe("classifyPlaidUrl", () => {
  const c = classifyPlaidUrl;

  it("reads the sign-up and sign-in forms", () => {
    expect(c("https://dashboard.plaid.com/signup")).toBe("signup");
    expect(c("https://dashboard.plaid.com/signup/")).toBe("signup");
    expect(c("https://dashboard.plaid.com/signin?redirect=%2F")).toBe("signin");
    expect(c("https://dashboard.plaid.com/login")).toBe("signin");
  });

  it("treats a verification page as an account that exists", () => {
    expect(c("https://dashboard.plaid.com/signup/verify-email")).toBe("verify");
    expect(c("https://dashboard.plaid.com/verify")).toBe("verify");
    expect(c("https://dashboard.plaid.com/verification/pending")).toBe("verify");
  });

  it("finds the Keys page at either of its addresses", () => {
    expect(c("https://dashboard.plaid.com/developers/keys")).toBe("keys");
    expect(c("https://dashboard.plaid.com/team/keys")).toBe("keys");
  });

  it("counts any other dashboard page as signed in", () => {
    expect(c("https://dashboard.plaid.com/")).toBe("dashboard");
    expect(c("https://dashboard.plaid.com/overview")).toBe("dashboard");
  });

  it("ignores pages off the dashboard, or not over https", () => {
    expect(c("https://plaid.com/docs/")).toBe("other");
    expect(c("http://dashboard.plaid.com/developers/keys")).toBe("other");
    expect(c("https://dashboard.plaid.com.evil.io/developers/keys")).toBe("other");
    expect(c("garbage")).toBe("other");
  });
});

describe("stepsProvenBy", () => {
  it("implies the earlier steps from a later page", () => {
    expect(stepsProvenBy("signup")).toEqual([]);
    expect(stepsProvenBy("verify")).toEqual(["account"]);
    expect(stepsProvenBy("dashboard")).toEqual(["account", "verify"]);
    expect(stepsProvenBy("keys")).toEqual(["account", "verify", "keys-page"]);
  });

  it("never proves the keys were copied — only the user can say that", () => {
    for (const p of ["signup", "signin", "verify", "keys", "dashboard", "other"] as const) {
      expect(stepsProvenBy(p)).not.toContain("copy");
      expect(stepsProvenBy(p)).not.toContain("paste");
    }
  });
});

describe("currentStep", () => {
  it("is the first step not yet done", () => {
    expect(currentStep(new Set())).toBe("account");
    expect(currentStep(new Set<GuideStepId>(["account", "verify"]))).toBe("keys-page");
    // A manual tick on a later step doesn't skip an earlier open one.
    expect(currentStep(new Set<GuideStepId>(["copy"]))).toBe("account");
    expect(currentStep(new Set<GuideStepId>(["account", "verify", "keys-page", "copy", "paste"]))).toBe(
      "paste",
    );
  });
});

describe("displayUrl", () => {
  it("drops the scheme, query and a bare slash", () => {
    expect(displayUrl("https://dashboard.plaid.com/")).toBe("dashboard.plaid.com");
    expect(displayUrl("https://dashboard.plaid.com/developers/keys?x=1")).toBe(
      "dashboard.plaid.com/developers/keys",
    );
  });
});
