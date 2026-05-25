import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";
import type { EffectiveTheme } from "../lib/types";

interface CodeBlockProps {
  code: string;
  language?: string;
  theme: EffectiveTheme;
}

export function CodeBlock({ code, language, theme }: CodeBlockProps) {
  const [html, setHtml] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const label = language || "text";

  useEffect(() => {
    let cancelled = false;

    setHtml(null);
    import("../lib/shiki")
      .then(({ highlightCode }) => highlightCode(code, language, theme))
      .then((value) => {
        if (!cancelled) {
          setHtml(value);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setHtml(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [code, language, theme]);

  const copy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };

  return (
    <div className="code-block">
      <div className="code-block__bar">
        <span>{label}</span>
        <button type="button" title="Copy code" onClick={copy}>
          {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
        </button>
      </div>
      {html ? (
        <div className="code-block__content" dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <pre className="code-block__fallback">
          <code>{code}</code>
        </pre>
      )}
    </div>
  );
}
