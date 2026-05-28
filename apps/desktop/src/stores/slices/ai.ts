import { invoke } from "@tauri-apps/api/core";
import type {
  AiPanelMode,
  AiCompleteEvent,
  AiContextItem,
  AiErrorEvent,
  AiWriteApplyAction,
  AiSettings,
  AiStreamEvent,
} from "../../lib/types";
import { toMdvError } from "../../composables/useTauriRuntime";
import type { AppState } from "../appState";

export { fileNameFromPath, isTextContextPath } from "../../lib/path";

const TEXT_CONTEXT_LIMIT = 40 * 1024;

export function truncateContextText(value: string): string {
  if (value.length <= TEXT_CONTEXT_LIMIT) {
    return value;
  }

  return `${value.slice(0, TEXT_CONTEXT_LIMIT / 2)}\n\n[truncated: context item exceeded 40KB]\n\n${value.slice(-TEXT_CONTEXT_LIMIT / 4)}`;
}

export function createAiSlice(
  state: AppState,
  changeAiSettings: (settings: AiSettings) => void,
  updateDraftContent: (content: string) => void,
) {
  function setAiPanelMode(mode: AiPanelMode) {
    state.aiPanelMode.value = mode;
  }

  function addAiContextItems(items: AiContextItem[]) {
    const selectionItems = items.filter((item) => item.kind === "selection");
    const otherItems = items.filter((item) => item.kind !== "selection");
    const baseItems =
      selectionItems.length > 0
        ? state.aiContextItems.value.filter((item) => item.kind !== "selection")
        : state.aiContextItems.value;
    const nextSelection = selectionItems.at(-1);
    const nextItems = nextSelection
      ? [...baseItems, ...otherItems, nextSelection]
      : [...baseItems, ...otherItems];

    state.aiContextItems.value = nextItems.slice(-8);
  }

  function removeAiContextItem(index: number) {
    state.aiContextItems.value = state.aiContextItems.value.filter(
      (_, itemIndex) => itemIndex !== index,
    );
  }

  function addSelectionToAi(text: string) {
    addAiContextItems([
      {
        kind: "selection",
        label: "Selection",
        text: truncateContextText(text),
      },
    ]);
    state.aiPanelOpen.value = true;
    state.selectionChip.value = null;
  }

  function activeDocumentContext(): AiContextItem | null {
    if (!state.document.value) {
      return null;
    }

    const content =
      state.editorMode.value === "write"
        ? state.draftContent.value
        : state.document.value.content;
    const modeLabel = state.editorMode.value === "write" ? "Current draft" : "Current document";

    return {
      kind: "documentExcerpt",
      label: `${modeLabel}: ${state.document.value.fileName}`,
      text: truncateContextText(content),
    };
  }

  function writingSelectionContext(): AiContextItem | null {
    const selection = state.writingSelection.value;

    if (state.aiPanelMode.value !== "write" || !selection.text.trim()) {
      return null;
    }

    const label =
      selection.fromLine && selection.toLine
        ? `Selected lines ${selection.fromLine}-${selection.toLine}`
        : "Selected draft text";

    return {
      kind: "selection",
      label,
      text: truncateContextText(selection.text),
    };
  }

  async function sendAiQuestion(prompt: string, mode: AiPanelMode = state.aiPanelMode.value) {
    const provider =
      state.preferences.value.ai.providers.find(
        (candidate) => candidate.id === state.preferences.value.ai.activeProviderId,
      ) ?? state.preferences.value.ai.providers[0];
    const trimmedPrompt = prompt.trim();

    if (!provider || !trimmedPrompt) {
      return;
    }

    state.aiPanelMode.value = mode;

    const baseContextItems = [activeDocumentContext(), writingSelectionContext()].filter(
      (item): item is AiContextItem => Boolean(item),
    );
    const requestContextItems: AiContextItem[] = [
      ...baseContextItems,
      ...state.aiContextItems.value,
    ];

    state.aiAnswer.value = "";
    state.aiLastPrompt.value = trimmedPrompt;
    state.aiError.value = null;
    state.aiStatus.value = "streaming";

    try {
      state.aiRunId.value = await invoke<string>("start_ai_chat", {
        request: {
          providerId: provider.id,
          mode,
          prompt: trimmedPrompt,
          contextItems: requestContextItems,
        },
      });
    } catch (reason: unknown) {
      state.aiStatus.value = "error";
      state.aiError.value = toMdvError(reason, "Could not start AI chat.").message;
    }
  }

  function cancelAiQuestion() {
    if (!state.aiRunId.value) {
      return;
    }

    invoke("cancel_ai_chat", { runId: state.aiRunId.value }).catch(() => {
      // The run may have already completed.
    });
    state.aiRunId.value = null;
    state.aiStatus.value = "idle";
  }

  function updateAiProvider(providerId: string) {
    changeAiSettings({
      ...state.preferences.value.ai,
      activeProviderId: providerId,
    });
  }

  function handleAiStream(event: AiStreamEvent) {
    if (event.runId !== state.aiRunId.value) {
      return;
    }

    state.aiAnswer.value += event.delta;
  }

  function handleAiComplete(event: AiCompleteEvent) {
    if (event.runId !== state.aiRunId.value) {
      return;
    }

    state.aiRunId.value = null;
    state.aiStatus.value = "idle";
  }

  function appendToDraft(snippet: string) {
    const current = state.draftContent.value.trimEnd();
    const nextContent = `${current}${current ? "\n\n" : ""}${snippet.trim()}\n`;
    updateDraftContent(nextContent);
  }

  function replaceRange(content: string, from: number, to: number, replacement: string) {
    updateDraftContent(`${content.slice(0, from)}${replacement}${content.slice(to)}`);
  }

  function applyAiAnswerToDraft(action: AiWriteApplyAction) {
    if (!state.document.value || !state.aiAnswer.value.trim()) {
      return;
    }

    if (state.editorMode.value !== "write") {
      state.editorMode.value = "write";
    }

    const answer = state.aiAnswer.value.trim();
    const selection = state.writingSelection.value;
    const content = state.draftContent.value;

    if (action === "append") {
      appendToDraft(answer);
      return;
    }

    if (action === "insert" && selection.from !== null) {
      replaceRange(content, selection.from, selection.from, answer);
      return;
    }

    if (action === "replace") {
      if (selection.from !== null && selection.to !== null && selection.to > selection.from) {
        replaceRange(content, selection.from, selection.to, answer);
        return;
      }

      if (selection.text.trim()) {
        const index = content.indexOf(selection.text);

        if (index >= 0) {
          replaceRange(content, index, index + selection.text.length, answer);
          return;
        }
      }
    }

    appendToDraft(answer);
  }

  function handleAiError(event: AiErrorEvent) {
    if (event.runId !== state.aiRunId.value) {
      return;
    }

    state.aiRunId.value = null;
    state.aiStatus.value = "error";
    state.aiError.value = event.details || event.message;
  }

  return {
    addAiContextItems,
    addSelectionToAi,
    applyAiAnswerToDraft,
    cancelAiQuestion,
    handleAiComplete,
    handleAiError,
    handleAiStream,
    removeAiContextItem,
    sendAiQuestion,
    setAiPanelMode,
    updateAiProvider,
  };
}
