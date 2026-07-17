import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-full text-sm font-medium tracking-tight transition-all duration-200 disabled:opacity-45 disabled:pointer-events-none active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brass)]",
  {
    variants: {
      variant: {
        primary:
          "bg-[var(--jade)] text-[var(--on-jade)] hover:brightness-105 hover:shadow-[0_8px_24px_-10px_rgba(111,227,166,0.6)]",
        secondary:
          "border border-line bg-[var(--panel)] text-[var(--paper)] hover:border-[var(--line-strong)] hover:bg-[var(--panel-2)]",
        outline:
          "border border-[var(--brass-dim)] text-[var(--brass)] hover:bg-[color-mix(in_srgb,var(--brass)_12%,transparent)]",
        ghost: "text-[var(--muted)] hover:text-[var(--paper)] hover:bg-[var(--panel)]",
      },
      size: {
        sm: "h-8 px-3.5",
        md: "h-10 px-5",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export function Button({ className, variant, size, ...props }: ButtonProps) {
  return <button className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
