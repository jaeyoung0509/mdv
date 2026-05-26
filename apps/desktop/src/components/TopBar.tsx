import {
  BookmarkPlus,
  Check,
  Copy,
  FolderOpen,
  ListTree,
  Search,
  Settings,
  Sparkles,
} from "lucide-react";
import type { DocumentPayload } from "../lib/types";

interface TopBarProps {
  document: DocumentPayload | null;
  watch: boolean;
  outlineVisible: boolean;
  opening?: boolean;
  aiPanelOpen?: boolean;
  findOpen?: boolean;
  onBookmarkAdd: () => void;
  onAiToggle: () => void;
  onFindToggle: () => void;
  onOpenFile: () => void;
  onOutlineToggle: () => void;
  onSettingsToggle: () => void;
}

export function TopBar({
  document,
  watch,
  outlineVisible,
  opening = false,
  aiPanelOpen = false,
  findOpen = false,
  onBookmarkAdd,
  onAiToggle,
  onFindToggle,
  onOpenFile,
  onOutlineToggle,
  onSettingsToggle,
}: TopBarProps) {
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

        <button
          type="button"
          className="icon-button"
          title="Open Markdown file"
          onClick={onOpenFile}
          disabled={opening}
        >
          <FolderOpen size={15} aria-hidden="true" />
        </button>

        <button
          type="button"
          className="icon-button"
          title="Toggle outline"
          aria-pressed={outlineVisible}
          onClick={onOutlineToggle}
          disabled={!document}
        >
          <ListTree size={15} aria-hidden="true" />
        </button>

        <button
          type="button"
          className="icon-button"
          title="Find in document"
          aria-pressed={findOpen}
          onClick={onFindToggle}
          disabled={!document}
        >
          <Search size={15} aria-hidden="true" />
        </button>

        <button
          type="button"
          className="icon-button"
          title="Copy file path"
          onClick={copyPath}
          disabled={!document}
        >
          <Copy size={15} aria-hidden="true" />
        </button>

        <button
          type="button"
          className="icon-button"
          title="Toggle bookmark for current heading"
          onClick={onBookmarkAdd}
          disabled={!document}
        >
          <BookmarkPlus size={15} aria-hidden="true" />
        </button>

        <button
          type="button"
          className="icon-button"
          title="Ask AI"
          aria-pressed={aiPanelOpen}
          onClick={onAiToggle}
        >
          <Sparkles size={15} aria-hidden="true" />
        </button>

        <button
          type="button"
          className="icon-button"
          title="Open settings"
          onClick={onSettingsToggle}
        >
          <Settings size={15} aria-hidden="true" />
        </button>
      </div>
    </header>
  );
}
