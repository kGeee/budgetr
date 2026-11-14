"use client";

import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The one modal surface. Every dialog in the app used to hand-roll its own
 * scrim + panel, and none of them closed on Escape, held focus inside, or gave
 * it back afterwards. This does those four things once:
 *
 *  - Escape and a click on the scrim both call `onClose`
 *  - Tab cycles inside the panel instead of wandering into the page behind it
 *  - focus lands in the panel on open (an `autoFocus` child still wins) and
 *    returns to whatever opened it on close
 *  - the page behind stops scrolling
 *
 * It is mounted only while open — render it conditionally.
 */

const SIZES = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-lg",
  xl: "max-w-xl",
  "2xl": "max-w-3xl",
} as const;

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Dialog({
  onClose,
  children,
  label,
  size = "sm",
  align = "center",
  className,
}: {
  onClose: () => void;
  children: React.ReactNode;
  /** Accessible name. Omit only when the content carries its own heading id. */
  label?: string;
  size?: keyof typeof SIZES;
  /** "top" pins the panel near the top — for palettes and tall, growing forms. */
  align?: "center" | "top";
  className?: string;
}) {
  const panel = useRef<HTMLDivElement>(null);
  // The handlers below are bound once; this keeps them calling the latest
  // `onClose` without re-running the focus/scroll effect on every render.
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });

  useEffect(() => {
    const node = panel.current;
    const opener = document.activeElement as HTMLElement | null;
    if (node && !node.contains(document.activeElement)) node.focus();

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        close.current();
        return;
      }
      if (e.key !== "Tab" || !node) return;
      const items = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null,
      );
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const current = document.activeElement;
      if (e.shiftKey && (current === first || current === node)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && current === last) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      opener?.focus?.();
    };
  }, []);

  return (
    <div
      className={cn(
        "fixed inset-0 z-50 flex justify-center overflow-y-auto bg-[var(--scrim)] p-4",
        align === "top" ? "items-start pt-[12vh]" : "items-center",
      )}
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      role="presentation"
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        className={cn(
          "w-full overflow-hidden rounded-[var(--radius)] border border-line bg-[var(--panel)] text-[var(--paper)] shadow-[var(--elev-3)] outline-none",
          SIZES[size],
          className,
        )}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * Ruled header: a display-face title, an optional line under it, and the close
 * button every dialog should have in the same corner.
 */
export function DialogHeader({
  title,
  description,
  onClose,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  onClose?: () => void;
}) {
  return (
    <div className="flex shrink-0 items-start justify-between gap-3 border-b border-line px-5 py-4">
      <div className="min-w-0">
        <h2 className="font-display text-xl tracking-tight">{title}</h2>
        {description && <p className="mt-1 text-sm text-[var(--muted)]">{description}</p>}
      </div>
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="-mr-1.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg text-[var(--muted)] transition-colors hover:bg-[var(--panel-2)] hover:text-[var(--paper)]"
        >
          <X size={18} />
        </button>
      )}
    </div>
  );
}

export function DialogBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("min-h-0 flex-1 overflow-y-auto px-5 py-5", className)} {...props} />;
}

/** Ruled footer; actions sit right, with the primary one last. */
export function DialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-line px-5 py-3.5",
        className,
      )}
      {...props}
    />
  );
}
