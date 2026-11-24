/**
 * Renders the assistant's reply text. Deliberately tiny and safe: paragraphs,
 * "- " bullet lists and **bold**, built as React elements. No HTML from the
 * model is ever injected, and links are shown as plain text.
 */

import { Fragment } from "react";

function inline(text: string, keyBase: string) {
  // Split on **bold** spans; odd indexes are the bold parts.
  const parts = text.split(/\*\*(.+?)\*\*/g);
  return parts.map((p, i) =>
    i % 2 === 1 ? (
      <strong key={`${keyBase}-${i}`} className="font-semibold text-[var(--paper)]">
        {p}
      </strong>
    ) : (
      <Fragment key={`${keyBase}-${i}`}>{p}</Fragment>
    ),
  );
}

export type TextBlock = { kind: "p"; text: string } | { kind: "ul"; items: string[] };

/** Group lines into paragraphs and bullet lists. Exported for tests. */
export function toBlocks(text: string): TextBlock[] {
  const blocks: TextBlock[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) blocks.push({ kind: "p", text: para.join(" ") });
    para = [];
  };
  for (const raw of text.split("\n")) {
    const line = raw.trim().replace(/^#{1,6}\s+/, ""); // headings read as plain lines
    const bullet = /^[-*•]\s+(.*)$/.exec(line) ?? /^\d+[.)]\s+(.*)$/.exec(line);
    if (bullet) {
      flush();
      const last = blocks[blocks.length - 1];
      if (last?.kind === "ul") last.items.push(bullet[1]);
      else blocks.push({ kind: "ul", items: [bullet[1]] });
    } else if (line === "") {
      flush();
    } else {
      para.push(line);
    }
  }
  flush();
  return blocks;
}

export function AssistantText({ text }: { text: string }) {
  const blocks = toBlocks(text);
  return (
    <div className="space-y-2 text-[13.5px] leading-relaxed">
      {blocks.map((b, i) =>
        b.kind === "p" ? (
          <p key={i}>{inline(b.text, `p${i}`)}</p>
        ) : (
          <ul key={i} className="list-disc space-y-1 pl-4 marker:text-[var(--muted)]">
            {b.items.map((item, j) => (
              <li key={j}>{inline(item, `l${i}-${j}`)}</li>
            ))}
          </ul>
        ),
      )}
    </div>
  );
}
