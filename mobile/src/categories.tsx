// Category vocabulary — the phone renders the DESKTOP's names and icons
// (Summary.categories), so "cat_general_merchandise" shows as "Shopping" with
// the same lucide glyph as the web app. Prettified keys are only the fallback
// for summaries that predate the field.

import React from "react";
import { Text } from "react-native";
import * as Lucide from "lucide-react-native";
import type { CategoryInfo, Summary } from "@budgetr/core";
import { categoryLabel } from "@/format";

export function categoryIndex(summary: Summary | null): Map<string, CategoryInfo> {
  const map = new Map<string, CategoryInfo>();
  for (const c of summary?.categories ?? []) map.set(c.id, c);
  return map;
}

/** Display name for a category key — desktop name first, prettified key last. */
export function catName(index: Map<string, CategoryInfo>, key: string): string {
  return index.get(key)?.name ?? categoryLabel(key);
}

/**
 * The picker list: every active category from the desktop, in its display
 * order (income → spending → transfer, then sort order). Falls back to the
 * keys seen in this summary when the vocabulary hasn't synced yet.
 */
export function pickerCategories(summary: Summary | null): CategoryInfo[] {
  if (summary?.categories?.length) return summary.categories;
  const keys = new Set<string>();
  for (const b of summary?.budgets ?? []) keys.add(b.category);
  for (const t of summary?.recent ?? []) keys.add(t.category);
  return [...keys].sort().map((id) => ({ id, name: categoryLabel(id), group: "spending" as const }));
}

/** The desktop's category glyph: lucide name → the same icon; emoji → as-is. */
export function CategoryIcon({ icon, size = 14, color }: { icon?: string; size?: number; color: string }) {
  if (!icon) return null;
  const Glyph = (Lucide as unknown as Record<string, React.ComponentType<{ size?: number; color?: string }>>)[icon];
  if (Glyph && /^[A-Z]/.test(icon)) return <Glyph size={size} color={color} />;
  return <Text style={{ fontSize: size - 1 }}>{icon}</Text>; // emoji or free text
}
