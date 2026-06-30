import { cn } from "@/lib/utils";

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Opt-in hover lift + border highlight for cards that are genuinely clickable. */
  interactive?: boolean;
}

export function Card({ className, interactive, ...props }: CardProps) {
  return (
    <div
      className={cn(
        "rounded-[var(--radius)] border border-line bg-gradient-to-b from-[var(--panel-2)] to-[var(--panel)] p-6 shadow-[var(--elev-2)]",
        interactive && "lift cursor-pointer",
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("mb-5 flex items-start justify-between gap-3", className)}
      {...props}
    />
  );
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn("eyebrow", className)} {...props} />;
}
