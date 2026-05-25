import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { EmptyState } from "./components/EmptyState";
import { ErrorState } from "./components/ErrorState";
import { FileDropOverlay } from "./components/FileDropOverlay";
import { MarkdownView } from "./components/MarkdownView";
import { OutlinePanel } from "./components/OutlinePanel";
import { SettingsPanel } from "./components/SettingsPanel";
import { TopBar } from "./components/TopBar";
import {
  DEFAULT_READER_PREFERENCES,
  normalizeReaderPreferences,
} from "./lib/preferences";
import { applyTheme, subscribeToSystemTheme } from "./lib/theme";
import type {
  DocumentPayload,
  EffectiveTheme,
  InitialState,
  MdvError,
  OutlineHeading,
  ReaderPreferences,
} from "./lib/types";

function isTauriRuntime(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

export default function App() {
  const [document, setDocument] = useState<DocumentPayload | null>(null);
  const [error, setError] = useState<MdvError | null>(null);
  const [preferences, setPreferences] = useState<ReaderPreferences>(DEFAULT_READER_PREFERENCES);
  const [effectiveTheme, setEffectiveTheme] = useState<EffectiveTheme>("light");
  const [watch, setWatch] = useState(true);
  const [allowHtml, setAllowHtml] = useState(false);
  const [headings, setHeadings] = useState<OutlineHeading[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [opening, setOpening] = useState(false);
  const [loading, setLoading] = useState(true);

  const toMdvError = useCallback((reason: unknown, message: string): MdvError => {
    if (
      reason &&
      typeof reason === "object" &&
      "kind" in reason &&
      "message" in reason
    ) {
      return reason as MdvError;
    }

    return {
      kind: "ApplicationError",
      message,
      details: reason instanceof Error ? reason.message : String(reason),
    };
  }, []);

  const showDocument = useCallback((nextDocument: DocumentPayload) => {
    setDocument(nextDocument);
    setError(null);
    setHeadings([]);
    requestAnimationFrame(() => window.scrollTo({ top: 0 }));
  }, []);

  const openDocumentPath = useCallback(
    async (path: string) => {
      setOpening(true);

      try {
        const nextDocument = await invoke<DocumentPayload>("open_document", { path });
        showDocument(nextDocument);
      } catch (reason: unknown) {
        setDocument(null);
        setError(toMdvError(reason, "Could not open this Markdown file."));
      } finally {
        setOpening(false);
      }
    },
    [showDocument, toMdvError],
  );

  const openFilePicker = useCallback(async () => {
    setOpening(true);

    try {
      const nextDocument = await invoke<DocumentPayload | null>("pick_markdown_file");

      if (nextDocument) {
        showDocument(nextDocument);
      }
    } catch (reason: unknown) {
      setDocument(null);
      setError(toMdvError(reason, "Could not open this Markdown file."));
    } finally {
      setOpening(false);
    }
  }, [showDocument, toMdvError]);

  const persistPreferences = useCallback((nextPreferences: ReaderPreferences) => {
    invoke<ReaderPreferences>("save_reader_preferences", { preferences: nextPreferences }).catch(
      () => {
        // Reader settings still apply for this session if persistence fails.
      },
    );
  }, []);

  const changePreferences = useCallback(
    (patch: Partial<ReaderPreferences>) => {
      setPreferences((current) => {
        const nextPreferences = normalizeReaderPreferences({ ...current, ...patch });
        persistPreferences(nextPreferences);
        return nextPreferences;
      });
    },
    [persistPreferences],
  );

  const resetPreferences = useCallback(() => {
    setPreferences(DEFAULT_READER_PREFERENCES);
    persistPreferences(DEFAULT_READER_PREFERENCES);
  }, [persistPreferences]);

  const toggleOutline = useCallback(() => {
    setPreferences((current) => {
      const nextPreferences = normalizeReaderPreferences({
        ...current,
        outlineVisible: !current.outlineVisible,
      });
      persistPreferences(nextPreferences);
      return nextPreferences;
    });
  }, [persistPreferences]);

  const updateHeadings = useCallback((nextHeadings: OutlineHeading[]) => {
    setHeadings(nextHeadings);
  }, []);

  useEffect(() => {
    invoke<InitialState>("get_initial_state")
      .then((state) => {
        setPreferences(normalizeReaderPreferences(state.preferences));
        setWatch(state.watch);
        setAllowHtml(state.allowHtml);
        setDocument(state.document);
        setError(state.error);
      })
      .catch((reason: unknown) => {
        setError({
          kind: "ApplicationError",
          message: "Could not initialize mdv.",
          details: reason instanceof Error ? reason.message : String(reason),
        });
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    setEffectiveTheme(applyTheme(preferences.theme));

    if (preferences.theme !== "system") {
      return;
    }

    return subscribeToSystemTheme(() => {
      setEffectiveTheme(applyTheme("system"));
    });
  }, [preferences.theme]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;

    listen("mdv:file-updated", async () => {
      const scrollY = window.scrollY;

      try {
        const nextDocument = await invoke<DocumentPayload>("reload_document");
        setDocument(nextDocument);
        setError(null);
        requestAnimationFrame(() => window.scrollTo({ top: scrollY }));
      } catch (reason: unknown) {
        setError({
          kind: "ReloadError",
          message: "Could not reload this Markdown file.",
          details: reason instanceof Error ? reason.message : String(reason),
        });
      }
    }).then((dispose) => {
      unlisten = dispose;
    });

    return () => {
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    if (!isTauriRuntime()) {
      return;
    }

    let disposed = false;
    let unlisten: (() => void) | undefined;

    getCurrentWebview()
      .onDragDropEvent((event) => {
        const payload = event.payload;

        if (payload.type === "enter" || payload.type === "over") {
          setDragActive(true);
          return;
        }

        if (payload.type === "leave") {
          setDragActive(false);
          return;
        }

        setDragActive(false);
        const [path] = payload.paths;

        if (path) {
          void openDocumentPath(path);
        }
      })
      .then((dispose) => {
        if (disposed) {
          dispose();
          return;
        }

        unlisten = dispose;
      })
      .catch(() => {
        setDragActive(false);
      });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [openDocumentPath]);

  if (loading) {
    return (
      <div className="app-frame">
        <TopBar
          document={null}
          watch={watch}
          outlineVisible={preferences.outlineVisible}
          opening={opening}
          onOpenFile={openFilePicker}
          onOutlineToggle={toggleOutline}
          onSettingsToggle={() => setSettingsOpen(true)}
        />
        <main className="state-view">
          <section className="state-panel">
            <p className="state-eyebrow">Loading</p>
            <h1>Opening Markdown...</h1>
          </section>
        </main>
      </div>
    );
  }

  const noMarkdown = error?.kind === "NoMarkdownFiles";

  return (
    <div className="app-frame">
      <TopBar
        document={document}
        watch={watch}
        outlineVisible={preferences.outlineVisible}
        opening={opening}
        onOpenFile={openFilePicker}
        onOutlineToggle={toggleOutline}
        onSettingsToggle={() => setSettingsOpen(true)}
      />
      {document && !error ? (
        <div
          className={`reader-layout${
            preferences.outlineVisible ? " reader-layout--with-outline" : ""
          }`}
        >
          <OutlinePanel
            headings={headings}
            open={preferences.outlineVisible}
            onClose={() => changePreferences({ outlineVisible: false })}
          />
          <MarkdownView
            document={document}
            allowHtml={allowHtml}
            preferences={preferences}
            theme={effectiveTheme}
            onHeadingsChange={updateHeadings}
          />
        </div>
      ) : noMarkdown ? (
        <EmptyState
          title="No Markdown files found in this directory."
          message="Open a Markdown file directly or add a README.md file."
          path={error.path}
          opening={opening}
          onOpenFile={openFilePicker}
        />
      ) : error ? (
        <ErrorState
          error={error}
          rawContent={document?.content}
          opening={opening}
          onOpenFile={openFilePicker}
        />
      ) : (
        <EmptyState
          title="No Markdown file selected."
          message="Open a Markdown file directly or drop one into this window."
          opening={opening}
          onOpenFile={openFilePicker}
        />
      )}
      <SettingsPanel
        open={settingsOpen}
        preferences={preferences}
        onChange={changePreferences}
        onClose={() => setSettingsOpen(false)}
        onReset={resetPreferences}
      />
      {settingsOpen ? (
        <button
          type="button"
          className="panel-backdrop panel-backdrop--settings"
          aria-label="Close settings"
          onClick={() => setSettingsOpen(false)}
        />
      ) : null}
      {document && !error && preferences.outlineVisible ? (
        <button
          type="button"
          className="panel-backdrop panel-backdrop--outline"
          aria-label="Close outline"
          onClick={() => changePreferences({ outlineVisible: false })}
        />
      ) : null}
      <FileDropOverlay active={dragActive} />
    </div>
  );
}
