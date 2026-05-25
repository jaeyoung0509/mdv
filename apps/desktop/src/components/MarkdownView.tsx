import { invoke } from "@tauri-apps/api/core";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkFrontmatter from "remark-frontmatter";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import rehypeSlug from "rehype-slug";
import rehypeAutolinkHeadings from "rehype-autolink-headings";
import type { Pluggable, PluggableList } from "unified";
import { CodeBlock } from "./CodeBlock";
import { ImageRenderer } from "./ImageRenderer";
import { MermaidBlock } from "./MermaidBlock";
import type { DocumentPayload, EffectiveTheme } from "../lib/types";

interface MarkdownViewProps {
  document: DocumentPayload;
  allowHtml: boolean;
  theme: EffectiveTheme;
}

function getLanguage(className: string | undefined): string | undefined {
  const match = /language-([a-z0-9_-]+)/i.exec(className || "");
  return match?.[1];
}

function isExternalHref(href: string): boolean {
  return /^(https?:|mailto:)/i.test(href);
}

export function MarkdownView({ document, allowHtml, theme }: MarkdownViewProps) {
  const autolinkHeadings: Pluggable = [
    rehypeAutolinkHeadings,
    {
      behavior: "append" as const,
      properties: {
        className: ["heading-anchor"],
        ariaLabel: "Link to heading",
      },
      content: {
        type: "text",
        value: "#",
      },
    },
  ];
  const rehypePlugins: PluggableList = allowHtml
    ? [rehypeRaw, rehypeSanitize, rehypeKatex, rehypeSlug, autolinkHeadings]
    : [rehypeKatex, rehypeSlug, autolinkHeadings];

  return (
    <main className="document-shell">
      <article className="markdown-body mdv-markdown">
        <ReactMarkdown
          remarkPlugins={[remarkGfm, remarkFrontmatter, remarkMath]}
          rehypePlugins={rehypePlugins}
          components={{
            code(props) {
              const { className, children, ...rest } = props;
              const language = getLanguage(className);
              const code = String(children).replace(/\n$/, "");
              const isBlock = code.includes("\n") || Boolean(language);

              if (isBlock && language?.toLowerCase() === "mermaid") {
                return <MermaidBlock code={code} theme={theme} />;
              }

              if (isBlock) {
                return <CodeBlock code={code} language={language} theme={theme} />;
              }

              return (
                <code className={className} {...rest}>
                  {children}
                </code>
              );
            },
            img(props) {
              return <ImageRenderer {...props} markdownPath={document.path} />;
            },
            a(props) {
              const href = props.href || "";
              const onClick = async (event: React.MouseEvent<HTMLAnchorElement>) => {
                if (!isExternalHref(href)) {
                  return;
                }

                event.preventDefault();
                await invoke("open_external_url", { url: href });
              };

              return (
                <a {...props} onClick={onClick}>
                  {props.children}
                </a>
              );
            },
          }}
        >
          {document.content}
        </ReactMarkdown>
      </article>
    </main>
  );
}
