import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { onMounted, onScopeDispose, watch } from "vue";
import { isTauriRuntime } from "./useTauriRuntime";
import type {
  AiCompleteEvent,
  AiErrorEvent,
  AiStreamEvent,
  DirectoryDocument,
} from "../lib/types";
import type { useAppStore } from "../stores/app";

export function useAppLifecycle(store: ReturnType<typeof useAppStore>): void {
  const disposers: Array<() => void> = [];

  onMounted(() => {
    void store.initialize();

    const handleFindShortcut = (event: KeyboardEvent) => {
      if (!store.document || event.altKey || event.shiftKey) {
        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === "f") {
        event.preventDefault();
        store.openFindPanel();
      }
    };

    window.addEventListener("keydown", handleFindShortcut);
    disposers.push(() => window.removeEventListener("keydown", handleFindShortcut));

    const clearSelectionChipIfEmpty = () => {
      const selectedText = window.getSelection()?.toString().trim() ?? "";

      if (!selectedText) {
        store.selectionChip = null;
      }
    };
    const clearSelectionChip = (event: Event) => {
      const target = event.target;

      if (target instanceof Element && target.closest(".ask-ai-chip, .ai-panel")) {
        return;
      }

      store.selectionChip = null;
    };

    window.document.addEventListener("selectionchange", clearSelectionChipIfEmpty);
    window.document.addEventListener("pointerdown", clearSelectionChip);
    window.document.addEventListener("dragstart", clearSelectionChip);
    window.addEventListener("scroll", clearSelectionChip, { passive: true });
    disposers.push(() => {
      window.document.removeEventListener("selectionchange", clearSelectionChipIfEmpty);
      window.document.removeEventListener("pointerdown", clearSelectionChip);
      window.document.removeEventListener("dragstart", clearSelectionChip);
      window.removeEventListener("scroll", clearSelectionChip);
    });

    if (!isTauriRuntime()) {
      return;
    }

    listen("mdv:file-updated", () => {
      void store.reloadDocument();
    }).then((dispose) => disposers.push(dispose));

    listen<AiStreamEvent>("mdv:ai-stream", (event) => {
      store.handleAiStream(event.payload);
    }).then((dispose) => disposers.push(dispose));

    listen<AiCompleteEvent>("mdv:ai-complete", (event) => {
      store.handleAiComplete(event.payload);
    }).then((dispose) => disposers.push(dispose));

    listen<AiErrorEvent>("mdv:ai-error", (event) => {
      store.handleAiError(event.payload);
    }).then((dispose) => disposers.push(dispose));

    getCurrentWebview()
      .onDragDropEvent((event) => {
        const payload = event.payload;

        if (payload.type === "enter" || payload.type === "over") {
          store.dragActive = true;
          return;
        }

        if (payload.type === "leave") {
          store.dragActive = false;
          return;
        }

        store.dragActive = false;
        const [path] = payload.paths;

        if (path) {
          void store.handleDroppedPath(path);
        }
      })
      .then((dispose) => disposers.push(dispose))
      .catch(() => {
        store.dragActive = false;
      });
  });

  watch(
    () => store.document?.directory,
    async (directory) => {
      if (!directory || !isTauriRuntime()) {
        store.directoryDocuments = [];
        return;
      }

      try {
        store.directoryDocuments = await invoke<DirectoryDocument[]>("list_directory_documents", {
          directory,
        });
      } catch {
        store.directoryDocuments = [];
      }
    },
    { immediate: true },
  );

  onScopeDispose(() => {
    for (const dispose of disposers.splice(0)) {
      dispose();
    }
  });
}
