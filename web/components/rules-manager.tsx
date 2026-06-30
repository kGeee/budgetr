"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Trash2, Wand2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createTagRule, deleteTagRule } from "@/lib/actions";
import type { TagRuleRow } from "@/lib/queries";

export function RulesManager({ rules }: { rules: TagRuleRow[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [adding, setAdding] = useState(false);
  const [pattern, setPattern] = useState("");
  const [tag, setTag] = useState("");

  function add() {
    if (!pattern.trim() || !tag.trim()) {
      setAdding(false);
      return;
    }
    start(async () => {
      await createTagRule(pattern, tag);
      setPattern("");
      setTag("");
      setAdding(false);
      router.refresh();
    });
  }

  function remove(id: string) {
    start(async () => {
      await deleteTagRule(id);
      router.refresh();
    });
  }

  return (
    <div className="overflow-hidden rounded-[var(--radius)] border border-line bg-[var(--panel)]">
      <ul>
        {rules.map((r) => (
          <li
            key={r.id}
            className={`flex items-center gap-3 border-b border-line/60 px-5 py-3.5 last:border-0 ${pending ? "opacity-60" : ""}`}
          >
            <Wand2 size={15} className="shrink-0 text-[var(--brass)]" />
            <div className="min-w-0 flex-1 text-sm">
              <span className="text-[var(--muted)]">contains</span>{" "}
              <span className="font-medium">{r.label || r.pattern}</span>{" "}
              <span className="text-[var(--muted)]">→</span>{" "}
              <span className="rounded-full border border-line px-2 py-0.5 text-xs">
                #{r.tagName}
              </span>
            </div>
            <span className="mono shrink-0 text-xs text-[var(--muted)]">{r.matches} match{r.matches === 1 ? "" : "es"}</span>
            <button
              onClick={() => remove(r.id)}
              aria-label="Delete rule"
              className="shrink-0 rounded-md p-1.5 text-[var(--faint)] transition hover:text-[var(--coral)]"
            >
              <Trash2 size={14} />
            </button>
          </li>
        ))}
        {rules.length === 0 && !adding && (
          <li className="px-5 py-6 text-sm text-[var(--muted)]">
            No rules yet. Tag a transaction and choose “always tag this vendor”, or add one below.
          </li>
        )}
      </ul>

      {adding ? (
        <div className={`flex flex-wrap items-center gap-2 border-t border-line px-5 py-3 ${pending ? "opacity-60" : ""}`}>
          <span className="text-sm text-[var(--muted)]">When name contains</span>
          <input
            autoFocus
            value={pattern}
            onChange={(e) => setPattern(e.target.value)}
            placeholder="e.g. uber"
            className="w-32 rounded-md border border-line bg-[var(--ink)] px-2 py-1.5 text-sm outline-none focus:border-[var(--brass-dim)]"
          />
          <span className="text-sm text-[var(--muted)]">tag it</span>
          <input
            value={tag}
            onChange={(e) => setTag(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add()}
            placeholder="rideshare"
            className="w-32 rounded-md border border-line bg-[var(--ink)] px-2 py-1.5 text-sm outline-none focus:border-[var(--brass-dim)]"
          />
          <Button size="sm" onClick={add} disabled={pending}>
            <Check size={14} /> Add
          </Button>
          <button
            onClick={() => setAdding(false)}
            aria-label="Cancel"
            className="rounded-md p-1.5 text-[var(--faint)] hover:text-[var(--paper)]"
          >
            <X size={16} />
          </button>
        </div>
      ) : (
        <button
          onClick={() => setAdding(true)}
          className="flex w-full items-center gap-2 border-t border-line px-5 py-3.5 text-sm text-[var(--muted)] transition-colors hover:bg-[var(--panel-2)] hover:text-[var(--paper)]"
        >
          <Wand2 size={15} /> Add rule
        </button>
      )}
    </div>
  );
}
