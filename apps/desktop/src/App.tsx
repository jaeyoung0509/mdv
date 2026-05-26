import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { AiPanel } from "./components/AiPanel";
import { EmptyState } from "./components/EmptyState";
import { ErrorState } from "./components/ErrorState";
import { FileDropOverlay } from "./components/FileDropOverlay";
import { FindPanel } from "./components/FindPanel";
import { MarkdownView } from "./components/MarkdownView";
import { OutlinePanel } from "./components/OutlinePanel";
import { SettingsPanel } from "./components/SettingsPanel";
import { TopBar } from "./components/TopBar";
import {
  DEFAULT_READER_PREFERENCES,
  normalizeAiSettings,
  normalizeReaderPreferences,
} from "./lib/preferences";
import { applyTheme, subscribeToSystemTheme } from "./lib/theme";
import type {
  DocumentPayload,
  EffectiveTheme,
  AiContextItem,
  AiCompleteEvent,
  AiErrorEvent,
  AiSettings,
  AiStreamEvent,
  InitialState,
  MdvError,
  ReaderBookmark,
  OutlineHeading,
  ReaderPreferences,
} from "./lib/types";

const TEXT_CONTEXT_LIMIT = 40 * 1024;

function isTauriRuntime(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

function getCurrentHeading(headings: OutlineHeading[]): OutlineHeading | null {
  let currentHeading = headings[0] ?? null;

  for (const heading of headings) {
    const element = window.document.getElementById(heading.id);

    if (!element) {
      continue;
    }

    if (element.getBoundingClientRect().top <= 140) {
      currentHeading = heading;
      continue;
    }

    break;
  }

  return currentHeading;
}

function isTextContextPath(path: string): boolean {
  return /\.(md|markdown|txt)$/i.test(path);
}

function fileNameFromPath(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

function truncateContextText(value: string): string {
  if (value.length <= TEXT_CONTEXT_LIMIT) {
    return value;
  }

  return `${value.slice(0, TEXT_CONTEXT_LIMIT / 2)}\n\n[truncated: context item exceeded 40KB]\n\n${value.slice(-TEXT_CONTEXT_LIMIT / 4)}`;
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
  const [aiPanelOpen, setAiPanelOpen] = useState(false);
  const [findOpen, setFindOpen] = useState(false);
  const [aiContextItems, setAiContextItems] = useState<AiContextItem[]>([]);
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiAnswer, setAiAnswer] = useState("");
  const [aiStatus, setAiStatus] = useState<"idle" | "streaming" | "error">("idle");
  const [aiError, setAiError] = useState<string | null>(null);
  const [selectionChip, setSelectionChip] = useState<{
    text: string;
    x: number;
    y: number;
  } | null>(null);
  const aiRunIdRef = useRef<string | null>(null);

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
    setSelectionChip(null);
    setFindOpen(false);
    requestAnimationFrame(() => window.scrollTo({ top: 0 }));
  }, []);

  const openDocumentPath = useCallback(
    async (path: string) => {
      if (!isTauriRuntime()) {
        setError({
          kind: "PreviewMode",
          message: "File opening is available in the desktop app.",
        });
        return;
      }

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
    if (!isTauriRuntime()) {
      setError({
        kind: "PreviewMode",
        message: "File opening is available in the desktop app.",
      });
      return;
    }

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
    if (!isTauriRuntime()) {
      return;
    }

    invoke<ReaderPreferences>("save_reader_preferences", { preferences: nextPreferences }).catch(
      () => {
        // Reader settings still apply for this session if persistence fails.
      },
    );
  }, []);

  const updatePreferences = useCallback(
    (updater: (current: ReaderPreferences) => ReaderPreferences) => {
      setPreferences((current) => {
        const nextPreferences = normalizeReaderPreferences(updater(current));
        persistPreferences(nextPreferences);
        return nextPreferences;
      });
    },
    [persistPreferences],
  );

  const changePreferences = useCallback(
    (patch: Partial<ReaderPreferences>) => {
      updatePreferences((current) => ({ ...current, ...patch }));
    },
    [updatePreferences],
  );

  const resetPreferences = useCallback(() => {
    updatePreferences((current) => ({
      ...DEFAULT_READER_PREFERENCES,
      bookmarks: current.bookmarks,
      ai: current.ai,
    }));
  }, [updatePreferences]);

  const changeAiSettings = useCallback(
    (settings: AiSettings) => {
      updatePreferences((current) => ({
        ...current,
        ai: normalizeAiSettings(settings),
      }));
    },
    [updatePreferences],
  );

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

  const toggleHeadingBookmark = useCallback(
    (headingId: string, label: string) => {
      if (!document) {
        return;
      }

      const element = window.document.getElementById(headingId);
      const scrollYFallback = Math.max(
        0,
        Math.round((element?.getBoundingClientRect().top ?? 0) + window.scrollY),
      );
      const createdAt = Date.now();

      updatePreferences((current) => {
        const currentBookmarks = current.bookmarks[document.path] ?? [];
        const existing = currentBookmarks.find(
          (bookmark) =>
            bookmark.target.kind === "heading" && bookmark.target.headingId === headingId,
        );
        const bookmarks = { ...current.bookmarks };

        if (existing) {
          const nextBookmarks = currentBookmarks.filter((bookmark) => bookmark.id !== existing.id);

          if (nextBookmarks.length > 0) {
            bookmarks[document.path] = nextBookmarks;
          } else {
            delete bookmarks[document.path];
          }

          return {
            ...current,
            bookmarks,
          };
        }

        const nextBookmark: ReaderBookmark = {
          id: `${createdAt}-${Math.random().toString(36).slice(2, 8)}`,
          label,
          target: {
            kind: "heading",
            headingId,
            scrollYFallback,
          },
          createdAt,
        };

        return {
          ...current,
          bookmarks: {
            ...current.bookmarks,
            [document.path]: [nextBookmark, ...currentBookmarks].slice(0, 40),
          },
        };
      });
    },
    [document, updatePreferences],
  );

  const toggleCurrentBookmark = useCallback(() => {
    if (!document) {
      return;
    }

    const heading = getCurrentHeading(headings);

    if (heading) {
      toggleHeadingBookmark(heading.id, heading.text);
      return;
    }

    const scrollY = Math.max(0, Math.round(window.scrollY));
    const createdAt = Date.now();

    updatePreferences((current) => {
      const currentBookmarks = current.bookmarks[document.path] ?? [];
      const existing = currentBookmarks.find((bookmark) => {
        if (bookmark.target.kind !== "offset") {
          return false;
        }

        return Math.abs(bookmark.target.scrollY - scrollY) <= 32;
      });
      const bookmarks = { ...current.bookmarks };

      if (existing) {
        const nextBookmarks = currentBookmarks.filter((bookmark) => bookmark.id !== existing.id);

        if (nextBookmarks.length > 0) {
          bookmarks[document.path] = nextBookmarks;
        } else {
          delete bookmarks[document.path];
        }

        return {
          ...current,
          bookmarks,
        };
      }

      const nextBookmark: ReaderBookmark = {
        id: `${createdAt}-${Math.random().toString(36).slice(2, 8)}`,
        label: `${document.fileName} at ${scrollY}px`,
        target: {
          kind: "offset",
          scrollY,
        },
        createdAt,
      };

      return {
        ...current,
        bookmarks: {
          ...current.bookmarks,
          [document.path]: [nextBookmark, ...currentBookmarks].slice(0, 40),
        },
      };
    });
  }, [document, headings, toggleHeadingBookmark, updatePreferences]);

  const removeBookmark = useCallback(
    (bookmarkId: string) => {
      if (!document) {
        return;
      }

      updatePreferences((current) => {
        const nextBookmarks = (current.bookmarks[document.path] ?? []).filter(
          (bookmark) => bookmark.id !== bookmarkId,
        );
        const bookmarks = { ...current.bookmarks };

        if (nextBookmarks.length > 0) {
          bookmarks[document.path] = nextBookmarks;
        } else {
          delete bookmarks[document.path];
        }

        return {
          ...current,
          bookmarks,
        };
      });
    },
    [document, updatePreferences],
  );

  const selectBookmark = useCallback((bookmark: ReaderBookmark) => {
    if (bookmark.target.kind === "heading") {
      const heading = window.document.getElementById(bookmark.target.headingId);

      if (heading) {
        heading.scrollIntoView({ behavior: "smooth", block: "start" });
        window.history.replaceState(null, "", `#${bookmark.target.headingId}`);
        return;
      }

      window.scrollTo({ top: bookmark.target.scrollYFallback, behavior: "smooth" });
      return;
    }

    window.scrollTo({ top: bookmark.target.scrollY, behavior: "smooth" });
  }, []);

  const addAiContextItems = useCallback((items: AiContextItem[]) => {
    setAiContextItems((current) => {
      const selectionItems = items.filter((item) => item.kind === "selection");
      const otherItems = items.filter((item) => item.kind !== "selection");
      const baseItems = selectionItems.length > 0
        ? current.filter((item) => item.kind !== "selection")
        : current;
      const nextSelection = selectionItems.at(-1);
      const nextItems = nextSelection
        ? [...baseItems, ...otherItems, nextSelection]
        : [...baseItems, ...otherItems];

      return nextItems.slice(-8);
    });
  }, []);

  const removeAiContextItem = useCallback((index: number) => {
    setAiContextItems((current) => current.filter((_, itemIndex) => itemIndex !== index));
  }, []);

  const addSelectionToAi = useCallback(
    (text: string) => {
      addAiContextItems([
        {
          kind: "selection",
          label: "Selection",
          text: truncateContextText(text),
        },
      ]);
      setAiPanelOpen(true);
      setSelectionChip(null);
    },
    [addAiContextItems],
  );

  const sendAiQuestion = useCallback(async () => {
    const provider =
      preferences.ai.providers.find(
        (candidate) => candidate.id === preferences.ai.activeProviderId,
      ) ?? preferences.ai.providers[0];

    if (!provider || !aiPrompt.trim()) {
      return;
    }

    const requestContextItems: AiContextItem[] = document
      ? [
          {
            kind: "documentExcerpt",
            label: document.fileName,
            text: truncateContextText(document.content),
          },
          ...aiContextItems,
        ]
      : aiContextItems;

    setAiAnswer("");
    setAiError(null);
    setAiStatus("streaming");

    try {
      const runId = await invoke<string>("start_ai_chat", {
        request: {
          providerId: provider.id,
          prompt: aiPrompt.trim(),
          contextItems: requestContextItems,
        },
      });
      aiRunIdRef.current = runId;
    } catch (reason: unknown) {
      setAiStatus("error");
      setAiError(toMdvError(reason, "Could not start AI chat.").message);
    }
  }, [aiContextItems, aiPrompt, document, preferences.ai, toMdvError]);

  const cancelAiQuestion = useCallback(() => {
    if (!aiRunIdRef.current) {
      return;
    }

    invoke("cancel_ai_chat", { runId: aiRunIdRef.current }).catch(() => {
      // The run may have already completed.
    });
    aiRunIdRef.current = null;
    setAiStatus("idle");
  }, []);

  const updateAiProvider = useCallback(
    (providerId: string) => {
      changeAiSettings({
        ...preferences.ai,
        activeProviderId: providerId,
      });
    },
    [changeAiSettings, preferences.ai],
  );

  const handleTextSelection = useCallback((text: string, position: { x: number; y: number }) => {
    setSelectionChip({ text, x: position.x, y: position.y });
  }, []);

  const toggleFind = useCallback(() => {
    if (!document) {
      return;
    }

    setFindOpen((open) => !open);
  }, [document]);

  useEffect(() => {
    if (!isTauriRuntime()) {
      setLoading(false);
      return;
    }

    invoke<InitialState>("get_initial_state")
      .then((state) => {
        setPreferences(normalizeReaderPreferences(state.preferences));
        setWatch(state.watch);
        setAllowHtml(state.allowHtml);
        setDocument(state.document);
        setError(state.error);
        invoke<AiSettings>("get_ai_settings")
          .then((ai) => {
            setPreferences((current) => normalizeReaderPreferences({ ...current, ai }));
          })
          .catch(() => {
            // Reader settings can still load if keychain metadata is unavailable.
          });
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
    const handleFindShortcut = (event: KeyboardEvent) => {
      if (!document || event.altKey || event.shiftKey) {
        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === "f") {
        event.preventDefault();
        setFindOpen(true);
      }
    };

    window.addEventListener("keydown", handleFindShortcut);

    return () => window.removeEventListener("keydown", handleFindShortcut);
  }, [document]);

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
    if (!isTauriRuntime()) {
      return;
    }

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
    const clearSelectionChipIfEmpty = () => {
      const selectedText = window.getSelection()?.toString().trim() ?? "";

      if (!selectedText) {
        setSelectionChip(null);
      }
    };
    const clearSelectionChip = (event: Event) => {
      const target = event.target;

      if (target instanceof Element && target.closest(".ask-ai-chip, .ai-panel")) {
        return;
      }

      setSelectionChip(null);
    };

    window.document.addEventListener("selectionchange", clearSelectionChipIfEmpty);
    window.document.addEventListener("pointerdown", clearSelectionChip);
    window.document.addEventListener("dragstart", clearSelectionChip);
    window.addEventListener("scroll", clearSelectionChip, { passive: true });

    return () => {
      window.document.removeEventListener("selectionchange", clearSelectionChipIfEmpty);
      window.document.removeEventListener("pointerdown", clearSelectionChip);
      window.document.removeEventListener("dragstart", clearSelectionChip);
      window.removeEventListener("scroll", clearSelectionChip);
    };
  }, []);

  useEffect(() => {
    if (!isTauriRuntime()) {
      return;
    }

    let unlistenStream: (() => void) | undefined;
    let unlistenComplete: (() => void) | undefined;
    let unlistenError: (() => void) | undefined;

    listen<AiStreamEvent>("mdv:ai-stream", (event) => {
      if (event.payload.runId !== aiRunIdRef.current) {
        return;
      }

      setAiAnswer((current) => current + event.payload.delta);
    }).then((dispose) => {
      unlistenStream = dispose;
    });

    listen<AiCompleteEvent>("mdv:ai-complete", (event) => {
      if (event.payload.runId !== aiRunIdRef.current) {
        return;
      }

      aiRunIdRef.current = null;
      setAiStatus("idle");
    }).then((dispose) => {
      unlistenComplete = dispose;
    });

    listen<AiErrorEvent>("mdv:ai-error", (event) => {
      if (event.payload.runId !== aiRunIdRef.current) {
        return;
      }

      aiRunIdRef.current = null;
      setAiStatus("error");
      setAiError(event.payload.details || event.payload.message);
    }).then((dispose) => {
      unlistenError = dispose;
    });

    return () => {
      unlistenStream?.();
      unlistenComplete?.();
      unlistenError?.();
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
          if (aiPanelOpen) {
            if (!isTextContextPath(path)) {
              setAiStatus("error");
              setAiError("Only .md, .markdown, and .txt files can be used as AI context.");
              return;
            }

            invoke<string>("read_markdown", { path })
              .then((text) => {
                addAiContextItems([
                  {
                    kind: "file",
                    label: fileNameFromPath(path),
                    text: truncateContextText(text),
                  },
                ]);
                setAiPanelOpen(true);
              })
              .catch((reason: unknown) => {
                setAiStatus("error");
                setAiError(toMdvError(reason, "Could not read this AI context file.").message);
              });
            return;
          }

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
  }, [addAiContextItems, aiPanelOpen, openDocumentPath, toMdvError]);

  const noMarkdown = error?.kind === "NoMarkdownFiles";
  const documentBookmarks = document ? (preferences.bookmarks[document.path] ?? []) : [];
  const bookmarkedHeadingIds = useMemo(
    () =>
      new Set(
        documentBookmarks
          .filter((bookmark) => bookmark.target.kind === "heading")
          .map((bookmark) =>
            bookmark.target.kind === "heading" ? bookmark.target.headingId : "",
          ),
      ),
    [documentBookmarks],
  );

  if (loading) {
    return (
      <div className="app-frame">
        <TopBar
          document={null}
          watch={watch}
          outlineVisible={preferences.outlineVisible}
          opening={opening}
          aiPanelOpen={aiPanelOpen}
          findOpen={findOpen}
          onBookmarkAdd={toggleCurrentBookmark}
          onAiToggle={() => {
            setSettingsOpen(false);
            setAiPanelOpen((open) => !open);
          }}
          onFindToggle={toggleFind}
          onOpenFile={openFilePicker}
          onOutlineToggle={toggleOutline}
          onSettingsToggle={() => {
            setAiPanelOpen(false);
            setSettingsOpen(true);
          }}
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

  return (
    <div className="app-frame">
      <TopBar
        document={document}
        watch={watch}
        outlineVisible={preferences.outlineVisible}
        opening={opening}
        aiPanelOpen={aiPanelOpen}
        findOpen={findOpen}
        onBookmarkAdd={toggleCurrentBookmark}
        onAiToggle={() => {
          setSettingsOpen(false);
          setAiPanelOpen((open) => !open);
        }}
        onFindToggle={toggleFind}
        onOpenFile={openFilePicker}
        onOutlineToggle={toggleOutline}
        onSettingsToggle={() => {
          setAiPanelOpen(false);
          setSettingsOpen(true);
        }}
      />
      {document && !error ? (
        <div
          className={`reader-layout${
            preferences.outlineVisible ? " reader-layout--with-outline" : ""
          }`}
        >
          <OutlinePanel
            bookmarks={documentBookmarks}
            headings={headings}
            open={preferences.outlineVisible}
            onClose={() => changePreferences({ outlineVisible: false })}
            onBookmarkRemove={removeBookmark}
            onBookmarkSelect={selectBookmark}
          />
          <MarkdownView
            document={document}
            allowHtml={allowHtml}
            preferences={preferences}
            theme={effectiveTheme}
            bookmarkedHeadingIds={bookmarkedHeadingIds}
            onHeadingsChange={updateHeadings}
            onHeadingBookmarkToggle={toggleHeadingBookmark}
            onTextSelection={handleTextSelection}
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
        onAiChange={changeAiSettings}
        onClose={() => setSettingsOpen(false)}
        onReset={resetPreferences}
      />
      <AiPanel
        answer={aiAnswer}
        contextItems={aiContextItems}
        currentDocumentLabel={document?.fileName}
        error={aiError}
        open={aiPanelOpen}
        prompt={aiPrompt}
        settings={preferences.ai}
        status={aiStatus}
        onCancel={cancelAiQuestion}
        onClose={() => setAiPanelOpen(false)}
        onContextAdd={addAiContextItems}
        onContextRemove={removeAiContextItem}
        onPromptChange={setAiPrompt}
        onProviderChange={updateAiProvider}
        onSend={sendAiQuestion}
      />
      <FindPanel
        documentKey={document?.path}
        open={findOpen && Boolean(document && !error)}
        rootSelector=".document-shell .mdv-markdown"
        onClose={() => setFindOpen(false)}
      />
      {selectionChip ? (
        <button
          type="button"
          className="ask-ai-chip"
          style={{ left: selectionChip.x, top: selectionChip.y }}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => addSelectionToAi(selectionChip.text)}
        >
          Ask AI
        </button>
      ) : null}
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
      <FileDropOverlay active={dragActive && !aiPanelOpen} />
    </div>
  );
}
