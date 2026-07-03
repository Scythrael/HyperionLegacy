// Theme persistence — a display preference, deliberately separate from
// src/lib/game/save.ts's save-file contract so it survives a "delete save."

export const THEME_NAMES = ["cyan", "green", "blue", "red", "white", "gray"] as const;
export type ThemeName = (typeof THEME_NAMES)[number];

export const DEFAULT_THEME: ThemeName = "cyan";

const THEME_KEY = "fleet_admiral_theme";

// Swatch preview colors for the options menu — intentionally duplicated
// from app.css's [data-theme="..."] blocks rather than read back from
// computed styles, since that would require a DOM measurement trick for
// no real benefit in a 6-entry hobby-scope lookup table. Keep these in
// sync with app.css by hand if a theme's accent color ever changes.
export const THEME_PREVIEW_COLORS: Record<ThemeName, string> = {
  cyan: "#67e8f9",
  green: "#67f9a8",
  blue: "#6798f9",
  red: "#f96767",
  white: "#e8e8f0",
  gray: "#a0a8b0",
};

export function isValidTheme(name: string | null): name is ThemeName {
  return (THEME_NAMES as readonly string[]).includes(name ?? "");
}

export function loadTheme(): ThemeName {
  const raw = localStorage.getItem(THEME_KEY);
  return isValidTheme(raw) ? raw : DEFAULT_THEME;
}

export function saveTheme(name: ThemeName): void {
  localStorage.setItem(THEME_KEY, name);
}
