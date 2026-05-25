import { FolderOpen } from "lucide-react";
import type { MdvError } from "../lib/types";

interface ErrorStateProps {
  error: MdvError;
  rawContent?: string;
  opening?: boolean;
  onOpenFile?: () => void;
}

export function ErrorState({
  error,
  rawContent,
  opening = false,
  onOpenFile,
}: ErrorStateProps) {
  return (
    <main className="state-view">
      <section className="state-panel state-panel--error">
        <p className="state-eyebrow">{error.kind}</p>
        <h1>{error.message}</h1>
        {error.path ? <p className="state-meta">Path: {error.path}</p> : null}
        {error.cwd ? <p className="state-meta">Working directory: {error.cwd}</p> : null}
        {error.details ? <pre className="state-details">{error.details}</pre> : null}
        {onOpenFile ? (
          <div className="state-actions">
            <button
              type="button"
              className="primary-button"
              onClick={onOpenFile}
              disabled={opening}
            >
              <FolderOpen size={16} aria-hidden="true" />
              {opening ? "Opening..." : "Open Markdown"}
            </button>
          </div>
        ) : null}
        {rawContent ? <pre className="raw-fallback">{rawContent}</pre> : null}
      </section>
    </main>
  );
}
