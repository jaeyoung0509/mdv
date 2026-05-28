import type { ReaderPreferences } from "../../lib/types";
import type { AppState } from "../appState";

export function createPanelsSlice(
  state: AppState,
  changePreferences: (patch: Partial<ReaderPreferences>) => void,
) {
  function handleTextSelection(text: string, position: { x: number; y: number }) {
    state.selectionChip.value = { text, x: position.x, y: position.y };
  }

  function openFindPanel() {
    if (state.document.value) {
      state.findOpen.value = true;
    }
  }

  function toggleFind() {
    if (!state.document.value) {
      return;
    }

    state.findOpen.value = !state.findOpen.value;
  }

  function toggleAiPanel() {
    state.settingsOpen.value = false;
    state.aiPanelOpen.value = !state.aiPanelOpen.value;
  }

  function closeAiPanel() {
    state.aiPanelOpen.value = false;
  }

  function openSettingsPanel() {
    state.aiPanelOpen.value = false;
    state.settingsOpen.value = true;
  }

  function closeSettingsPanel() {
    state.settingsOpen.value = false;
  }

  function closeTopmostPanel(): boolean {
    if (state.findOpen.value) {
      state.findOpen.value = false;
      return true;
    }

    if (state.aiPanelOpen.value) {
      state.aiPanelOpen.value = false;
      return true;
    }

    if (state.settingsOpen.value) {
      state.settingsOpen.value = false;
      return true;
    }

    if (
      state.document.value &&
      !state.error.value &&
      state.preferences.value.outlineVisible
    ) {
      changePreferences({ outlineVisible: false });
      return true;
    }

    return false;
  }

  return {
    closeAiPanel,
    closeSettingsPanel,
    closeTopmostPanel,
    handleTextSelection,
    openFindPanel,
    openSettingsPanel,
    toggleAiPanel,
    toggleFind,
  };
}
