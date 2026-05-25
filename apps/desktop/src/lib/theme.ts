import type { AppTheme, EffectiveTheme } from "./types";

const darkQuery = "(prefers-color-scheme: dark)";

export function getSystemTheme(): EffectiveTheme {
  return window.matchMedia(darkQuery).matches ? "dark" : "light";
}

export function getEffectiveTheme(theme: AppTheme): EffectiveTheme {
  return theme === "system" ? getSystemTheme() : theme;
}

export function applyTheme(theme: AppTheme): EffectiveTheme {
  const effectiveTheme = getEffectiveTheme(theme);
  document.documentElement.dataset.theme = effectiveTheme;
  document.documentElement.dataset.themePreference = theme;
  return effectiveTheme;
}

export function subscribeToSystemTheme(callback: () => void): () => void {
  const media = window.matchMedia(darkQuery);
  media.addEventListener("change", callback);
  return () => media.removeEventListener("change", callback);
}
