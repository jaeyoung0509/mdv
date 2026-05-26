import { onScopeDispose, watch } from "vue";
import { applyTheme, subscribeToSystemTheme } from "../lib/theme";
import type { useAppStore } from "../stores/app";

export function useThemeSync(store: ReturnType<typeof useAppStore>): void {
  let unsubscribe: (() => void) | undefined;

  const stop = watch(
    () => store.preferences.theme,
    (theme) => {
      unsubscribe?.();
      unsubscribe = undefined;

      store.effectiveTheme = applyTheme(theme);

      if (theme === "system") {
        unsubscribe = subscribeToSystemTheme(() => {
          store.effectiveTheme = applyTheme("system");
        });
      }
    },
    { immediate: true },
  );

  onScopeDispose(() => {
    stop();
    unsubscribe?.();
  });
}
