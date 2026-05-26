<script setup lang="ts">
import { invoke } from "@tauri-apps/api/core";
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { renderMarkdownHtml } from "../lib/markdown";
import type {
  DocumentPayload,
  EffectiveTheme,
  OutlineHeading,
  ReaderPreferences,
} from "../lib/types";
import { getReaderStyleProperties } from "../lib/readerSettings";

const props = defineProps<{
  document: DocumentPayload;
  allowHtml: boolean;
  preferences: ReaderPreferences;
  theme: EffectiveTheme;
  bookmarkedHeadingIds: Set<string>;
}>();

const emit = defineEmits<{
  headingsChange: [headings: OutlineHeading[]];
  headingBookmarkToggle: [headingId: string, label: string];
  textSelection: [text: string, position: { x: number; y: number }];
}>();

const articleRef = ref<HTMLElement | null>(null);
const html = ref("");
let renderVersion = 0;

const readerStyle = computed(() => getReaderStyleProperties(props.preferences));

function getLanguage(className: string | undefined): string | undefined {
  const match = /language-([a-z0-9_-]+)/i.exec(className || "");
  return match?.[1];
}

function isExternalHref(href: string): boolean {
  return /^(https?:|mailto:)/i.test(href);
}

function isBrowserSafeSource(src: string): boolean {
  return /^(https?:|data:|blob:)/i.test(src) || src.startsWith("#");
}

function getHeadingText(element: Element): string {
  const clone = element.cloneNode(true) as Element;
  clone.querySelector(".heading-anchor")?.remove();
  clone.querySelector(".bookmark-ribbon")?.remove();
  return clone.textContent?.trim() ?? "";
}

function bookmarkIconSvg(): string {
  return [
    '<svg viewBox="0 0 24 24" width="14" height="14" fill="none"',
    'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"',
    'aria-hidden="true"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>',
  ].join(" ");
}

function copyIconSvg(): string {
  return [
    '<svg viewBox="0 0 24 24" width="14" height="14" fill="none"',
    'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"',
    'aria-hidden="true"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/>',
    '<path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>',
  ].join(" ");
}

function checkIconSvg(): string {
  return [
    '<svg viewBox="0 0 24 24" width="14" height="14" fill="none"',
    'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"',
    'aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>',
  ].join(" ");
}

function enhanceHeadings() {
  const article = articleRef.value;

  if (!article) {
    return;
  }

  const headingElements = Array.from(article.querySelectorAll("h1, h2, h3, h4"));

  for (const element of headingElements) {
    const headingId = element.id;

    if (!headingId) {
      continue;
    }

    const label = getHeadingText(element) || "Heading";
    let button = Array.from(element.children).find((child) =>
      child.classList.contains("bookmark-ribbon"),
    ) as HTMLButtonElement | undefined;

    if (!button) {
      button = document.createElement("button");
      button.type = "button";
      button.className = "bookmark-ribbon";
      button.innerHTML = bookmarkIconSvg();
      element.prepend(button);
    }

    const bookmarked = props.bookmarkedHeadingIds.has(headingId);
    button.setAttribute("aria-pressed", String(bookmarked));
    button.title = bookmarked ? "Remove bookmark" : "Add bookmark";
    button.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      emit("headingBookmarkToggle", headingId, label);
    };
  }

  const headings = headingElements
    .map((element) => ({
      id: element.id,
      level: Number(element.tagName.slice(1)),
      text: getHeadingText(element),
    }))
    .filter((heading) => heading.id && heading.text);

  emit("headingsChange", headings);
}

async function renderMermaid(target: HTMLElement, code: string) {
  try {
    const { default: mermaid } = await import("mermaid");
    const id = `mdv-mermaid-${Math.random().toString(36).slice(2)}`;
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: props.theme === "dark" ? "dark" : "default",
      fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    });
    const { svg } = await mermaid.render(id, code);
    target.className = "mermaid-block";
    target.innerHTML = svg;
  } catch (reason: unknown) {
    target.className = "mermaid-error";
    target.innerHTML = "";

    const strong = document.createElement("strong");
    strong.textContent = "Could not render Mermaid diagram.";
    const pre = document.createElement("pre");
    pre.textContent = code;
    const details = document.createElement("details");
    const summary = document.createElement("summary");
    const message = document.createElement("p");
    summary.textContent = "Error details";
    message.textContent = reason instanceof Error ? reason.message : String(reason);
    details.append(summary, message);
    target.append(strong, pre, details);
  }
}

