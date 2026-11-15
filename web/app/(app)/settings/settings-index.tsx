"use client";

import { useEffect, useState } from "react";

export type SettingsSection = {
  id: string;
  label: string;
  /** Anchors inside this section, listed indented under it. */
  children?: { id: string; label: string }[];
};

/**
 * The section index beside the settings. On wide screens it is a column that
 * stays in view while the sections scroll, with the one you are reading marked;
 * on narrow screens it folds into a wrapping row of links above them.
 *
 * Plain anchor links — the marking is an enhancement. Without script the links
 * still jump, they just don't follow the scroll.
 */
export function SettingsIndex({ sections }: { sections: SettingsSection[] }) {
  const [active, setActive] = useState(sections[0]?.id ?? "");

  useEffect(() => {
    const nodes = sections
      .map((s) => document.getElementById(s.id))
      .filter((n): n is HTMLElement => n !== null);
    if (nodes.length === 0) return;

    // A section is "current" once its top has passed under the sticky header
    // and until the next one does: the last section whose top is above the line.
    const visible = new Set<string>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) visible.add(e.target.id);
          else visible.delete(e.target.id);
        }
        const first = sections.find((s) => visible.has(s.id));
        if (first) setActive(first.id);
      },
      { rootMargin: "-96px 0px -55% 0px" },
    );
    for (const n of nodes) observer.observe(n);
    return () => observer.disconnect();
  }, [sections]);

  return (
    <nav
      aria-label="Settings sections"
      className="flex flex-wrap gap-x-1 gap-y-0.5 lg:sticky lg:top-24 lg:flex-col lg:flex-nowrap lg:self-start"
    >
      {sections.map((s) => {
        const on = s.id === active;
        return (
          <div key={s.id} className="contents lg:block">
            <a
              href={`#${s.id}`}
              aria-current={on ? "true" : undefined}
              onClick={() => setActive(s.id)}
              className={`flex min-h-11 items-center border-l-2 px-3 text-sm font-medium transition-colors ${
                on
                  ? "border-[var(--brass)] text-[var(--paper)]"
                  : "border-line text-[var(--muted)] hover:text-[var(--paper)]"
              }`}
            >
              {s.label}
            </a>
            {s.children?.map((c) => (
              <a
                key={c.id}
                href={`#${c.id}`}
                onClick={() => setActive(s.id)}
                className={`flex min-h-9 items-center border-l-2 px-3 text-[13px] text-[var(--muted)] transition-colors hover:text-[var(--paper)] lg:pl-6 ${
                  on ? "border-[var(--brass)]" : "border-line"
                }`}
              >
                {c.label}
              </a>
            ))}
          </div>
        );
      })}
    </nav>
  );
}
