import type { MdvError } from "../lib/types";

interface ErrorStateProps {
  error: MdvError;
  rawContent?: string;
}

export function ErrorState({ error, rawContent }: ErrorStateProps) {
  return (
    <main className="state-view">
      <section className="state-panel state-panel--error">
        <p className="state-eyebrow">{error.kind}</p>
        <h1>{error.message}</h1>
        {error.path ? <p className="state-meta">Path: {error.path}</p> : null}
        {error.cwd ? <p className="state-meta">Working directory: {error.cwd}</p> : null}
        {error.details ? <pre className="state-details">{error.details}</pre> : null}
        {rawContent ? <pre className="raw-fallback">{rawContent}</pre> : null}
      </section>
    </main>
  );
}
