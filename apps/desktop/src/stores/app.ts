import { invoke } from "@tauri-apps/api/core";
import { defineStore } from "pinia";
import { computed, ref } from "vue";
import {
  DEFAULT_READER_PREFERENCES,
  normalizeAiSettings,
  normalizeReaderPreferences,
} from "../lib/preferences";
import type {
  AiCompleteEvent,
  AiContextItem,
  AiErrorEvent,
  AiSettings,
  AiStreamEvent,
  DirectoryDocument,
  DocumentPayload,
  EffectiveTheme,
  InitialState,
  MdvError,
  OutlineHeading,
  ReaderBookmark,
  ReaderPreferences,
} from "../lib/types";
import { isTauriRuntime, toMdvError } from "../composables/useTauriRuntime";

const TEXT_CONTEXT_LIMIT = 40 * 1024;

function getCurrentHeading(headings: OutlineHeading[]): OutlineHeading | null {
  let currentHeading = headings[0] ?? null;

  for (const heading of headings) {
    const element = window.document.getElementById(heading.id);

    if (!element) {
      continue;
    }

    if (element.getBoundingClientRect().top <= 140) {
      currentHeading = heading;
      continue;
    }

    break;
  }

  return currentHeading;
}

function isTextContextPath(path: string): boolean {
  return /\.(md|markdown|txt)$/i.test(path);
}

