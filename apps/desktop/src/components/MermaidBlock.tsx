import { useEffect, useRef, useState } from "react";
import type { EffectiveTheme } from "../lib/types";

interface MermaidBlockProps {
  code: string;
  theme: EffectiveTheme;
}

export function MermaidBlock({ code, theme }: MermaidBlockProps) {
  const id = useRef(`mdv-mermaid-${Math.random().toString(36).slice(2)}`);
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    setSvg(null);
    setError(null);
    import("mermaid")
      .then(({ default: mermaid }) => {
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: theme === "dark" ? "dark" : "default",
          fontFamily:
            'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        });

        return mermaid.render(id.current, code);
      })
      .then(({ svg: renderedSvg }) => {
        if (!cancelled) {
          setSvg(renderedSvg);
        }
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : String(reason));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [code, theme]);

  if (error) {
    return (
      <div className="mermaid-error">
        <strong>Could not render Mermaid diagram.</strong>
        <pre>{code}</pre>
        <details>
          <summary>Error details</summary>
          <p>{error}</p>
        </details>
      </div>
    );
  }

  if (!svg) {
    return <div className="mermaid-loading">Rendering Mermaid diagram...</div>;
  }

  return <div className="mermaid-block" dangerouslySetInnerHTML={{ __html: svg }} />;
}
