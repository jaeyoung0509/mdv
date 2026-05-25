import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { EmptyState } from "./components/EmptyState";
import { ErrorState } from "./components/ErrorState";
import { MarkdownView } from "./components/MarkdownView";
import { TopBar } from "./components/TopBar";
import { applyTheme, subscribeToSystemTheme } from "./lib/theme";
import type { AppTheme, DocumentPayload, EffectiveTheme, InitialState, MdvError } from "./lib/types";

export default function App() {
  const [document, setDocument] = useState<DocumentPayload | null>(null);
  const [error, setError] = useState<MdvError | null>(null);
  const [theme, setTheme] = useState<AppTheme>("system");
  const [effectiveTheme, setEffectiveTheme] = useState<EffectiveTheme>("light");
  const [watch, setWatch] = useState(true);
  const [allowHtml, setAllowHtml] = useState(false);
  const [loading, setLoading] = useState(true);

  const changeTheme = (nextTheme: AppTheme) => {
    setTheme(nextTheme);
    invoke("save_theme_preference", { theme: nextTheme }).catch(() => {
      // The selected theme still applies for this session if persistence fails.
    });
  };

  useEffect(() => {
    invoke<InitialState>("get_initial_state")
      .then((state) => {
        setTheme(state.theme);
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
    setEffectiveTheme(applyTheme(theme));

    if (theme !== "system") {
      return;
    }

    return subscribeToSystemTheme(() => {
      setEffectiveTheme(applyTheme("system"));
    });
  }, [theme]);

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

  if (loading) {
    return (
      <div className="app-frame">
        <TopBar document={null} watch={watch} theme={theme} onThemeChange={changeTheme} />
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
      <TopBar document={document} watch={watch} theme={theme} onThemeChange={changeTheme} />
      {document && !error ? (
        <MarkdownView document={document} allowHtml={allowHtml} theme={effectiveTheme} />
      ) : noMarkdown ? (
        <EmptyState
          title="No Markdown files found in this directory."
          message="Open a Markdown file directly or add a README.md file."
          path={error.path}
        />
      ) : error ? (
        <ErrorState error={error} rawContent={document?.content} />
      ) : (
        <EmptyState title="No Markdown file selected." message="Open a file with mdv README.md." />
      )}
    </div>
  );
}
