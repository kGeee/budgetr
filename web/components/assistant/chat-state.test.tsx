import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { applyEvent, toTurns, type Msg, type Part } from "./chat-state";
import { AssistantText, toBlocks } from "./assistant-text";
import type { StreamEvent } from "@/lib/assistant/request";
import type { ChartSpec } from "@/lib/assistant/chart-spec";

type Assistant = Extract<Msg, { role: "assistant" }>;

const SPEC: ChartSpec = {
  type: "pie",
  title: "Spending mix",
  unit: "currency",
  labels: ["Dining", "Groceries"],
  series: [{ name: "Spent", values: [100, 200] }],
};

function play(events: StreamEvent[]): Assistant {
  let msg: Assistant = { role: "assistant", parts: [], streaming: true };
  const snapshot: { parts: Part[] } = { parts: [] };
  for (const e of events) msg = applyEvent(msg, e, snapshot);
  return msg;
}

describe("applyEvent", () => {
  it("builds text, charts and status from a stream", () => {
    const msg = play([
      { t: "round" },
      { t: "text", d: "Let me " },
      { t: "text", d: "look." },
      { t: "status", d: "Adding up spending" },
      { t: "round" },
      { t: "chart", spec: SPEC },
      { t: "round" },
      { t: "text", d: "Groceries led." },
      { t: "done" },
    ]);
    expect(msg.streaming).toBe(false);
    expect(msg.status).toBeUndefined();
    expect(msg.parts.filter((p) => p.kind === "text" && p.text).map((p) => (p as { text: string }).text)).toEqual([
      "Let me look.",
      "Groceries led.",
    ]);
    expect(msg.parts.filter((p) => p.kind === "chart")).toHaveLength(1);
  });

  it("drops a failed round's partial text on retry", () => {
    const msg = play([
      { t: "round" },
      { t: "text", d: "Kept." },
      { t: "round" },
      { t: "text", d: "Half an ans" },
      { t: "retry" },
      { t: "round" },
      { t: "text", d: "Whole answer." },
    ]);
    const text = msg.parts.map((p) => (p.kind === "text" ? p.text : "")).join("|");
    expect(text).not.toContain("Half");
    expect(text).toContain("Kept.");
    expect(text).toContain("Whole answer.");
  });

  it("keeps an error alongside what already streamed", () => {
    const msg = play([{ t: "round" }, { t: "text", d: "Partial" }, { t: "error", d: "Couldn't reach Anthropic." }]);
    expect(msg.error).toBe("Couldn't reach Anthropic.");
    expect(msg.parts[0]).toEqual({ kind: "text", text: "Partial" });
  });
});

describe("toTurns", () => {
  it("replays charts as a short description and drops empty text", () => {
    const turns = toTurns([
      { role: "user", text: "Where did my money go?" },
      {
        role: "assistant",
        parts: [
          { kind: "text", text: " Mostly groceries. " },
          { kind: "chart", spec: SPEC },
          { kind: "text", text: "" },
        ],
      },
    ]);
    expect(turns).toEqual([
      { role: "user", text: "Where did my money go?" },
      { role: "assistant", text: "Mostly groceries.\n\n[Showed the user a pie chart: Spending mix]" },
    ]);
  });
});

describe("assistant text", () => {
  it("groups paragraphs and bullet lists", () => {
    expect(toBlocks("## Summary\nYou spent **$40**.\n\n- Dining\n* Groceries\n2. Gas\nAfter.")).toEqual([
      { kind: "p", text: "Summary You spent **$40**." },
      { kind: "ul", items: ["Dining", "Groceries", "Gas"] },
      { kind: "p", text: "After." },
    ]);
  });

  it("renders bold as elements and never injects HTML from the model", () => {
    const html = renderToStaticMarkup(
      <AssistantText text={'You spent **$40** <img src=x onerror="alert(1)"> [link](javascript:alert(1))'} />,
    );
    expect(html).toContain("<strong");
    expect(html).toContain("$40</strong>");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
    expect(html).not.toContain("<a ");
  });
});
