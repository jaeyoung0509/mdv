import { invoke } from "@tauri-apps/api/core";
import { useEffect, useMemo, useRef } from "react";
import type { CSSProperties, ComponentPropsWithoutRef, ReactNode } from "react";
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
import { getReaderStyleProperties } from "../plugins/readerSettings";
import { Bookmark } from "lucide-react";
import type {
  DocumentPayload,
  EffectiveTheme,
  OutlineHeading,
  ReaderPreferences,
} from "../lib/types";

interface MarkdownViewProps {
  document: DocumentPayload;
  allowHtml: boolean;
  preferences: ReaderPreferences;
  theme: EffectiveTheme;
  bookmarkedHeadingIds: Set<string>;
  onHeadingsChange: (headings: OutlineHeading[]) => void;
  onHeadingBookmarkToggle: (headingId: string, label: string) => void;
  onTextSelection: (text: string, position: { x: number; y: number }) => void;
}

function getLanguage(className: string | undefined): string | undefined {
  const match = /language-([a-z0-9_-]+)/i.exec(className || "");
  return match?.[1];
}

function isExternalHref(href: string): boolean {
  return /^(https?:|mailto:)/i.test(href);
}

function getHeadingText(element: Element): string {
  const clone = element.cloneNode(true) as Element;
  clone.querySelector(".heading-anchor")?.remove();
  return clone.textContent?.trim() ?? "";
}

function reactNodeText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }

  if (Array.isArray(node)) {
    return node.map(reactNodeText).join("");
  }

  if (node && typeof node === "object" && "props" in node) {
    return reactNodeText((node as { props?: { children?: ReactNode } }).props?.children);
  }

  return "";
}

export function MarkdownView({
  document,
  allowHtml,
  preferences,
  theme,
  bookmarkedHeadingIds,
  onHeadingsChange,
  onHeadingBookmarkToggle,
  onTextSelection,
}: MarkdownViewProps) {
  const articleRef = useRef<HTMLElement>(null);
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
  const readerStyle = useMemo(
    () => getReaderStyleProperties(preferences) as CSSProperties,
    [
      preferences.contentWidth,
      preferences.fontPreset,
      preferences.fontSize,
      preferences.lineHeight,
    ],
  );

  useEffect(() => {
    const headings = Array.from(
      articleRef.current?.querySelectorAll("h1, h2, h3, h4") ?? [],
    )
      .map((element) => ({
        id: element.id,
        level: Number(element.tagName.slice(1)),
        text: getHeadingText(element),
      }))
      .filter((heading) => heading.id && heading.text);

    onHeadingsChange(headings);

    return () => onHeadingsChange([]);
  }, [allowHtml, document.content, onHeadingsChange]);

  const handleSelection = () => {
    const selection = window.getSelection();
    const selectedText = selection?.toString().trim() ?? "";

    if (!selection || selectedText.length < 2 || selection.rangeCount === 0) {
      return;
    }

    const range = selection.getRangeAt(0);

    if (!articleRef.current?.contains(range.commonAncestorContainer)) {
      return;
    }

    const rect = range.getBoundingClientRect();
    onTextSelection(selectedText, {
      x: rect.left + rect.width / 2,
      y: Math.max(rect.top - 8, 64),
    });
  };

  const renderHeading =
    (Tag: "h1" | "h2" | "h3" | "h4") =>
    ({ children, id, className, ...props }: ComponentPropsWithoutRef<typeof Tag>) => {
      const headingId = typeof id === "string" ? id : "";
      const label = reactNodeText(children).replace("#", "").trim() || "Heading";
      const bookmarked = headingId ? bookmarkedHeadingIds.has(headingId) : false;

      return (
        <Tag
          id={id}
          className={["bookmarkable-heading", className].filter(Boolean).join(" ")}
          {...props}
        >
          {headingId ? (
            <button
              type="button"
              className="bookmark-ribbon"
              aria-pressed={bookmarked}
              title={bookmarked ? "Remove bookmark" : "Add bookmark"}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onHeadingBookmarkToggle(headingId, label);
              }}
            >
              <Bookmark size={14} aria-hidden="true" />
            </button>
          ) : null}
          {children}
        </Tag>
      );
    };

  return (
    <main className="document-shell">
      <article
        ref={articleRef}
        className="markdown-body mdv-markdown"
        style={readerStyle}
        onMouseUp={handleSelection}
        onKeyUp={handleSelection}
      >
        <ReactMarkdown
          remarkPlugins={[remarkGfm, remarkFrontmatter, remarkMath]}
          rehypePlugins={rehypePlugins}
          components={{
            h1: renderHeading("h1"),
            h2: renderHeading("h2"),
            h3: renderHeading("h3"),
            h4: renderHeading("h4"),
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
