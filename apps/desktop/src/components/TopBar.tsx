import { Check, Copy, Monitor, Moon, Sun } from "lucide-react";
import type { AppTheme, DocumentPayload } from "../lib/types";

interface TopBarProps {
  document: DocumentPayload | null;
  watch: boolean;
  theme: AppTheme;
  onThemeChange: (theme: AppTheme) => void;
}

export function TopBar({ document, watch, theme, onThemeChange }: TopBarProps) {
  const copyPath = async () => {
    if (!document) {
      return;
    }

    await navigator.clipboard.writeText(document.path);
  };

  return (
    <header className="top-bar">
      <div className="top-bar__title">
        <span className="top-bar__file">{document?.fileName ?? "mdv"}</span>
        {document ? (
          <span className="top-bar__path" title={document.path}>
            {document.directory}
          </span>
        ) : null}
      </div>

      <div className="top-bar__actions">
        <span className="watch-status">
          {watch && document?.watching ? <Check size={14} aria-hidden="true" /> : null}
          {watch && document?.watching ? "Watching" : "Static"}
        </span>

        <div className="theme-switcher" aria-label="Theme">
          <button
            type="button"
            title="Use system theme"
            aria-pressed={theme === "system"}
            onClick={() => onThemeChange("system")}
          >
            <Monitor size={15} aria-hidden="true" />
          </button>
          <button
            type="button"
            title="Use light theme"
            aria-pressed={theme === "light"}
            onClick={() => onThemeChange("light")}
          >
            <Sun size={15} aria-hidden="true" />
          </button>
          <button
            type="button"
            title="Use dark theme"
            aria-pressed={theme === "dark"}
            onClick={() => onThemeChange("dark")}
          >
            <Moon size={15} aria-hidden="true" />
          </button>
        </div>

        <button
          type="button"
          className="icon-button"
          title="Copy file path"
          onClick={copyPath}
          disabled={!document}
        >
          <Copy size={15} aria-hidden="true" />
        </button>
      </div>
    </header>
  );
}
