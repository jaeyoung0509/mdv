import { invoke } from "@tauri-apps/api/core";
import {
  DEFAULT_READER_PREFERENCES,
  normalizeAiSettings,
  normalizeReaderPreferences,
} from "../../lib/preferences";
import type { AiSettings, ReaderPreferences } from "../../lib/types";
import { isTauriRuntime } from "../../composables/useTauriRuntime";
import type { AppState } from "../appState";

export function createPreferencesSlice(state: AppState) {
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
    const nextPreferences = normalizeReaderPreferences(updater(state.preferences.value));
    state.preferences.value = nextPreferences;
    persistPreferences(nextPreferences);
  }

  function changePreferences(patch: Partial<ReaderPreferences>) {
    updatePreferences((current) => ({ ...current, ...patch }));
  }

  function resetPreferences() {
    updatePreferences((current) => ({
      ...DEFAULT_READER_PREFERENCES,
      bookmarks: current.bookmarks,
      aiNotes: current.aiNotes,
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

  return {
    changeAiSettings,
    changePreferences,
    resetPreferences,
    toggleOutline,
    updatePreferences,
  };
}