function enhanceCodeBlocks() {
  const article = articleRef.value;

  if (!article) {
    return;
  }

  const codeElements = Array.from(article.querySelectorAll("pre > code"));

  for (const codeElement of codeElements) {
    const pre = codeElement.parentElement;

    if (!pre || pre.closest(".code-block, .mermaid-block, .mermaid-loading, .mermaid-error")) {
      continue;
    }

    const code = (codeElement.textContent ?? "").replace(/\n$/, "");
    const language = getLanguage(codeElement.className);

    if (language?.toLowerCase() === "mermaid") {
      const mermaidBlock = document.createElement("div");
      mermaidBlock.className = "mermaid-loading";
      mermaidBlock.textContent = "Rendering Mermaid diagram...";
      pre.replaceWith(mermaidBlock);
      void renderMermaid(mermaidBlock, code);
      continue;
    }

    const wrapper = document.createElement("div");
    wrapper.className = "code-block";

    const bar = document.createElement("div");
    bar.className = "code-block__bar";

    const label = document.createElement("span");
    label.textContent = language || "text";

    const copyButton = document.createElement("button");
    copyButton.type = "button";
    copyButton.title = "Copy code";
    copyButton.innerHTML = copyIconSvg();
    copyButton.onclick = async () => {
      await navigator.clipboard.writeText(code);
      copyButton.innerHTML = checkIconSvg();
      window.setTimeout(() => {
        copyButton.innerHTML = copyIconSvg();
      }, 1200);
    };

    const content = document.createElement("div");
    content.className = "code-block__content";

    const fallback = document.createElement("pre");
    fallback.className = "code-block__fallback";
    const fallbackCode = document.createElement("code");
    fallbackCode.textContent = code;
    fallback.append(fallbackCode);
    content.append(fallback);

    bar.append(label, copyButton);
    wrapper.append(bar, content);
    pre.replaceWith(wrapper);

    import("../lib/shiki")
      .then(({ highlightCode }) => highlightCode(code, language, props.theme))
      .then((highlightedHtml) => {
        if (highlightedHtml) {
          content.innerHTML = highlightedHtml;
        }
      })
      .catch(() => {
        content.replaceChildren(fallback);
      });
  }
}

function replaceMissingImage(img: HTMLImageElement, src: string) {
  const missing = document.createElement("span");
  missing.className = "missing-image";
  missing.setAttribute("role", "img");
  missing.setAttribute("aria-label", img.alt || "Missing image");
  missing.textContent = `Missing image: ${src}`;
  img.replaceWith(missing);
}

function resolveImages() {
  const article = articleRef.value;

  if (!article) {
    return;
  }

  const images = Array.from(article.querySelectorAll("img"));

  for (const img of images) {
    const src = img.getAttribute("src") ?? "";

    if (!src) {
      replaceMissingImage(img, src);
      continue;
    }

    if (isBrowserSafeSource(src)) {
      continue;
    }

    invoke<string>("resolve_image_src", { src, markdownPath: props.document.path })
      .then((resolvedSrc) => {
        img.src = resolvedSrc;
      })
      .catch(() => {
        replaceMissingImage(img, src);
      });
  }
}

function enhanceRenderedMarkdown() {
  enhanceHeadings();
  enhanceCodeBlocks();
  resolveImages();
}

async function renderDocument() {
  const version = ++renderVersion;
  html.value = await renderMarkdownHtml(props.document.content, props.allowHtml);
  await nextTick();

  if (version === renderVersion) {
    enhanceRenderedMarkdown();
  }
}

function handleSelection() {
  const selection = window.getSelection();
  const selectedText = selection?.toString().trim() ?? "";

  if (!selection || selectedText.length < 2 || selection.rangeCount === 0) {
    return;
  }

  const range = selection.getRangeAt(0);

  if (!articleRef.value?.contains(range.commonAncestorContainer)) {
    return;
  }

  const rect = range.getBoundingClientRect();
  emit("textSelection", selectedText, {
    x: rect.left + rect.width / 2,
    y: Math.max(rect.top - 8, 64),
  });
}

async function handleArticleClick(event: MouseEvent) {
  const target = event.target;

  if (!(target instanceof Element)) {
    return;
  }

  const link = target.closest("a");
  const href = link?.getAttribute("href") || "";

  if (!href || !isExternalHref(href)) {
    return;
  }

  event.preventDefault();
  await invoke("open_external_url", { url: href });
}

watch(
  () => [props.document.path, props.document.content, props.allowHtml, props.theme] as const,
  () => {
    void renderDocument();
  },
  { immediate: true },
);

watch(
  () => props.bookmarkedHeadingIds,
  () => {
    void nextTick(enhanceHeadings);
  },
);

onBeforeUnmount(() => {
  emit("headingsChange", []);
});
</script>

<template>
  <main class="document-shell">
    <article
      ref="articleRef"
      class="markdown-body mdv-markdown"
      :style="readerStyle"
      @click="handleArticleClick"
      @mouseup="handleSelection"
      @keyup="handleSelection"
      v-html="html"
    />
  </main>
</template>
