import type { FontPreset, ReaderPreferences } from "./types";

export const DEFAULT_READER_PREFERENCES: ReaderPreferences = {
  theme: "system",
  fontPreset: "sans",
  fontSize: 16,
  lineHeight: 1.7,
  contentWidth: 780,
  outlineVisible: true,
};

export const FONT_PRESET_LABELS: Record<FontPreset, string> = {
  sans: "Sans",
  serif: "Serif",
  mono: "Mono",
};

export const FONT_PRESET_STACKS: Record<FontPreset, string> = {
  sans: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  serif: 'ui-serif, Georgia, Cambria, "Times New Roman", Times, serif',
  mono: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function normalizeReaderPreferences(
  preferences: Partial<ReaderPreferences>,
): ReaderPreferences {
  const fontPreset = preferences.fontPreset;
  const theme = preferences.theme;

  return {
    theme:
      theme === "light" || theme === "dark" || theme === "system"
        ? theme
        : DEFAULT_READER_PREFERENCES.theme,
    fontPreset:
      fontPreset === "sans" || fontPreset === "serif" || fontPreset === "mono"
        ? fontPreset
        : DEFAULT_READER_PREFERENCES.fontPreset,
    fontSize: clamp(Number(preferences.fontSize) || DEFAULT_READER_PREFERENCES.fontSize, 14, 22),
    lineHeight: clamp(
      Number(preferences.lineHeight) || DEFAULT_READER_PREFERENCES.lineHeight,
      1.45,
      1.95,
    ),
    contentWidth: clamp(
      Number(preferences.contentWidth) || DEFAULT_READER_PREFERENCES.contentWidth,
      680,
      960,
    ),
    outlineVisible:
      typeof preferences.outlineVisible === "boolean"
        ? preferences.outlineVisible
        : DEFAULT_READER_PREFERENCES.outlineVisible,
  };
}
