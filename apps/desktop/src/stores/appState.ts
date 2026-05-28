import { computed, ref } from "vue";
import { DEFAULT_READER_PREFERENCES } from "../lib/preferences";
import { countWords, emptyWritingSelection } from "../lib/text";
import type {
  AiNoteThread,
  AiPanelMode,
  AiContextItem,
  DirectoryDocument,
  DocumentPayload,
  EditorMode,
  EffectiveTheme,
  MdvError,
  OutlineHeading,
  ReaderPreferences,
  SaveStatus,
  WritingSelection,
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
  const aiLastPrompt = ref("");
  const aiPanelMode = ref<AiPanelMode>("ask");
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
  const selectedWordCount = ref(0);
  const writingSelection = ref<WritingSelection>(emptyWritingSelection());

  const noMarkdown = computed(() => error.value?.kind === "NoMarkdownFiles");
  const documentBookmarks = computed(() =>
    document.value ? (preferences.value.bookmarks[document.value.path] ?? []) : [],
  );
  const documentAiNotes = computed<AiNoteThread[]>(() =>
    document.value ? (preferences.value.aiNotes[document.value.path] ?? []) : [],
  );
  const unresolvedAiNoteCount = computed(
    () => documentAiNotes.value.filter((note) => !note.resolved).length,
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
    aiLastPrompt,
    aiPanelMode,
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
    selectedWordCount,
    writingSelection,
    noMarkdown,
    documentBookmarks,
    documentAiNotes,
    unresolvedAiNoteCount,
    bookmarkedHeadingIds,
    dirty,
    wordCount,
  };
}

export type AppState = ReturnType<typeof createAppState>;
