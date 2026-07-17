/**
 * Theme preference — dark (default), light, or system (follow the OS).
 *
 * The choice lives in the `theme` cookie so the server can render the correct
 * `data-theme` on <html> and an inline pre-paint script can apply it before
 * first paint (no flash). The actual light/dark tokens are pure CSS in
 * app/globals.css keyed on `:root[data-theme="…"]` — "system" resolves via a
 * `prefers-color-scheme` media query, so no JS is needed to pick the palette.
 */

export const THEME_COOKIE = "theme";

export type Theme = "dark" | "light" | "system";

export const THEMES: Theme[] = ["dark", "light", "system"];

/** Parse the cookie into a valid Theme, defaulting to the brand's dark. */
export function themeFromCookie(value: string | undefined): Theme {
  return THEMES.includes(value as Theme) ? (value as Theme) : "dark";
}

/**
 * Inline script that runs before first paint: reads the `theme` cookie and sets
 * `data-theme` on <html> so the CSS variables resolve to the right palette with
 * no flash of the wrong theme. Kept dependency-free and tiny; injected verbatim
 * by the root layout.
 */
export const THEME_SCRIPT = `(function(){try{var m=document.cookie.match(/(?:^|; )theme=([^;]*)/);var t=m?decodeURIComponent(m[1]):'dark';if(t!=='light'&&t!=='system')t='dark';document.documentElement.setAttribute('data-theme',t);}catch(e){}})();`;
