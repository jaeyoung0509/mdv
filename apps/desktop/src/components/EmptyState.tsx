import { FileUp, FolderOpen } from "lucide-react";

interface EmptyStateProps {
  title: string;
  message: string;
  path?: string;
  opening?: boolean;
  onOpenFile?: () => void;
}

export function EmptyState({ title, message, path, opening = false, onOpenFile }: EmptyStateProps) {
  return (
    <main className="state-view">
      <section className="state-panel">
        <p className="state-eyebrow">No document</p>
        <h1>{title}</h1>
        <p>{message}</p>
        {path ? <p className="state-meta">Directory: {path}</p> : null}
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
        <p className="state-hint">
          <FileUp size={15} aria-hidden="true" />
          Drag a .md or .markdown file into this window.
        </p>
        <pre className="state-command">mdv README.md</pre>
      </section>
    </main>
  );
}
