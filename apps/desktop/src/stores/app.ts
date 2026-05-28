import { invoke } from "@tauri-apps/api/core";
import { defineStore } from "pinia";
import type { DocumentPayload } from "../lib/types";
import { toMdvError } from "../composables/useTauriRuntime";
import { createAppState } from "./appState";
import {
  createAiSlice,
  fileNameFromPath,
  isTextContextPath,
  truncateContextText,
} from "./slices/ai";
import { createBookmarksSlice } from "./slices/bookmarks";
import { createDocumentSlice } from "./slices/document";
import { createPanelsSlice } from "./slices/panels";
import { createPreferencesSlice } from "./slices/preferences";
import { createWritingSlice } from "./slices/writing";

export { truncateContextText };

export const useAppStore = defineStore("app", () => {
  const state = createAppState();
  let resetWritingForDocument = (_document: DocumentPayload | null) => {};

  const preferences = createPreferencesSlice(state);
  const document = createDocumentSlice(state, {
    resetWritingForDocument: (nextDocument) => resetWritingForDocument(nextDocument),
  });
  const writing = createWritingSlice(state, {
    reloadDocument: document.reloadDocument,
  });
  resetWritingForDocument = writing.resetWritingForDocument;

  const bookmarks = createBookmarksSlice(state, preferences.updatePreferences);
  const ai = createAiSlice(state, preferences.changeAiSettings);
  const panels = createPanelsSlice(state, preferences.changePreferences);

  async function handleDroppedPath(path: string) {
    if (state.editorMode.value === "write" && (await writing.insertImageAsset(path))) {
      return;
    }

    if (state.aiPanelOpen.value) {
      if (!isTextContextPath(path)) {
        state.aiStatus.value = "error";
        state.aiError.value = "Only .md, .markdown, and .txt files can be used as AI context.";
        return;
      }

      try {
        const text = await invoke<string>("read_markdown", { path });
        ai.addAiContextItems([
          {
            kind: "file",
            label: fileNameFromPath(path),
            text: truncateContextText(text),
          },
        ]);
        state.aiPanelOpen.value = true;
      } catch (reason: unknown) {
        state.aiStatus.value = "error";
        state.aiError.value = toMdvError(reason, "Could not read this AI context file.").message;
      }
      return;
    }

    await document.openDocumentPath(path);
  }

  return {
    ...state,
    ...preferences,
    ...document,
    ...bookmarks,
    ...ai,
    ...panels,
    ...writing,
    handleDroppedPath,
  };
});
