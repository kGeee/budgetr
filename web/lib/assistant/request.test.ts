import { describe, expect, it } from "vitest";
import { REQUEST_LIMITS, parseChatRequest } from "./request";
import { isSameOrigin, localToday } from "./http";
import { DEFAULT_ASSISTANT_MODEL, resolveAssistantModel } from "./models";

describe("parseChatRequest", () => {
  it("accepts a conversation ending with the user's question", () => {
    const r = parseChatRequest({
      messages: [
        { role: "user", text: "How much on dining?" },
        { role: "assistant", text: "About $400." },
        { role: "user", text: " And groceries? " },
      ],
    });
    expect(r).toEqual({
      ok: true,
      turns: [
        { role: "user", text: "How much on dining?" },
        { role: "assistant", text: "About $400." },
        { role: "user", text: "And groceries?" },
      ],
    });
  });

  it("drops empty turns and merges neighbours that end up with the same role", () => {
    const r = parseChatRequest({
      messages: [
        { role: "user", text: "First" },
        { role: "assistant", text: "   " }, // e.g. an answer that failed
        { role: "user", text: "Second" },
      ],
    });
    expect(r).toEqual({ ok: true, turns: [{ role: "user", text: "First\n\nSecond" }] });
  });

  it("drops a leading assistant turn", () => {
    const r = parseChatRequest({ messages: [{ role: "assistant", text: "Hi" }, { role: "user", text: "Q" }] });
    expect(r.ok && r.turns).toEqual([{ role: "user", text: "Q" }]);
  });

  it("rejects bodies that don't end with a question or are malformed", () => {
    expect(parseChatRequest(null).ok).toBe(false);
    expect(parseChatRequest({}).ok).toBe(false);
    expect(parseChatRequest({ messages: [] }).ok).toBe(false);
    expect(parseChatRequest({ messages: [{ role: "assistant", text: "x" }] }).ok).toBe(false);
    expect(parseChatRequest({ messages: [{ role: "system", text: "x" }] }).ok).toBe(false);
    expect(parseChatRequest({ messages: [{ role: "user", text: 5 }] }).ok).toBe(false);
  });

  it("caps message length and the number of turns", () => {
    const long = parseChatRequest({ messages: [{ role: "user", text: "x".repeat(10_000) }] });
    expect(long.ok && long.turns[0].text.length).toBe(REQUEST_LIMITS.userChars);

    const many = Array.from({ length: 100 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", text: `m${i}` }));
    many.push({ role: "user", text: "last" });
    const r = parseChatRequest({ messages: many });
    expect(r.ok && r.turns.length).toBeLessThanOrEqual(REQUEST_LIMITS.turns);
    expect(r.ok && r.turns.at(-1)?.text.endsWith("last")).toBe(true);
  });
});

describe("isSameOrigin", () => {
  const req = (h: Record<string, string>) => ({ headers: { get: (n: string) => h[n] ?? null } });

  it("allows budgetr's own pages", () => {
    expect(isSameOrigin(req({ origin: "http://127.0.0.1:3000", host: "127.0.0.1:3000", "sec-fetch-site": "same-origin" }))).toBe(true);
  });

  it("allows a request with no browser headers (a local script)", () => {
    expect(isSameOrigin(req({ host: "localhost:3000" }))).toBe(true);
  });

  it("refuses another site", () => {
    expect(isSameOrigin(req({ origin: "https://evil.example", host: "localhost:3000" }))).toBe(false);
    expect(isSameOrigin(req({ "sec-fetch-site": "cross-site", host: "localhost:3000" }))).toBe(false);
    expect(isSameOrigin(req({ "sec-fetch-site": "same-site", host: "localhost:3000" }))).toBe(false);
    expect(isSameOrigin(req({ origin: "null", host: "localhost:3000" }))).toBe(false);
  });
});

describe("localToday", () => {
  it("formats the local calendar date", () => {
    expect(localToday(new Date(2026, 0, 5, 23, 30))).toBe("2026-01-05");
  });
});

describe("resolveAssistantModel", () => {
  it("falls back to the default for unknown or missing ids", () => {
    expect(resolveAssistantModel(null).id).toBe(DEFAULT_ASSISTANT_MODEL);
    expect(resolveAssistantModel("gpt-whatever").id).toBe(DEFAULT_ASSISTANT_MODEL);
    expect(resolveAssistantModel("claude-haiku-5-5").fallbacks).toBe(false);
  });
});
