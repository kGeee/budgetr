/**
 * The chat panel's state transitions, kept pure (no React, no server actions)
 * so they can be tested directly.
 */

import { describeChart, type ChartSpec } from "@/lib/assistant/chart-spec";
import type { ChatTurn, StreamEvent } from "@/lib/assistant/request";

export type Part = { kind: "text"; text: string } | { kind: "chart"; spec: ChartSpec };
export type Msg =
  | { role: "user"; text: string }
  | { role: "assistant"; parts: Part[]; error?: string; status?: string; streaming?: boolean };

/** The conversation as plain text for the next request. */
export function toTurns(messages: Msg[]): ChatTurn[] {
  return messages.map((m) =>
    m.role === "user"
      ? { role: "user", text: m.text }
      : {
          role: "assistant",
          text: m.parts
            .map((p) => (p.kind === "text" ? p.text.trim() : describeChart(p.spec)))
            .filter(Boolean)
            .join("\n\n"),
        },
  );
}

/** Apply one stream event to the assistant message being built. */
export function applyEvent(
  msg: Extract<Msg, { role: "assistant" }>,
  e: StreamEvent,
  snapshot: { parts: Part[] },
): Extract<Msg, { role: "assistant" }> {
  switch (e.t) {
    case "round":
      snapshot.parts = msg.parts.map((p) => ({ ...p }));
      // Text from a new model request starts its own paragraph.
      return { ...msg, parts: [...msg.parts, { kind: "text", text: "" }] };
    case "retry":
      return { ...msg, parts: snapshot.parts.map((p) => ({ ...p })) };
    case "text": {
      const parts = [...msg.parts];
      const last = parts[parts.length - 1];
      if (last?.kind === "text") parts[parts.length - 1] = { kind: "text", text: last.text + e.d };
      else parts.push({ kind: "text", text: e.d });
      return { ...msg, parts, status: undefined };
    }
    case "status":
      return { ...msg, status: e.d };
    case "chart":
      return { ...msg, parts: [...msg.parts, { kind: "chart", spec: e.spec }, { kind: "text", text: "" }], status: undefined };
    case "error":
      return { ...msg, error: e.d, status: undefined };
    case "done":
      return { ...msg, streaming: false, status: undefined };
  }
}

