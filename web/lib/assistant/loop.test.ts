// The tool-use loop, driven by a fake streaming client that returns scripted
// messages. No network and no API key. Data tools read the in-memory DEMO_DB.

process.env.DEMO_DB = "1";

import { beforeAll, describe, expect, it, vi } from "vitest";
import Anthropic from "@anthropic-ai/sdk";
import type { StreamEvent } from "./request";

let loop: typeof import("./loop");
let models: typeof import("./models");

beforeAll(async () => {
  loop = await import("./loop");
  models = await import("./models");
});

type Block = Record<string, unknown>;
type Script = { content: Block[]; stop_reason: string } | Error;

function message(content: Block[], stop_reason: string) {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "claude-opus-5-5",
    content,
    stop_reason,
    stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 1 },
  };
}

/** A client whose nth stream returns the nth scripted message (or rejects with it). */
function fakeClient(script: Script[]) {
  const calls: { params: Record<string, unknown>; messages: unknown[] }[] = [];
  let i = 0;
  const client = {
    beta: {
      messages: {
        stream(params: Record<string, unknown>) {
          // Copy the history as it was at call time; the loop appends to the same array.
          calls.push({ params, messages: structuredClone(params.messages as unknown[]) });
          const step = script[i++];
          let onText: ((d: string) => void) | undefined;
          return {
            on(_e: "text", l: (d: string) => void) {
              onText = l;
            },
            async finalMessage() {
              if (!step) throw new Error("script ran out");
              if (step instanceof Error) throw step;
              for (const b of step.content) if (b.type === "text") onText?.(b.text as string);
              return message(step.content, step.stop_reason);
            },
          };
        },
      },
    },
  };
  return { client: client as unknown as import("./loop").StreamingClient, calls };
}

async function runWith(script: Script[], model = "claude-opus-5-5") {
  const { client, calls } = fakeClient(script);
  const events: StreamEvent[] = [];
  await loop.runAssistant({
    client,
    model: models.resolveAssistantModel(model),
    turns: [{ role: "user", text: "How much did I spend on dining?" }],
    emit: (e) => events.push(e),
    today: "2026-03-31",
  });
  return { events, calls };
}

const CHART = {
  type: "bar",
  title: "Dining by month",
  labels: ["Jan", "Feb"],
  series: [{ name: "Dining", values: [40, 60] }],
};

