import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
import { getEntitlement } from "@/lib/license";
import { demoEnabled } from "@/lib/site";
import { getAssistantKey, getAssistantModel, getAssistantStatus } from "@/lib/assistant/settings";
import { parseChatRequest, type StreamEvent } from "@/lib/assistant/request";
import { runAssistant } from "@/lib/assistant/loop";
import { isSameOrigin, localToday } from "@/lib/assistant/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/assistant — one question to the optional AI assistant.
 *
 * Body: { messages: [{ role: "user" | "assistant", text }] } (see lib/assistant/request.ts).
 * Response: NDJSON, one StreamEvent per line, ending with { t: "done" }.
 *
 * Calls Anthropic directly from this machine with the user's own key. It
 * refuses unless the user has switched the assistant on, saved a key and
 * acknowledged the data notice, and it never runs on the public web demo.
 */
export async function POST(req: NextRequest) {
  if (demoEnabled() || process.env.MARKETING_ONLY) {
    return NextResponse.json({ error: "Not available here." }, { status: 404 });
  }
  // A page on another site must not be able to spend the user's key or read
  // their figures through this local server.
  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: "Cross-site request refused." }, { status: 403 });
  }
  if (!req.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return NextResponse.json({ error: "Expected application/json." }, { status: 415 });
  }
  const entitlement = getEntitlement();
  if (!entitlement.allowed) {
    return NextResponse.json({ error: "budgetr's trial has ended." }, { status: 402 });
  }

  const status = getAssistantStatus();
  const apiKey = getAssistantKey();
  if (!status.ready || !apiKey) {
    return NextResponse.json(
      {
        error: !status.enabled
          ? "The AI assistant is switched off in Settings."
          : !apiKey
            ? "Add your Anthropic API key in Settings → AI assistant."
            : "Read and accept the data notice first.",
      },
      { status: 409 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }
  const parsed = parseChatRequest(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const client = new Anthropic({ apiKey, maxRetries: 2 });
  const model = getAssistantModel();
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (e: StreamEvent) => {
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(e)}\n`));
        } catch {
          // The client went away; the abort signal stops the loop.
        }
      };
      await runAssistant({
        client,
        model,
        turns: parsed.turns,
        emit,
        today: localToday(),
        signal: req.signal,
      });
      emit({ t: "done" });
      try {
        controller.close();
      } catch {
        // already closed by a disconnect
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
