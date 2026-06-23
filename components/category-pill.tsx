import {
  ArrowDownLeft,
  ArrowUpRight,
  Building2,
  Car,
  Clapperboard,
  Hammer,
  HeartPulse,
  Landmark,
  Plane,
  Plug,
  Receipt,
  ShoppingBag,
  Sparkles,
  Tag,
  UtensilsCrossed,
  Wallet,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

/** Registry for category icons stored as lucide names in the DB. */
const ICONS: Record<string, LucideIcon> = {
  Wallet,
  ArrowDownLeft,
  ArrowUpRight,
  Landmark,
  Receipt,
  Clapperboard,
  UtensilsCrossed,
  ShoppingBag,
  Hammer,
  HeartPulse,
  Sparkles,
  Wrench,
  Building2,
  Car,
  Plane,
  Plug,
  Tag,
};

export function CategoryIcon({
  icon,
  size = 14,
  className,
}: {
  icon: string | null | undefined;
  size?: number;
  className?: string;
}) {
  const Icon = (icon && ICONS[icon]) || Tag;
  return <Icon size={size} className={className} />;
}

/** Icon + name chip used across transactions, the detail drawer, and budgets. */
export function CategoryPill({
  name,
  icon,
  className,
}: {
  name: string;
  icon?: string | null;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full bg-[var(--panel-2)] px-2.5 py-1 text-xs text-[var(--muted)]",
        className,
      )}
    >
      <CategoryIcon icon={icon} size={13} className="text-[var(--brass)]" />
      <span className="truncate">{name}</span>
    </span>
  );
}