function fileNameFromPath(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

export function truncateContextText(value: string): string {
  if (value.length <= TEXT_CONTEXT_LIMIT) {
    return value;
  }

  return `${value.slice(0, TEXT_CONTEXT_LIMIT / 2)}\n\n[truncated: context item exceeded 40KB]\n\n${value.slice(-TEXT_CONTEXT_LIMIT / 4)}`;
}

export const useAppStore = defineStore("app", () => {
  const document = ref<DocumentPayload | null>(null);
  const error = ref<MdvError | null>(null);
  const preferences = ref<ReaderPreferences>(DEFAULT_READER_PREFERENCES);
  const effectiveTheme = ref<EffectiveTheme>("light");
  const watch = ref(true);
  const allowHtml = ref(false);
  const headings = ref<OutlineHeading[]>([]);
  const settingsOpen = ref(false);
  const dragActive = ref(false);
  const opening = ref(false);
  const loading = ref(true);
  const aiPanelOpen = ref(false);
  const findOpen = ref(false);
  const directoryDocuments = ref<DirectoryDocument[]>([]);
  const aiContextItems = ref<AiContextItem[]>([]);
  const aiAnswer = ref("");
  const aiStatus = ref<"idle" | "streaming" | "error">("idle");
  const aiError = ref<string | null>(null);
  const selectionChip = ref<{ text: string; x: number; y: number } | null>(null);
  const aiRunId = ref<string | null>(null);

  const noMarkdown = computed(() => error.value?.kind === "NoMarkdownFiles");
  const documentBookmarks = computed(() =>
    document.value ? (preferences.value.bookmarks[document.value.path] ?? []) : [],
  );
  const bookmarkedHeadingIds = computed(
    () =>
      new Set(
        documentBookmarks.value
          .filter((bookmark) => bookmark.target.kind === "heading")
          .map((bookmark) =>
            bookmark.target.kind === "heading" ? bookmark.target.headingId : "",
          ),
      ),
  );

  function showDocument(nextDocument: DocumentPayload) {
    document.value = nextDocument;
    error.value = null;
    headings.value = [];
    selectionChip.value = null;
    findOpen.value = false;
    requestAnimationFrame(() => window.scrollTo({ top: 0 }));
  }

  async function openDocumentPath(path: string) {
    if (!isTauriRuntime()) {
      error.value = {
        kind: "PreviewMode",
        message: "File opening is available in the desktop app.",
      };
      return;
    }

    opening.value = true;

    try {
      showDocument(await invoke<DocumentPayload>("open_document", { path }));
    } catch (reason: unknown) {
      document.value = null;
      error.value = toMdvError(reason, "Could not open this Markdown file.");
    } finally {
      opening.value = false;
    }
  }

  async function openFilePicker() {
    if (!isTauriRuntime()) {
      error.value = {
        kind: "PreviewMode",
        message: "File opening is available in the desktop app.",
      };
      return;
    }

    opening.value = true;

    try {
      const nextDocument = await invoke<DocumentPayload | null>("pick_markdown_file");

      if (nextDocument) {
        showDocument(nextDocument);
      }
    } catch (reason: unknown) {
      document.value = null;
      error.value = toMdvError(reason, "Could not open this Markdown file.");
    } finally {
      opening.value = false;
    }
  }

  function persistPreferences(nextPreferences: ReaderPreferences) {
    if (!isTauriRuntime()) {
      return;
    }

    invoke<ReaderPreferences>("save_reader_preferences", { preferences: nextPreferences }).catch(
      () => {
        // Reader settings still apply for this session if persistence fails.
      },
    );
  }

  function updatePreferences(updater: (current: ReaderPreferences) => ReaderPreferences) {
    const nextPreferences = normalizeReaderPreferences(updater(preferences.value));
    preferences.value = nextPreferences;
    persistPreferences(nextPreferences);
  }

  function changePreferences(patch: Partial<ReaderPreferences>) {
    updatePreferences((current) => ({ ...current, ...patch }));
  }

  function resetPreferences() {
    updatePreferences((current) => ({
      ...DEFAULT_READER_PREFERENCES,
      bookmarks: current.bookmarks,
      ai: current.ai,
    }));
  }

  function changeAiSettings(settings: AiSettings) {
    updatePreferences((current) => ({
      ...current,
      ai: normalizeAiSettings(settings),
    }));
  }

  function toggleOutline() {
    updatePreferences((current) => ({
      ...current,
      outlineVisible: !current.outlineVisible,
    }));
  }

  function updateHeadings(nextHeadings: OutlineHeading[]) {
    headings.value = nextHeadings;
  }

  function toggleHeadingBookmark(headingId: string, label: string) {
    if (!document.value) {
      return;
    }

    const element = window.document.getElementById(headingId);
    const scrollYFallback = Math.max(
      0,
      Math.round((element?.getBoundingClientRect().top ?? 0) + window.scrollY),
    );
    const createdAt = Date.now();
    const documentPath = document.value.path;

    updatePreferences((current) => {
      const currentBookmarks = current.bookmarks[documentPath] ?? [];
      const existing = currentBookmarks.find(
        (bookmark) =>
          bookmark.target.kind === "heading" && bookmark.target.headingId === headingId,
      );
      const bookmarks = { ...current.bookmarks };

      if (existing) {
        const nextBookmarks = currentBookmarks.filter((bookmark) => bookmark.id !== existing.id);

        if (nextBookmarks.length > 0) {
          bookmarks[documentPath] = nextBookmarks;
        } else {
          delete bookmarks[documentPath];
        }

        return { ...current, bookmarks };
      }

      const nextBookmark: ReaderBookmark = {
        id: `${createdAt}-${Math.random().toString(36).slice(2, 8)}`,
        label,
        target: {
          kind: "heading",
          headingId,
          scrollYFallback,
        },
        createdAt,
      };

      return {
        ...current,
        bookmarks: {
          ...current.bookmarks,
          [documentPath]: [nextBookmark, ...currentBookmarks].slice(0, 40),
        },
      };
    });
  }

  function toggleCurrentBookmark() {
    if (!document.value) {
      return;
    }

    const heading = getCurrentHeading(headings.value);

    if (heading) {
      toggleHeadingBookmark(heading.id, heading.text);
      return;
    }

    const scrollY = Math.max(0, Math.round(window.scrollY));
    const createdAt = Date.now();
    const documentPath = document.value.path;
    const documentFileName = document.value.fileName;

    updatePreferences((current) => {
      const currentBookmarks = current.bookmarks[documentPath] ?? [];
      const existing = currentBookmarks.find((bookmark) => {
        if (bookmark.target.kind !== "offset") {
          return false;
        }

        return Math.abs(bookmark.target.scrollY - scrollY) <= 32;
      });
      const bookmarks = { ...current.bookmarks };

      if (existing) {
        const nextBookmarks = currentBookmarks.filter((bookmark) => bookmark.id !== existing.id);

        if (nextBookmarks.length > 0) {
          bookmarks[documentPath] = nextBookmarks;
        } else {
          delete bookmarks[documentPath];
        }

        return { ...current, bookmarks };
      }

      const nextBookmark: ReaderBookmark = {
        id: `${createdAt}-${Math.random().toString(36).slice(2, 8)}`,
        label: `${documentFileName} at ${scrollY}px`,
        target: {
          kind: "offset",
          scrollY,
        },
        createdAt,
      };

      return {
        ...current,
        bookmarks: {
          ...current.bookmarks,
          [documentPath]: [nextBookmark, ...currentBookmarks].slice(0, 40),
        },
      };
    });
  }

  function removeBookmark(bookmarkId: string) {
    if (!document.value) {
      return;
    }

    const documentPath = document.value.path;

    updatePreferences((current) => {
      const nextBookmarks = (current.bookmarks[documentPath] ?? []).filter(
        (bookmark) => bookmark.id !== bookmarkId,
      );
      const bookmarks = { ...current.bookmarks };

      if (nextBookmarks.length > 0) {
        bookmarks[documentPath] = nextBookmarks;
      } else {
        delete bookmarks[documentPath];
      }

      return { ...current, bookmarks };
    });
  }

  function selectBookmark(bookmark: ReaderBookmark) {
    if (bookmark.target.kind === "heading") {
      const heading = window.document.getElementById(bookmark.target.headingId);

      if (heading) {
        heading.scrollIntoView({ behavior: "smooth", block: "start" });
        window.history.replaceState(null, "", `#${bookmark.target.headingId}`);
        return;
      }

      window.scrollTo({ top: bookmark.target.scrollYFallback, behavior: "smooth" });
      return;
    }

    window.scrollTo({ top: bookmark.target.scrollY, behavior: "smooth" });
  }

  function addAiContextItems(items: AiContextItem[]) {
    const selectionItems = items.filter((item) => item.kind === "selection");
    const otherItems = items.filter((item) => item.kind !== "selection");
    const baseItems =
      selectionItems.length > 0
        ? aiContextItems.value.filter((item) => item.kind !== "selection")
        : aiContextItems.value;
    const nextSelection = selectionItems.at(-1);
    const nextItems = nextSelection
      ? [...baseItems, ...otherItems, nextSelection]
      : [...baseItems, ...otherItems];

    aiContextItems.value = nextItems.slice(-8);
  }

  function removeAiContextItem(index: number) {
    aiContextItems.value = aiContextItems.value.filter((_, itemIndex) => itemIndex !== index);
  }

  function addSelectionToAi(text: string) {
    addAiContextItems([
      {
        kind: "selection",
        label: "Selection",
        text: truncateContextText(text),
      },
    ]);
    aiPanelOpen.value = true;
    selectionChip.value = null;
  }

  async function sendAiQuestion(prompt: string) {
    const provider =
      preferences.value.ai.providers.find(
        (candidate) => candidate.id === preferences.value.ai.activeProviderId,
      ) ?? preferences.value.ai.providers[0];
    const trimmedPrompt = prompt.trim();

    if (!provider || !trimmedPrompt) {
      return;
    }

    const requestContextItems: AiContextItem[] = document.value
      ? [
          {
            kind: "documentExcerpt",
            label: document.value.fileName,
            text: truncateContextText(document.value.content),
          },
          ...aiContextItems.value,
        ]
      : aiContextItems.value;

    aiAnswer.value = "";
    aiError.value = null;
    aiStatus.value = "streaming";

    try {
      aiRunId.value = await invoke<string>("start_ai_chat", {
        request: {
          providerId: provider.id,
          prompt: trimmedPrompt,
          contextItems: requestContextItems,
        },
      });
    } catch (reason: unknown) {
      aiStatus.value = "error";
      aiError.value = toMdvError(reason, "Could not start AI chat.").message;
    }
  }

  function cancelAiQuestion() {
    if (!aiRunId.value) {
      return;
    }

    invoke("cancel_ai_chat", { runId: aiRunId.value }).catch(() => {
      // The run may have already completed.
    });
    aiRunId.value = null;
    aiStatus.value = "idle";
  }

  function updateAiProvider(providerId: string) {
    changeAiSettings({
      ...preferences.value.ai,
      activeProviderId: providerId,
    });
  }

  function handleTextSelection(text: string, position: { x: number; y: number }) {
    selectionChip.value = { text, x: position.x, y: position.y };
  }

  function openFindPanel() {
    if (document.value) {
      findOpen.value = true;
    }
  }

  function toggleFind() {
    if (!document.value) {
      return;
    }

    findOpen.value = !findOpen.value;
  }

  function toggleAiPanel() {
    settingsOpen.value = false;
    aiPanelOpen.value = !aiPanelOpen.value;
  }

  function closeAiPanel() {
    aiPanelOpen.value = false;
  }

  function openSettingsPanel() {
    aiPanelOpen.value = false;
    settingsOpen.value = true;
  }

  function closeSettingsPanel() {
    settingsOpen.value = false;
  }

  function closeTopmostPanel(): boolean {
    if (findOpen.value) {
      findOpen.value = false;
      return true;
    }

    if (aiPanelOpen.value) {
      aiPanelOpen.value = false;
      return true;
    }

    if (settingsOpen.value) {
      settingsOpen.value = false;
      return true;
    }

    if (document.value && !error.value && preferences.value.outlineVisible) {
      changePreferences({ outlineVisible: false });
      return true;
    }

    return false;
  }

  async function initialize() {
    if (!isTauriRuntime()) {
      loading.value = false;
      return;
    }

    try {
      const state = await invoke<InitialState>("get_initial_state");
      preferences.value = normalizeReaderPreferences(state.preferences);
      watch.value = state.watch;
      allowHtml.value = state.allowHtml;
      document.value = state.document;
      error.value = state.error;

      try {
        const ai = await invoke<AiSettings>("get_ai_settings");
        preferences.value = normalizeReaderPreferences({ ...preferences.value, ai });
      } catch {
        // Reader settings can still load if AI metadata is unavailable.
      }
    } catch (reason: unknown) {
      error.value = {
        kind: "ApplicationError",
        message: "Could not initialize mdv.",
        details: reason instanceof Error ? reason.message : String(reason),
      };
    } finally {
      loading.value = false;
    }
  }

  async function reloadDocument() {
    if (!isTauriRuntime()) {
      return;
    }

    const scrollY = window.scrollY;

    try {
      document.value = await invoke<DocumentPayload>("reload_document");
      error.value = null;
      requestAnimationFrame(() => window.scrollTo({ top: scrollY }));
    } catch (reason: unknown) {
      error.value = {
        kind: "ReloadError",
        message: "Could not reload this Markdown file.",
        details: reason instanceof Error ? reason.message : String(reason),
      };
    }
  }

  function handleAiStream(event: AiStreamEvent) {
    if (event.runId !== aiRunId.value) {
      return;
    }

    aiAnswer.value += event.delta;
  }

  function handleAiComplete(event: AiCompleteEvent) {
    if (event.runId !== aiRunId.value) {
      return;
    }

    aiRunId.value = null;
    aiStatus.value = "idle";
  }

  function handleAiError(event: AiErrorEvent) {
    if (event.runId !== aiRunId.value) {
      return;
    }

    aiRunId.value = null;
    aiStatus.value = "error";
    aiError.value = event.details || event.message;
  }

  async function handleDroppedPath(path: string) {
    if (aiPanelOpen.value) {
      if (!isTextContextPath(path)) {
        aiStatus.value = "error";
        aiError.value = "Only .md, .markdown, and .txt files can be used as AI context.";
        return;
      }

      try {
        const text = await invoke<string>("read_markdown", { path });
        addAiContextItems([
          {
            kind: "file",
            label: fileNameFromPath(path),
            text: truncateContextText(text),
          },
        ]);
        aiPanelOpen.value = true;
      } catch (reason: unknown) {
        aiStatus.value = "error";
        aiError.value = toMdvError(reason, "Could not read this AI context file.").message;
      }
      return;
    }

    await openDocumentPath(path);
  }

  return {
    document,
    error,
    preferences,
    effectiveTheme,
    watch,
    allowHtml,
    headings,
    settingsOpen,
    dragActive,
    opening,
    loading,
    aiPanelOpen,
    findOpen,
    directoryDocuments,
    aiContextItems,
    aiAnswer,
    aiStatus,
    aiError,
    selectionChip,
    noMarkdown,
    documentBookmarks,
    bookmarkedHeadingIds,
    initialize,
    openDocumentPath,
    openFilePicker,
    changePreferences,
    resetPreferences,
    changeAiSettings,
    toggleOutline,
    updateHeadings,
    toggleHeadingBookmark,
    toggleCurrentBookmark,
    removeBookmark,
    selectBookmark,
    addAiContextItems,
    removeAiContextItem,
    addSelectionToAi,
    sendAiQuestion,
    cancelAiQuestion,
    updateAiProvider,
    handleTextSelection,
    openFindPanel,
    toggleFind,
    toggleAiPanel,
    closeAiPanel,
    openSettingsPanel,
    closeSettingsPanel,
    closeTopmostPanel,
    reloadDocument,
    handleAiStream,
    handleAiComplete,
    handleAiError,
    handleDroppedPath,
  };
});
