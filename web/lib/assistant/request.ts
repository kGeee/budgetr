/**
 * The chat request body and the stream events, shared by the route and the
 * client. Pure.
 *
 * The client keeps the conversation and sends it back as plain text each turn
 * (charts are replayed as a one-line description), so the server holds no chat
 * state and nothing is stored: closing the panel forgets the conversation.
 */

export type ChatTurn = { role: "user" | "assistant"; text: string };

export const REQUEST_LIMITS = {
  turns: 40,
  /** Per user message. */
  userChars: 2000,
  /** Per replayed assistant message. */
  assistantChars: 8000,
} as const;

export type ParsedRequest = { ok: true; turns: ChatTurn[] } | { ok: false; error: string };

/** Validate the POST body: alternating turns, ending with the user's question. */
export function parseChatRequest(body: unknown): ParsedRequest {
  if (typeof body !== "object" || body === null) return { ok: false, error: "Expected a JSON object." };
  const raw = (body as { messages?: unknown }).messages;
  if (!Array.isArray(raw) || raw.length === 0) return { ok: false, error: "messages must be a non-empty array." };

  // Keep the most recent turns; older context matters least and costs the most.
  const recent = raw.slice(-REQUEST_LIMITS.turns);
  const turns: ChatTurn[] = [];
  for (const m of recent) {
    if (typeof m !== "object" || m === null) return { ok: false, error: "Each message must be an object." };
    const { role, text } = m as { role?: unknown; text?: unknown };
    if (role !== "user" && role !== "assistant") return { ok: false, error: "role must be user or assistant." };
    if (typeof text !== "string") return { ok: false, error: "text must be a string." };
    const limit = role === "user" ? REQUEST_LIMITS.userChars : REQUEST_LIMITS.assistantChars;
    const trimmed = text.trim().slice(0, limit);
    if (!trimmed) continue; // an empty assistant turn (e.g. an error) carries nothing
    const prev = turns[turns.length - 1];
    if (prev && prev.role === role) {
      prev.text = `${prev.text}\n\n${trimmed}`; // merge same-role neighbours
    } else {
      turns.push({ role, text: trimmed });
    }
  }
  while (turns.length > 0 && turns[0].role !== "user") turns.shift();
  if (turns.length === 0 || turns[turns.length - 1].role !== "user") {
    return { ok: false, error: "The last message must be the user's question." };
  }
  return { ok: true, turns };
}

/** One line of the NDJSON response stream. */
export type StreamEvent =
  /** A new model request started; text after this starts a new paragraph. */
  | { t: "round" }
  /** The last round failed mid-stream and is being re-issued: drop its text. */
  | { t: "retry" }
  | { t: "text"; d: string }
  | { t: "status"; d: string }
  | { t: "chart"; spec: import("./chart-spec").ChartSpec }
  | { t: "error"; d: string }
  | { t: "done" };
