import { invoke } from "@tauri-apps/api/core";
import { normalizeReaderPreferences } from "../../lib/preferences";
import type { AiSettings, DocumentPayload, InitialState } from "../../lib/types";
import { isTauriRuntime, toMdvError } from "../../composables/useTauriRuntime";
import type { AppState } from "../appState";

interface DocumentSliceOptions {
  resetWritingForDocument: (document: DocumentPayload | null) => void;
}

export function createDocumentSlice(state: AppState, options: DocumentSliceOptions) {
  function showDocument(nextDocument: DocumentPayload) {
    state.document.value = nextDocument;
    state.error.value = null;
    state.headings.value = [];
    state.selectionChip.value = null;
    state.findOpen.value = false;
    options.resetWritingForDocument(nextDocument);
    requestAnimationFrame(() => window.scrollTo({ top: 0 }));
  }

  async function openDocumentPath(path: string) {
    if (!isTauriRuntime()) {
      state.error.value = {
        kind: "PreviewMode",
        message: "File opening is available in the desktop app.",
      };
      return;
    }

    state.opening.value = true;

    try {
      showDocument(await invoke<DocumentPayload>("open_document", { path }));
    } catch (reason: unknown) {
      state.document.value = null;
      options.resetWritingForDocument(null);
      state.error.value = toMdvError(reason, "Could not open this Markdown file.");
    } finally {
      state.opening.value = false;
    }
  }

  async function openFilePicker() {
    if (!isTauriRuntime()) {
      state.error.value = {
        kind: "PreviewMode",
        message: "File opening is available in the desktop app.",
      };
      return;
    }

    state.opening.value = true;

    try {
      const nextDocument = await invoke<DocumentPayload | null>("pick_markdown_file");

      if (nextDocument) {
        showDocument(nextDocument);
      }
    } catch (reason: unknown) {
      state.document.value = null;
      options.resetWritingForDocument(null);
      state.error.value = toMdvError(reason, "Could not open this Markdown file.");
    } finally {
      state.opening.value = false;
    }
  }

  async function initialize() {
    if (!isTauriRuntime()) {
      state.loading.value = false;
      return;
    }

    try {
      const initialState = await invoke<InitialState>("get_initial_state");
      state.preferences.value = normalizeReaderPreferences(initialState.preferences);
      state.watch.value = initialState.watch;
      state.allowHtml.value = initialState.allowHtml;
      state.document.value = initialState.document;
      state.error.value = initialState.error;
      options.resetWritingForDocument(initialState.document);

      try {
        const ai = await invoke<AiSettings>("get_ai_settings");
        state.preferences.value = normalizeReaderPreferences({ ...state.preferences.value, ai });
      } catch {
        // Reader settings can still load if AI metadata is unavailable.
      }
    } catch (reason: unknown) {
      state.error.value = {
        kind: "ApplicationError",
        message: "Could not initialize mdv Writer.",
        details: reason instanceof Error ? reason.message : String(reason),
      };
      options.resetWritingForDocument(null);
    } finally {
      state.loading.value = false;
    }
  }

  async function reloadDocument() {
    if (!isTauriRuntime()) {
      return;
    }

    const scrollY = window.scrollY;

    try {
      const nextDocument = await invoke<DocumentPayload>("reload_document");
      state.document.value = nextDocument;
      state.error.value = null;
      options.resetWritingForDocument(nextDocument);
      requestAnimationFrame(() => window.scrollTo({ top: scrollY }));
    } catch (reason: unknown) {
      state.error.value = {
        kind: "ReloadError",
        message: "Could not reload this Markdown file.",
        details: reason instanceof Error ? reason.message : String(reason),
      };
    }
  }

  return {
    initialize,
    openDocumentPath,
    openFilePicker,
    reloadDocument,
    showDocument,
  };
}
