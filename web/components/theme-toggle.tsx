"use client";

import { useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { THEME_COOKIE, THEMES, type Theme } from "@/lib/theme";

const ONE_YEAR = 60 * 60 * 24 * 365;

const META: Record<Theme, { label: string; Icon: typeof Sun }> = {
  dark: { label: "Dark", Icon: Moon },
  light: { label: "Light", Icon: Sun },
  system: { label: "System", Icon: Monitor },
};

/**
 * Persist the choice + flip the palette instantly. Writing `data-theme` on <html>
 * re-resolves every CSS variable with no reload; the cookie keeps SSR and the
 * next navigation in sync. Mirrors the cookie pattern in obfuscation/currency.
 */
function applyTheme(theme: Theme) {
  document.cookie = `${THEME_COOKIE}=${theme}; path=/; max-age=${ONE_YEAR}; samesite=lax`;
  document.documentElement.setAttribute("data-theme", theme);
}

/** Compact header control — cycles Dark → Light → System. */
export function ThemeToggle({ initialTheme }: { initialTheme: Theme }) {
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const { label, Icon } = META[theme];

  function cycle() {
    const next = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];
    setTheme(next);
    applyTheme(next);
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={cycle}
      aria-label={`Theme: ${label}. Click to change.`}
      title={`Theme: ${label} — click to change`}
    >
      <Icon size={15} />
      <span className="hidden sm:inline">{label}</span>
    </Button>
  );
}

/** Three-way segmented control for the Settings → Appearance card. */
export function ThemeSegmented({ initialTheme }: { initialTheme: Theme }) {
  const [theme, setTheme] = useState<Theme>(initialTheme);

  return (
    <div className="inline-flex rounded-lg border border-line p-0.5">
      {THEMES.map((t) => {
        const active = t === theme;
        const { label, Icon } = META[t];
        return (
          <button
            key={t}
            type="button"
            onClick={() => {
              setTheme(t);
              applyTheme(t);
            }}
            aria-pressed={active}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors ${
              active
                ? "bg-[var(--panel-2)] text-[var(--paper)]"
                : "text-[var(--muted)] hover:text-[var(--paper)]"
            }`}
          >
            <Icon size={14} className={active ? "text-[var(--brass)]" : ""} />
            {label}
          </button>
        );
      })}
    </div>
  );
}
