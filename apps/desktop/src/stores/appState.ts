import { computed, ref } from "vue";
import { DEFAULT_READER_PREFERENCES } from "../lib/preferences";
import type {
  AiContextItem,
  DirectoryDocument,
  DocumentPayload,
  EditorMode,
  EffectiveTheme,
  MdvError,
  OutlineHeading,
  ReaderPreferences,
  SaveStatus,
  WritingSurfaceMode,
} from "../lib/types";

export function createAppState() {
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
  const editorMode = ref<EditorMode>("read");
  const draftContent = ref("");
  const savedContent = ref("");
  const saveStatus = ref<SaveStatus>("idle");
  const saveError = ref<string | null>(null);
  const lastSavedModifiedMillis = ref<number | null>(null);
  const writingSurfaceMode = ref<WritingSurfaceMode>("live");
  const typewriterMode = ref(false);
  const focusMode = ref(false);
  const selectedWordCount = ref(0);

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
  const dirty = computed(
    () => Boolean(document.value) && draftContent.value !== savedContent.value,
  );
  const wordCount = computed(() => countWords(draftContent.value));

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
    aiRunId,
    editorMode,
    draftContent,
    savedContent,
    saveStatus,
    saveError,
    lastSavedModifiedMillis,
    writingSurfaceMode,
    typewriterMode,
    focusMode,
    selectedWordCount,
    noMarkdown,
    documentBookmarks,
    bookmarkedHeadingIds,
    dirty,
    wordCount,
  };
}

export type AppState = ReturnType<typeof createAppState>;

function countWords(value: string) {
  const words = value.match(/[\p{L}\p{N}_'-]+/gu);
  return words?.length ?? 0;
}
