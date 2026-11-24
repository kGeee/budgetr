/**
 * One assistant turn: a streamed, manual tool-use loop on the Messages API.
 *
 * Claude asks for data through the read-only tools in tools.ts, and answers
 * with text plus, when a visual helps, `render_chart` calls whose input is
 * validated (chart-spec.ts) before a chart event reaches the client. Nothing
 * here writes to the database.
 *
 * The client is injected so the tests can drive the loop with a fake stream.
 */

import Anthropic from "@anthropic-ai/sdk";
import { describeChart, parseChartSpec } from "./chart-spec";
import type { AssistantModel } from "./models";
import type { ChatTurn, StreamEvent } from "./request";
import { RENDER_CHART, TOOL_DEFINITIONS, ToolInputError, findTool, runDataTool } from "./tools";

type BetaMessage = Anthropic.Beta.BetaMessage;
type BetaMessageParam = Anthropic.Beta.BetaMessageParam;
type StreamParams = Parameters<Anthropic["beta"]["messages"]["stream"]>[0];

/** The slice of the SDK client the loop uses. */
export type StreamingClient = {
  beta: {
    messages: {
      stream(
        params: StreamParams,
        options?: { signal?: AbortSignal },
      ): {
        on(event: "text", listener: (delta: string) => void): unknown;
        finalMessage(): Promise<BetaMessage>;
      };
    };
  };
};

/** Model requests per question: enough for a few lookups and a chart or two. */
export const MAX_ROUNDS = 8;
/** Charts per answer. */
export const MAX_CHARTS = 4;
/** A cap on what one answer can spend; answers here are short. */
const MAX_TOKENS = 16000;

export function systemPrompt(today: string): string {
  return `You are the assistant inside budgetr, a private personal-finance app that runs on the user's own Mac. You answer the user's questions about their own money: spending, income, budgets, accounts, net worth, investments and recurring bills.

Today is ${today}. Resolve relative dates ("last month", "this year", "since March") against it and say which dates you used when it matters.

How to work:
- Get every figure from the tools. Never estimate or invent a number; if the data isn't there, say so plainly.
- Fetch only what the question needs.
- Amounts are in the account's currency (usually USD). In spending results positive means money spent.
- When a chart or table would make the answer clearer (a trend over time, a comparison, a breakdown), call render_chart with figures you already fetched. Prefer one good chart over several. Don't draw a chart for a single number.
- Lead with the answer in a sentence or two, then any detail. Keep it short: plain sentences and short "- " bullet lists, **bold** for the key figure, no headings or tables in text (use render_chart with type "table" for tables).
- You can read data but you cannot change anything in budgetr, move money or contact anyone. If asked, say so and point to where in the app they can do it.
- You're not a licensed financial adviser. You can explain what the user's numbers show and general money concepts; for decisions with tax, legal or investment consequences, suggest checking with a professional.`;
}

/** Map an SDK error to a sentence the user can act on. */
export function describeApiError(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) {
    return "Anthropic didn't accept your API key. Check it in Settings → AI assistant.";
  }
  if (err instanceof Anthropic.PermissionDeniedError) {
    return "Your Anthropic key doesn't have access to this model. Try another model in Settings → AI assistant.";
  }
  if (err instanceof Anthropic.NotFoundError) {
    return "Anthropic couldn't find this model. Pick another one in Settings → AI assistant.";
  }
  if (err instanceof Anthropic.RateLimitError) {
    return "Anthropic is rate-limiting your key right now. Wait a moment and try again.";
  }
  if (err instanceof Anthropic.BadRequestError) {
    return `Anthropic rejected the request: ${err.message}`.slice(0, 300);
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return "Couldn't reach Anthropic. Check your internet connection and try again.";
  }
  if (err instanceof Anthropic.APIError) {
    return `Anthropic returned an error${err.status ? ` (${err.status})` : ""}. Try again in a moment.`;
  }
  return "Something went wrong answering that. Try again.";
}

export type RunOptions = {
  client: StreamingClient;
  model: AssistantModel;
  turns: ChatTurn[];
  emit: (event: StreamEvent) => void;
  today: string;
  signal?: AbortSignal;
};

