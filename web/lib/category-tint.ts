/**
 * A stable hue per category, so a category's dot is the same colour on every
 * page before its name is read. The ring matches the one Budgets and Shared
 * use; lightness and saturation come from the theme's `.tint` class, so one
 * hue works on both canvases.
 */
export const TINT_HUES = [152, 40, 208, 12, 268, 96, 330, 186] as const;

export function categoryHue(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return TINT_HUES[h % TINT_HUES.length];
}
