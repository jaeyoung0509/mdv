import type {
  AiNoteThread,
  AiProvider,
  AiSettings,
  FontPreset,
  ReaderBookmark,
  ReaderPreferences,
} from "./types";

export const DEFAULT_AI_SETTINGS: AiSettings = {
  activeProviderId: "",
  providers: [],
};

export const DEFAULT_READER_PREFERENCES: ReaderPreferences = {
  theme: "system",
  fontPreset: "sans",
  fontSize: 16,
  lineHeight: 1.7,
  contentWidth: 780,
  outlineVisible: true,
  bookmarks: {},
  aiNotes: {},
  ai: DEFAULT_AI_SETTINGS,
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
              .map((bookmark) => {
                const oldBookmark = bookmark as Partial<ReaderBookmark> & {
                  scrollY?: unknown;
                  headingId?: unknown;
                };
                const fallbackScrollY = clamp(
                  Number(
                    bookmark.target?.kind === "heading"
                      ? bookmark.target.scrollYFallback
                      : bookmark.target?.kind === "offset"
                        ? bookmark.target.scrollY
                        : oldBookmark.scrollY,
                  ) || 0,
                  0,
                  4_294_967_295,
                );
                const headingId =
                  bookmark.target?.kind === "heading"
                    ? String(bookmark.target.headingId || "")
                    : oldBookmark.headingId
                      ? String(oldBookmark.headingId)
                      : "";

                return {
                  id: String(bookmark.id || ""),
                  label: String(bookmark.label || "Bookmark"),
                  target: headingId
                    ? {
                        kind: "heading" as const,
                        headingId,
                        scrollYFallback: fallbackScrollY,
                      }
                    : {
                        kind: "offset" as const,
                        scrollY: fallbackScrollY,
                      },
                  createdAt: Number(bookmark.createdAt) || Date.now(),
                };
              })
              .filter((bookmark) => bookmark.id)
              .slice(0, 40)
          : [];

        return [documentPath, normalizedBookmarks] as const;
      })
      .filter(([documentPath, documentBookmarks]) => documentPath && documentBookmarks.length > 0),
  );
}

function normalizeAiNotes(
  aiNotes: Partial<ReaderPreferences>["aiNotes"],
): Record<string, AiNoteThread[]> {
  if (!aiNotes || typeof aiNotes !== "object") {
    return {};
  }

  return Object.fromEntries(
    Object.entries(aiNotes)
      .map(([documentPath, documentNotes]) => {
        const normalizedNotes = Array.isArray(documentNotes)
          ? documentNotes
              .map((thread) => {
                const anchor = thread.anchor;
                const createdAt = Number(thread.createdAt) || Date.now();
                const updatedAt = Number(thread.updatedAt) || createdAt;
                const messages = Array.isArray(thread.messages)
                  ? thread.messages
                      .map((message) => ({
                        id: String(message.id || ""),
                        role: message.role === "user" ? ("user" as const) : ("assistant" as const),
                        content: String(message.content || ""),
                        createdAt: Number(message.createdAt) || createdAt,
                      }))
                      .filter((message) => message.id && message.content.trim())
                      .slice(-24)
                  : [];

                if (!anchor || !messages.length) {
                  return null;
                }

                const label = String(anchor.label || thread.title || "AI note").trim();
                const normalizedAnchor =
                  anchor.kind === "heading"
                    ? {
                        kind: "heading" as const,
                        headingId: String(anchor.headingId || ""),
                        label,
                        scrollYFallback: clamp(Number(anchor.scrollYFallback) || 0, 0, 4_294_967_295),
                      }
                    : anchor.kind === "lineRange"
                      ? {
                          kind: "lineRange" as const,
                          fromLine: clamp(Number(anchor.fromLine) || 1, 1, 4_294_967_295),
                          toLine: clamp(Number(anchor.toLine) || Number(anchor.fromLine) || 1, 1, 4_294_967_295),
                          label,
                        }
                      : {
                          kind: "offset" as const,
                          scrollY: clamp(Number(anchor.scrollY) || 0, 0, 4_294_967_295),
                          label,
                        };

                if (normalizedAnchor.kind === "heading" && !normalizedAnchor.headingId) {
                  return null;
                }

                return {
                  id: String(thread.id || ""),
                  anchor: normalizedAnchor,
                  title: String(thread.title || label || "AI note").trim(),
                  messages,
                  resolved: Boolean(thread.resolved),
                  createdAt,
                  updatedAt,
                };
              })
              .filter((thread): thread is AiNoteThread => Boolean(thread?.id))
              .slice(0, 80)
          : [];

        return [documentPath, normalizedNotes] as const;
      })
      .filter(([documentPath, documentNotes]) => documentPath && documentNotes.length > 0),
  );
}

function normalizeAiProvider(provider: Partial<AiProvider>, index: number): AiProvider | null {
  if (isGeneratedDefaultAiProvider(provider)) {
    return null;
  }

  const kind = provider.kind === "claude" ? "claude" : "openaiCompatible";
  const id = String(provider.id || `${kind}-${index}-${Date.now()}`).trim();
  const name = String(provider.name || id).trim();
  const baseUrl = String(provider.baseUrl || "").trim();
  const model = String(provider.model || "").trim();
  const reasoning = String(provider.reasoning || "").trim();
  const apiKey = String(provider.apiKey || "").trim();
  const hasApiKey = Boolean(apiKey || provider.hasApiKey);

  if (!id || !name) {
    return null;
  }

  return {
    id,
    name,
    kind,
    baseUrl,
    model,
    reasoning,
    apiKey,
    hasApiKey,
  };
}

function isGeneratedDefaultAiProvider(provider: Partial<AiProvider>): boolean {
  return (
    (provider.id === "openai-default" &&
      provider.baseUrl === "https://api.openai.com/v1" &&
      provider.model === "gpt-5.4-mini") ||
    (provider.id === "claude-default" &&
      provider.baseUrl === "https://api.anthropic.com/v1" &&
      provider.model === "claude-sonnet-4-6")
  );
}

export function normalizeAiSettings(ai: Partial<AiSettings> | undefined): AiSettings {
  const providers = (Array.isArray(ai?.providers) ? ai.providers : [])
    .map((provider, index) => normalizeAiProvider(provider, index))
    .filter((provider): provider is AiProvider => Boolean(provider))
    .slice(0, 8);
  const nextProviders = providers;
  const activeProviderId = nextProviders.some((provider) => provider.id === ai?.activeProviderId)
    ? String(ai?.activeProviderId)
    : nextProviders[0]?.id || "";

  return {
    activeProviderId,
    providers: nextProviders,
  };
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
    aiNotes: normalizeAiNotes(preferences.aiNotes),
    ai: normalizeAiSettings(preferences.ai),
  };
}
