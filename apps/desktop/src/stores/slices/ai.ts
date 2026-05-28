import { invoke } from "@tauri-apps/api/core";
import type {
  AiCompleteEvent,
  AiContextItem,
  AiErrorEvent,
  AiSettings,
  AiStreamEvent,
} from "../../lib/types";
import { toMdvError } from "../../composables/useTauriRuntime";
import type { AppState } from "../appState";

const TEXT_CONTEXT_LIMIT = 40 * 1024;

export function truncateContextText(value: string): string {
  if (value.length <= TEXT_CONTEXT_LIMIT) {
    return value;
  }

  return `${value.slice(0, TEXT_CONTEXT_LIMIT / 2)}\n\n[truncated: context item exceeded 40KB]\n\n${value.slice(-TEXT_CONTEXT_LIMIT / 4)}`;
}

export function isTextContextPath(path: string): boolean {
  return /\.(md|markdown|txt)$/i.test(path);
}

export function fileNameFromPath(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

export function createAiSlice(
  state: AppState,
  changeAiSettings: (settings: AiSettings) => void,
) {
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

  async function sendAiQuestion(prompt: string) {
    const provider =
      state.preferences.value.ai.providers.find(
        (candidate) => candidate.id === state.preferences.value.ai.activeProviderId,
      ) ?? state.preferences.value.ai.providers[0];
    const trimmedPrompt = prompt.trim();

    if (!provider || !trimmedPrompt) {
      return;
    }

    const requestContextItems: AiContextItem[] = state.document.value
      ? [
          {
            kind: "documentExcerpt",
            label: state.document.value.fileName,
            text: truncateContextText(state.document.value.content),
          },
          ...state.aiContextItems.value,
        ]
      : state.aiContextItems.value;

    state.aiAnswer.value = "";
    state.aiError.value = null;
    state.aiStatus.value = "streaming";

    try {
      state.aiRunId.value = await invoke<string>("start_ai_chat", {
        request: {
          providerId: provider.id,
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
    cancelAiQuestion,
    handleAiComplete,
    handleAiError,
    handleAiStream,
    removeAiContextItem,
    sendAiQuestion,
    updateAiProvider,
  };
}