describe("runAssistant", () => {
  it("runs a data tool, draws a chart and finishes with text", async () => {
    const { events, calls } = await runWith([
      {
        content: [
          { type: "text", text: "Let me check." },
          { type: "tool_use", id: "tu_1", name: "list_categories", input: {} },
        ],
        stop_reason: "tool_use",
      },
      {
        content: [{ type: "tool_use", id: "tu_2", name: "render_chart", input: CHART }],
        stop_reason: "tool_use",
      },
      { content: [{ type: "text", text: "You spent **$100**." }], stop_reason: "end_turn" },
    ]);

    expect(events.map((e) => e.t)).toEqual(["round", "text", "status", "round", "chart", "round", "text"]);
    expect(events.find((e) => e.t === "chart")).toMatchObject({ spec: { type: "bar", unit: "currency" } });

    // Request shape: Opus with server-side fallbacks, caching, effort, every tool.
    const p = calls[0].params;
    expect(p).toMatchObject({
      model: "claude-opus-5-5",
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      cache_control: { type: "ephemeral" },
      output_config: { effort: "medium" },
    });
    expect(p).not.toHaveProperty("thinking");
    expect(String(p.system)).toContain("Today is 2026-03-31");

    // The tool result goes back in one user message, after the full assistant turn.
    const second = calls[1].messages as { role: string; content: unknown }[];
    expect(second).toHaveLength(3);
    expect(second[1].role).toBe("assistant");
    expect(second[2]).toMatchObject({
      role: "user",
      content: [{ type: "tool_result", tool_use_id: "tu_1", content: "[]" }],
    });
    const third = calls[2].messages as { role: string; content: { content: string }[] }[];
    expect(third[4].content[0].content).toContain("Showed the user a bar chart");
  });

  it("sends no fallback beta for Haiku", async () => {
    const { calls } = await runWith(
      [{ content: [{ type: "text", text: "Hi" }], stop_reason: "end_turn" }],
      "claude-haiku-5-5",
    );
    expect(calls[0].params).not.toHaveProperty("betas");
    expect(calls[0].params).not.toHaveProperty("fallbacks");
  });

  it("returns an invalid chart to Claude as an error and shows nothing", async () => {
    const { events, calls } = await runWith([
      {
        content: [{ type: "tool_use", id: "tu_1", name: "render_chart", input: { type: "pie", title: "x" } }],
        stop_reason: "tool_use",
      },
      { content: [{ type: "text", text: "Sorry." }], stop_reason: "end_turn" },
    ]);
    expect(events.some((e) => e.t === "chart")).toBe(false);
    const result = (calls[1].messages as { content: { is_error?: boolean; content: string }[] }[])[2].content[0];
    expect(result.is_error).toBe(true);
    expect(result.content).toMatch(/^Chart not shown/);
  });

  it("returns bad tool input and unknown tools to Claude as errors", async () => {
    const { calls } = await runWith([
      {
        content: [
          { type: "tool_use", id: "tu_1", name: "get_spending_by_category", input: { start_date: "yesterday" } },
          { type: "tool_use", id: "tu_2", name: "delete_everything", input: {} },
        ],
        stop_reason: "tool_use",
      },
      { content: [{ type: "text", text: "ok" }], stop_reason: "end_turn" },
    ]);
    const results = (calls[1].messages as { content: { is_error?: boolean; content: string }[] }[])[2].content;
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({ is_error: true, content: expect.stringMatching(/YYYY-MM-DD/) });
    expect(results[1]).toMatchObject({ is_error: true, content: "Unknown tool delete_everything." });
  });

  it("caps charts per answer", async () => {
    const uses = Array.from({ length: loop.MAX_CHARTS + 1 }, (_, i) => ({
      type: "tool_use",
      id: `tu_${i}`,
      name: "render_chart",
      input: CHART,
    }));
    const { events } = await runWith([
      { content: uses, stop_reason: "tool_use" },
      { content: [{ type: "text", text: "done" }], stop_reason: "end_turn" },
    ]);
    expect(events.filter((e) => e.t === "chart")).toHaveLength(loop.MAX_CHARTS);
  });

  it("doesn't run a tool whose input was cut off at max_tokens", async () => {
    const { events, calls } = await runWith([
      {
        content: [{ type: "tool_use", id: "tu_1", name: "render_chart", input: CHART }],
        stop_reason: "max_tokens",
      },
    ]);
    expect(calls).toHaveLength(1);
    expect(events.some((e) => e.t === "chart")).toBe(false);
    expect(events.at(-1)).toMatchObject({ t: "error" });
  });

  it("reports a refusal", async () => {
    const { events } = await runWith([{ content: [], stop_reason: "refusal" }]);
    expect(events.at(-1)).toEqual({ t: "error", d: "Claude declined to answer that one." });
  });

  it("retries a stream failure that isn't an API error once", async () => {
    const { events, calls } = await runWith([
      new SyntaxError("Unexpected end of JSON input"),
      { content: [{ type: "text", text: "Here you go." }], stop_reason: "end_turn" },
    ]);
    expect(calls).toHaveLength(2);
    expect(events.map((e) => e.t)).toEqual(["round", "retry", "round", "text"]);
  });

  it("gives up after a second stream failure", async () => {
    const { events } = await runWith([new SyntaxError("bad"), new SyntaxError("bad again")]);
    expect(events.at(-1)).toEqual({ t: "error", d: "Something went wrong answering that. Try again." });
  });

  it("maps API errors to plain sentences and doesn't retry them", async () => {
    const err = new Anthropic.AuthenticationError(401, { type: "error" }, "invalid x-api-key", new Headers());
    const { events, calls } = await runWith([err]);
    expect(calls).toHaveLength(1);
    expect(events.at(-1)).toMatchObject({ t: "error", d: expect.stringMatching(/didn't accept your API key/) });
  });

  it("stops after MAX_ROUNDS lookups", async () => {
    const round = {
      content: [{ type: "tool_use", id: "tu", name: "list_categories", input: {} }],
      stop_reason: "tool_use",
    };
    const { events, calls } = await runWith(Array.from({ length: loop.MAX_ROUNDS + 2 }, () => round));
    expect(calls).toHaveLength(loop.MAX_ROUNDS);
    expect(events.at(-1)).toMatchObject({ t: "error", d: expect.stringMatching(/more lookups/) });
  });

  it("stays quiet when the user stops the answer", async () => {
    const ac = new AbortController();
    const { client } = fakeClient([new Error("aborted")]);
    const emit = vi.fn();
    ac.abort();
    await loop.runAssistant({
      client,
      model: models.resolveAssistantModel(null),
      turns: [{ role: "user", text: "q" }],
      emit,
      today: "2026-03-31",
      signal: ac.signal,
    });
    expect(emit.mock.calls.map((c) => c[0].t)).toEqual(["round"]);
  });
});

describe("describeApiError", () => {
  const h = new Headers();
  it.each([
    [new Anthropic.PermissionDeniedError(403, {}, "x", h), /access to this model/],
    [new Anthropic.NotFoundError(404, {}, "x", h), /couldn't find this model/],
    [new Anthropic.RateLimitError(429, {}, "x", h), /rate-limiting/],
    [new Anthropic.InternalServerError(500, {}, "x", h), /\(500\)/],
    [new Error("boom"), /Something went wrong/],
  ])("%s", (err, re) => {
    expect(loop.describeApiError(err)).toMatch(re);
  });
});
