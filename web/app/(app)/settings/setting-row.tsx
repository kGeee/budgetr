import { cn } from "@/lib/utils";

/**
 * Settings is one ruled page, not a stack of cards: each section sits under a
 * SectionHead and each setting is one row — what it does on the left, the
 * control on the right. Plain markup with no hooks, so the server page and the
 * client forms it hosts can share it.
 */

/** The ruled list a section's rows sit in. */
export function SettingRows({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  // Each row rules itself off underneath, so a section never ends ragged.
  return <div className={cn(className)}>{children}</div>;
}

export function SettingRow({
  title,
  children,
  control,
  align = "center",
}: {
  title: React.ReactNode;
  /** What the setting does. */
  children?: React.ReactNode;
  control?: React.ReactNode;
  /** "start" for tall controls (a form, a QR code) so the label stays at the top. */
  align?: "center" | "start";
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap justify-between gap-x-8 gap-y-3 border-b border-line py-3.5",
        align === "start" ? "items-start" : "items-center"
      )}
    >
      <div className="min-w-0 max-w-lg flex-[1_1_300px]">
        <div className="font-medium">{title}</div>
        {children && <div className="mt-0.5 text-[13px] text-[var(--muted)]">{children}</div>}
      </div>
      {control && <div className="min-w-0 max-w-full shrink-0">{control}</div>}
    </div>
  );
}

/** The sentence or two under a SectionHead that says what the section is for. */
export function SectionIntro({ children }: { children: React.ReactNode }) {
  return (
    <p className="max-w-xl border-b border-line py-3.5 text-[13px] text-[var(--muted)]">{children}</p>
  );
}
