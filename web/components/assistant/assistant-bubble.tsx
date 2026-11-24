"use client";

/**
 * The optional AI assistant: a floating bubble that opens a compact chat
 * panel. Only mounted when the user has switched the assistant on in
 * Settings (see app/(app)/layout.tsx).
 *
 * The conversation lives in this component's state only. Nothing is stored;
 * clearing or reloading forgets it. Each question is sent to /api/assistant,
 * which streams back text, a status line while data is looked up, and chart
 * specs that are drawn here with the app's own chart components.
 */

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowUp, Loader2, MessageCircle, RotateCcw, Sparkles, Square, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { acceptAssistantNotice } from "@/lib/actions/assistant";
import type { StreamEvent } from "@/lib/assistant/request";
import { applyEvent, toTurns, type Msg, type Part } from "./chat-state";
import { AssistantChart } from "./assistant-chart";
import { AssistantText } from "./assistant-text";

const SUGGESTIONS = [
  "How much did I spend on dining out each month this year?",
  "How has my net worth changed over the past year?",
  "Which categories am I over budget on this month?",
  "What are my biggest recurring charges?",
];

export function AssistantBubble({
  hasKey,
  noticeAcknowledged,
  modelLabel,
}: {
  hasKey: boolean;
  noticeAcknowledged: boolean;
  modelLabel: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  // Accepted on the server (prop) or just now in this panel.
  const [acceptedHere, setAcceptedHere] = useState(false);
  const ack = noticeAcknowledged || acceptedHere;
  const [messages, setMessages] = useState<Msg[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [accepting, startAccept] = useTransition();
  const abortRef = useRef<AbortController | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Keep the newest content in view while an answer streams in.
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const updateLast = (fn: (m: Extract<Msg, { role: "assistant" }>) => Extract<Msg, { role: "assistant" }>) =>
    setMessages((ms) => {
      const last = ms[ms.length - 1];
      if (!last || last.role !== "assistant") return ms;
      return [...ms.slice(0, -1), fn(last)];
    });

  async function ask(question: string) {
    const q = question.trim();
    if (!q || busy) return;
    const history: Msg[] = [...messages, { role: "user", text: q }];
    setMessages([...history, { role: "assistant", parts: [], streaming: true, status: "Thinking" }]);
    setDraft("");
    setBusy(true);
    const controller = new AbortController();
    abortRef.current = controller;
    const snapshot = { parts: [] as Part[] };

    try {
      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: toTurns(history) }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        updateLast((m) => ({ ...m, streaming: false, status: undefined, error: body?.error ?? "Couldn't reach the assistant." }));
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (!line) continue;
          let event: StreamEvent;
          try {
            event = JSON.parse(line) as StreamEvent;
          } catch {
            continue;
          }
          updateLast((m) => applyEvent(m, event, snapshot));
        }
      }
    } catch (err) {
      if ((err as Error)?.name !== "AbortError") {
        updateLast((m) => ({ ...m, error: "The connection dropped. Try again." }));
      }
    } finally {
      updateLast((m) => ({ ...m, streaming: false, status: undefined }));
      setBusy(false);
      abortRef.current = null;
    }
  }

  const stop = () => abortRef.current?.abort();
  const clear = () => {
    stop();
    setMessages([]);
  };

  const accept = () =>
    startAccept(async () => {
      const r = await acceptAssistantNotice();
      if (r.ok) {
        setAcceptedHere(true);
        router.refresh();
      }
    });

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? "Close the AI assistant" : "Ask the AI assistant"}
        aria-expanded={open}
        className="fixed bottom-[max(1.25rem,env(safe-area-inset-bottom))] right-5 z-30 grid h-12 w-12 place-items-center rounded-full bg-[var(--jade)] text-[var(--on-jade)] shadow-[0_12px_32px_-10px_rgba(0,0,0,0.6)] transition-transform hover:scale-105 active:scale-95 print:hidden"
      >
        {open ? <X size={20} /> : <Sparkles size={20} />}
      </button>

      {open && (
        <section
          role="dialog"
          aria-label="AI assistant"
          className="material-thick fixed bottom-[calc(max(1.25rem,env(safe-area-inset-bottom))+3.75rem)] right-4 z-40 flex h-[min(640px,calc(100dvh-7rem))] w-[min(420px,calc(100vw-2rem))] flex-col overflow-hidden rounded-[var(--radius)] border border-line shadow-[0_30px_80px_-24px_rgba(0,0,0,0.75)] print:hidden"
        >
          <header className="flex items-center gap-2 border-b border-line px-4 py-3">
            <MessageCircle size={16} className="text-[var(--jade)]" aria-hidden />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">Ask about your money</div>
              <div className="truncate text-[11px] text-[var(--muted)]">{modelLabel} · your own Anthropic key</div>
            </div>
            {messages.length > 0 && (
              <button
                type="button"
                onClick={clear}
                aria-label="Start a new conversation"
                title="New conversation"
                className="grid h-8 w-8 place-items-center rounded-full text-[var(--muted)] hover:bg-[var(--panel-2)] hover:text-[var(--paper)]"
              >
                <RotateCcw size={15} />
              </button>
            )}
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close"
              className="grid h-8 w-8 place-items-center rounded-full text-[var(--muted)] hover:bg-[var(--panel-2)] hover:text-[var(--paper)]"
            >
              <X size={16} />
            </button>
          </header>

          {!hasKey ? (
            <div className="flex flex-1 flex-col justify-center gap-3 p-6 text-sm">
              <p>The assistant needs your own Anthropic API key before it can answer anything.</p>
              <Link href="/settings#assistant" className="text-[var(--jade)] underline" onClick={() => setOpen(false)}>
                Add your key in Settings
              </Link>
            </div>
          ) : !ack ? (
            <div className="flex flex-1 flex-col justify-center gap-4 p-6 text-sm">
              <p className="font-medium">Before you ask anything</p>
              <NoticeText />
              <div>
                <Button onClick={accept} disabled={accepting}>
                  {accepting && <Loader2 size={15} className="animate-spin" />}I understand
                </Button>
              </div>
            </div>
          ) : (
            <>
              <div ref={listRef} className="flex-1 space-y-4 overflow-y-auto px-4 py-4" aria-live="polite">
                {messages.length === 0 && (
                  <div className="space-y-3">
                    <p className="text-[13px] text-[var(--muted)]">
                      Ask a question about your spending, budgets, accounts or investments. Answers can include
                      charts.
                    </p>
                    <ul className="space-y-1.5">
                      {SUGGESTIONS.map((s) => (
                        <li key={s}>
                          <button
                            type="button"
                            onClick={() => ask(s)}
                            className="w-full rounded-lg border border-line px-3 py-2 text-left text-[13px] text-[var(--muted)] transition-colors hover:border-[var(--line-strong)] hover:text-[var(--paper)]"
                          >
                            {s}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {messages.map((m, i) =>
                  m.role === "user" ? (
                    <div key={i} className="flex justify-end">
                      <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-[var(--panel-2)] px-3 py-2 text-[13.5px]">
                        {m.text}
                      </p>
                    </div>
                  ) : (
                    <div key={i} className="space-y-3">
                      {m.parts.map((p, j) =>
                        p.kind === "chart" ? (
                          <AssistantChart key={j} spec={p.spec} />
                        ) : p.text.trim() ? (
                          <AssistantText key={j} text={p.text} />
                        ) : null,
                      )}
                      {m.status && (
                        <p className="flex items-center gap-2 text-[12px] text-[var(--muted)]">
                          <Loader2 size={13} className="animate-spin" aria-hidden />
                          {m.status}…
                        </p>
                      )}
                      {m.error && (
                        <p className="rounded-lg border border-[color-mix(in_srgb,var(--coral)_40%,transparent)] px-3 py-2 text-[12.5px] text-[var(--coral)]">
                          {m.error}
                          {/key|Settings/.test(m.error) && (
                            <>
                              {" "}
                              <Link href="/settings#assistant" className="underline" onClick={() => setOpen(false)}>
                                Open Settings
                              </Link>
                            </>
                          )}
                        </p>
                      )}
                    </div>
                  ),
                )}
              </div>

              <form
                className="border-t border-line p-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  ask(draft);
                }}
              >
                <div className="flex items-end gap-2 rounded-2xl border border-line bg-[var(--panel)] px-3 py-2 focus-within:border-[var(--brass-dim)]">
                  <textarea
                    ref={inputRef}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                        e.preventDefault();
                        ask(draft);
                      }
                    }}
                    rows={1}
                    maxLength={2000}
                    placeholder="Ask about your money…"
                    aria-label="Your question"
                    className="max-h-32 min-h-[24px] flex-1 resize-none !bg-transparent text-[13.5px] outline-none"
                  />
                  {busy ? (
                    <button
                      type="button"
                      onClick={stop}
                      aria-label="Stop"
                      className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[var(--panel-2)] text-[var(--paper)]"
                    >
                      <Square size={12} fill="currentColor" />
                    </button>
                  ) : (
                    <button
                      type="submit"
                      disabled={!draft.trim()}
                      aria-label="Send"
                      className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[var(--jade)] text-[var(--on-jade)] disabled:opacity-40"
                    >
                      <ArrowUp size={16} />
                    </button>
                  )}
                </div>
                <p className="mt-1.5 px-1 text-[10.5px] text-[var(--faint)]">
                  Questions and the figures needed to answer them go to Anthropic. AI can make mistakes.
                </p>
              </form>
            </>
          )}
        </section>
      )}
    </>
  );
}

/** What is sent where. Shown once in the panel and always in Settings. */
export function NoticeText() {
  return (
    <div className="space-y-2 text-[13px] text-[var(--muted)]">
      <p>
        budgetr keeps your data on this Mac. The assistant is the one exception: when you ask a question, the
        question and the figures needed to answer it (for example category totals, balances or matching
        transactions) are sent from this Mac to Anthropic, using your own API key.
      </p>
      <p>
        Nothing is sent until you ask, and nothing goes to budgetr&apos;s developers. Anthropic&apos;s API terms and your key&apos;s
        settings govern how they handle it. Charges for each question go to your Anthropic account.
      </p>
    </div>
  );
}
