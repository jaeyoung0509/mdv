interface EmptyStateProps {
  title: string;
  message: string;
  path?: string;
}

export function EmptyState({ title, message, path }: EmptyStateProps) {
  return (
    <main className="state-view">
      <section className="state-panel">
        <p className="state-eyebrow">No document</p>
        <h1>{title}</h1>
        <p>{message}</p>
        {path ? <p className="state-meta">Directory: {path}</p> : null}
        <pre className="state-command">mdv README.md</pre>
      </section>
    </main>
  );
}
