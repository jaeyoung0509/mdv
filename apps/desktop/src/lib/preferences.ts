import type { FontPreset, ReaderBookmark, ReaderPreferences } from "./types";

export const DEFAULT_READER_PREFERENCES: ReaderPreferences = {
  theme: "system",
  fontPreset: "sans",
  fontSize: 16,
  lineHeight: 1.7,
  contentWidth: 780,
  outlineVisible: true,
  bookmarks: {},
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

function normalizeBookmarks(
  bookmarks: Partial<ReaderPreferences>["bookmarks"],
): Record<string, ReaderBookmark[]> {
  if (!bookmarks || typeof bookmarks !== "object") {
    return {};
  }

  return Object.fromEntries(
    Object.entries(bookmarks)
      .map(([documentPath, documentBookmarks]) => {
        const normalizedBookmarks = Array.isArray(documentBookmarks)
          ? documentBookmarks
              .map((bookmark) => ({
                id: String(bookmark.id || ""),
                label: String(bookmark.label || "Bookmark"),
                scrollY: clamp(Number(bookmark.scrollY) || 0, 0, 4_294_967_295),
                headingId: bookmark.headingId ? String(bookmark.headingId) : undefined,
                createdAt: Number(bookmark.createdAt) || Date.now(),
              }))
              .filter((bookmark) => bookmark.id)
              .slice(0, 40)
          : [];

        return [documentPath, normalizedBookmarks] as const;
      })
      .filter(([documentPath, documentBookmarks]) => documentPath && documentBookmarks.length > 0),
  );
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
    bookmarks: normalizeBookmarks(preferences.bookmarks),
  };
}