/** Run one turn to completion, emitting events. Never throws for API errors; emits them. */
export async function runAssistant({ client, model, turns, emit, today, signal }: RunOptions): Promise<void> {
  // Prior turns arrive as text; this turn's assistant content (tool calls,
  // thinking, fallback blocks) is appended whole, so the history stays append-only.
  const messages: BetaMessageParam[] = turns.map((t) => ({ role: t.role, content: t.text }));
  const ctx = { today };
  let charts = 0;
  let streamRetries = 0;

  try {
    for (let round = 0; round < MAX_ROUNDS; round++) {
      emit({ t: "round" });
      const params: StreamParams = {
        model: model.id,
        max_tokens: MAX_TOKENS,
        system: systemPrompt(today),
        tools: TOOL_DEFINITIONS,
        messages,
        output_config: { effort: "medium" },
        // Caches the tool list, system prompt and history between rounds.
        cache_control: { type: "ephemeral" },
        ...(model.fallbacks
          ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const }
          : {}),
      };

      let message: BetaMessage;
      try {
        const stream = client.beta.messages.stream(params, { signal });
        stream.on("text", (delta) => emit({ t: "text", d: delta }));
        message = await stream.finalMessage();
        streamRetries = 0;
      } catch (err) {
        // A tool input the SDK couldn't parse, or a dropped connection, rejects
        // here without being an APIError: re-issue the round once.
        if (err instanceof Anthropic.APIError || signal?.aborted || streamRetries++ >= 1) throw err;
        emit({ t: "retry" });
        round--;
        continue;
      }

      if (message.stop_reason === "refusal") {
        emit({ t: "error", d: "Claude declined to answer that one." });
        break;
      }
      if (message.stop_reason === "pause_turn") {
        messages.push({ role: "assistant", content: message.content });
        continue;
      }

      const toolUses = message.content.filter(
        (b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use",
      );
      if (toolUses.length === 0) {
        if (message.stop_reason === "max_tokens") {
          emit({ t: "error", d: "The answer was cut off because it ran long." });
        }
        break;
      }
      // A tool input cut off at max_tokens can still look valid: don't run it.
      if (message.stop_reason === "max_tokens") {
        emit({ t: "error", d: "The answer ran too long to finish. Try a narrower question." });
        break;
      }

      messages.push({ role: "assistant", content: message.content });

      const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
      for (const use of toolUses) {
        results.push(await runTool(use, { emit, ctx, chartsSoFar: () => charts, onChart: () => charts++ }));
      }
      messages.push({ role: "user", content: results });

      if (round === MAX_ROUNDS - 1) {
        emit({ t: "error", d: "That took more lookups than allowed for one question. Try asking something narrower." });
      }
    }
  } catch (err) {
    if (signal?.aborted) return;
    emit({ t: "error", d: describeApiError(err) });
  }
}

async function runTool(
  use: Anthropic.Beta.BetaToolUseBlock,
  h: {
    emit: (e: StreamEvent) => void;
    ctx: { today: string };
    chartsSoFar: () => number;
    onChart: () => void;
  },
): Promise<Anthropic.Beta.BetaToolResultBlockParam> {
  const error = (content: string): Anthropic.Beta.BetaToolResultBlockParam => ({
    type: "tool_result",
    tool_use_id: use.id,
    is_error: true,
    content,
  });

  if (use.name === RENDER_CHART) {
    if (h.chartsSoFar() >= MAX_CHARTS) return error(`At most ${MAX_CHARTS} charts per answer.`);
    const parsed = parseChartSpec(use.input);
    if (!parsed.ok) return error(`Chart not shown: ${parsed.error}`);
    h.onChart();
    h.emit({ t: "chart", spec: parsed.spec });
    return { type: "tool_result", tool_use_id: use.id, content: `${describeChart(parsed.spec)} It is now visible to the user above your next sentence.` };
  }

  const tool = findTool(use.name);
  if (!tool) return error(`Unknown tool ${use.name}.`);
  h.emit({ t: "status", d: tool.status });
  try {
    return { type: "tool_result", tool_use_id: use.id, content: await runDataTool(use.name, use.input, h.ctx) };
  } catch (err) {
    if (err instanceof ToolInputError) return error(err.message);
    console.error(`[assistant] ${use.name} failed`, err);
    return error("That lookup failed inside budgetr. Tell the user you couldn't get this figure.");
  }
}
