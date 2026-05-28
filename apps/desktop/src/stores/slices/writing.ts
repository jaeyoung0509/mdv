import { invoke } from "@tauri-apps/api/core";
import type { DocumentPayload, EditorMode, WritingSurfaceMode } from "../../lib/types";
import { isTauriRuntime, toMdvError } from "../../composables/useTauriRuntime";
import type { AppState } from "../appState";

export const AUTOSAVE_DELAY_MS = 1200;

interface WritingSliceOptions {
  reloadDocument: () => Promise<void>;
}

export function createWritingSlice(state: AppState, options: WritingSliceOptions) {
  let autosaveTimer: number | null = null;

  function clearAutosave() {
    if (autosaveTimer) {
      window.clearTimeout(autosaveTimer);
      autosaveTimer = null;
    }
  }

  function syncSavedDocument(nextDocument: DocumentPayload) {
    state.document.value = nextDocument;
    state.savedContent.value = nextDocument.content;
    state.lastSavedModifiedMillis.value = nextDocument.modifiedMillis;

    if (state.draftContent.value === nextDocument.content) {
      state.saveStatus.value = "saved";
      state.saveError.value = null;
      return;
    }

    state.saveStatus.value = "dirty";
    queueAutosave();
  }

  function resetWritingForDocument(nextDocument: DocumentPayload | null) {
    clearAutosave();
    state.draftContent.value = nextDocument?.content ?? "";
    state.savedContent.value = nextDocument?.content ?? "";
    state.lastSavedModifiedMillis.value = nextDocument?.modifiedMillis ?? null;
    state.saveStatus.value = "idle";
    state.saveError.value = null;
  }

  function queueAutosave() {
    clearAutosave();

    if (!state.document.value || !state.dirty.value || state.saveStatus.value === "conflict") {
      return;
    }

    autosaveTimer = window.setTimeout(() => {
      autosaveTimer = null;
      void saveCurrentDocument();
    }, AUTOSAVE_DELAY_MS);
  }

  function setEditorMode(mode: EditorMode) {
    state.editorMode.value = mode;

    if (mode === "write" && state.document.value && state.dirty.value) {
      queueAutosave();
    }
  }

  function setWritingSurfaceMode(mode: WritingSurfaceMode) {
    state.writingSurfaceMode.value = mode;
  }

  function toggleWritingSurfaceMode() {
    state.writingSurfaceMode.value =
      state.writingSurfaceMode.value === "live" ? "source" : "live";
  }

  function setTypewriterMode(enabled: boolean) {
    state.typewriterMode.value = enabled;
  }

  function setFocusMode(enabled: boolean) {
    state.focusMode.value = enabled;
  }

  function updateWritingSelection(text: string) {
    state.selectedWordCount.value = countWords(text);
  }

  function updateDraftContent(content: string) {
    state.draftContent.value = content;

    if (content === state.savedContent.value) {
      clearAutosave();
      state.saveStatus.value = "idle";
      state.saveError.value = null;
      return;
    }

    if (state.saveStatus.value !== "conflict") {
      state.saveStatus.value = "dirty";
      state.saveError.value = null;
      queueAutosave();
    }
  }

  function insertMarkdownSnippet(snippet: string) {
    const current = state.draftContent.value.trimEnd();
    const nextContent = `${current}${current ? "\n\n" : ""}${snippet}\n`;
    updateDraftContent(nextContent);
  }

  async function insertImageAsset(sourcePath: string) {
    if (!state.document.value || !isImagePath(sourcePath)) {
      return false;
    }

    try {
      const relativePath = isTauriRuntime()
        ? await invoke<string>("import_document_asset", {
            sourcePath,
            documentPath: state.document.value.path,
          })
        : fileNameFromPath(sourcePath);
      const fileName = fileNameFromPath(relativePath);
      const alt = fileName.replace(/\.[^.]+$/, "") || "image";
      insertMarkdownSnippet(`![${escapeAltText(alt)}](${markdownDestination(relativePath)})`);
      return true;
    } catch (reason: unknown) {
      const error = toMdvError(reason, "Could not insert this image.");
      state.saveStatus.value = "error";
      state.saveError.value = error.message;
      return true;
    }
  }

  async function saveCurrentDocument(options: { force?: boolean } = {}) {
    if (!state.document.value || (!state.dirty.value && !options.force)) {
      return;
    }

    clearAutosave();
    const content = state.draftContent.value;
    state.saveStatus.value = "saving";
    state.saveError.value = null;

    if (!isTauriRuntime()) {
      syncSavedDocument({
        ...state.document.value,
        content,
        modifiedMillis: Date.now(),
      });
      return;
    }

    try {
      const savedDocument = await invoke<DocumentPayload>("save_document", {
        content,
        expectedModifiedMillis: state.lastSavedModifiedMillis.value,
        force: Boolean(options.force),
      });
      syncSavedDocument(savedDocument);
    } catch (reason: unknown) {
      const error = toMdvError(reason, "Could not save this Markdown file.");
      state.saveStatus.value = error.kind === "DocumentConflict" ? "conflict" : "error";
      state.saveError.value = error.message;
    }
  }

  async function overwriteExternalChanges() {
    await saveCurrentDocument({ force: true });
  }

  async function reloadWritingDocument() {
    clearAutosave();
    await options.reloadDocument();
  }

  async function handleExternalDocumentUpdate() {
    if (state.editorMode.value === "write" && state.dirty.value) {
      clearAutosave();
      state.saveStatus.value = "conflict";
      state.saveError.value = "This file changed on disk after you started editing.";
      return;
    }

    await options.reloadDocument();
  }

  return {
    clearAutosave,
    handleExternalDocumentUpdate,
    overwriteExternalChanges,
    insertImageAsset,
    reloadWritingDocument,
    resetWritingForDocument,
    saveCurrentDocument,
    setEditorMode,
    setFocusMode,
    setTypewriterMode,
    setWritingSurfaceMode,
    toggleWritingSurfaceMode,
    updateDraftContent,
    updateWritingSelection,
  };
}

function countWords(value: string) {
  const words = value.match(/[\p{L}\p{N}_'-]+/gu);
  return words?.length ?? 0;
}

function isImagePath(path: string) {
  return /\.(avif|gif|jpe?g|png|svg|webp)$/i.test(path);
}

function fileNameFromPath(path: string) {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? "image";
}

function escapeAltText(value: string) {
  return value.replace(/[[\]\\]/g, "");
}

function markdownDestination(value: string) {
  if (/[\s()<>]/.test(value)) {
    return `<${value.replaceAll(">", "%3E")}>`;
  }

  return value;
}
