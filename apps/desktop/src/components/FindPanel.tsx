import { ChevronDown, ChevronUp, Search, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

const RESULT_HIGHLIGHT = "mdv-find-result";
const ACTIVE_HIGHLIGHT = "mdv-find-active";

type HighlightLike = unknown;
type HighlightConstructor = new (...ranges: Range[]) => HighlightLike;
type HighlightRegistry = {
  delete: (name: string) => void;
  set: (name: string, highlight: HighlightLike) => void;
};

interface FindPanelProps {
  documentKey?: string;
  open: boolean;
  rootSelector: string;
  onClose: () => void;
}

interface TextSegment {
  node: Text;
  start: number;
  end: number;
}

function getHighlightTools():
  | { Highlight: HighlightConstructor; registry: HighlightRegistry }
  | null {
  if (typeof CSS === "undefined" || typeof window === "undefined") {
    return null;
  }

  const registry = (CSS as unknown as { highlights?: HighlightRegistry }).highlights;
  const Highlight = (window as unknown as { Highlight?: HighlightConstructor }).Highlight;

  if (!registry || !Highlight) {
    return null;
  }

  return { Highlight, registry };
}

function clearFindHighlights() {
  const tools = getHighlightTools();

  if (!tools) {
    return;
  }

  tools.registry.delete(RESULT_HIGHLIGHT);
  tools.registry.delete(ACTIVE_HIGHLIGHT);
}

function collectTextSegments(root: Element): TextSegment[] {
  const walker = window.document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.textContent?.trim()) {
        return NodeFilter.FILTER_REJECT;
      }

      const parent = node.parentElement;

      if (!parent || parent.closest("button, input, select, textarea, .heading-anchor")) {
        return NodeFilter.FILTER_REJECT;
      }

      return NodeFilter.FILTER_ACCEPT;
    },
  });
  const segments: TextSegment[] = [];
  let offset = 0;
  let node = walker.nextNode();

  while (node) {
    const text = node.textContent ?? "";
    const nextOffset = offset + text.length;
    segments.push({ node: node as Text, start: offset, end: nextOffset });
    offset = nextOffset;
    node = walker.nextNode();
  }

  return segments;
}

function pointAt(segments: TextSegment[], offset: number) {
  if (segments.length === 0) {
    return null;
  }

  if (offset <= 0) {
    return { node: segments[0].node, offset: 0 };
  }

  for (const segment of segments) {
    if (offset >= segment.start && offset <= segment.end) {
      return {
        node: segment.node,
        offset: offset - segment.start,
      };
    }
  }

  const last = segments[segments.length - 1];
  return { node: last.node, offset: last.node.data.length };
}

function createSearchRanges(root: Element, query: string): Range[] {
  const segments = collectTextSegments(root);
  const haystack = segments.map((segment) => segment.node.data).join("");
  const normalizedHaystack = haystack.toLocaleLowerCase();
  const normalizedQuery = query.toLocaleLowerCase();
  const ranges: Range[] = [];
  let matchIndex = normalizedHaystack.indexOf(normalizedQuery);

  while (matchIndex >= 0) {
    const start = pointAt(segments, matchIndex);
    const end = pointAt(segments, matchIndex + query.length);

    if (start && end) {
      const range = window.document.createRange();
      range.setStart(start.node, start.offset);
      range.setEnd(end.node, end.offset);
      ranges.push(range);
    }

    matchIndex = normalizedHaystack.indexOf(normalizedQuery, matchIndex + query.length);
  }

  return ranges;
}

function applyHighlights(ranges: Range[], activeIndex: number): boolean {
  clearFindHighlights();

  const tools = getHighlightTools();

  if (!tools || ranges.length === 0) {
    return false;
  }

  const resultRanges = ranges.filter((_, index) => index !== activeIndex);

  if (resultRanges.length > 0) {
    tools.registry.set(RESULT_HIGHLIGHT, new tools.Highlight(...resultRanges));
  }

  if (activeIndex >= 0 && ranges[activeIndex]) {
    tools.registry.set(ACTIVE_HIGHLIGHT, new tools.Highlight(ranges[activeIndex]));
  }

  return true;
}

function getRangeRect(range: Range): DOMRect | null {
  const rect = range.getBoundingClientRect();

  if (rect.width || rect.height) {
    return rect;
  }

  return range.getClientRects()[0] ?? null;
}

function scrollRangeIntoView(range: Range) {
  const rect = getRangeRect(range);

  if (!rect) {
    return;
  }

  window.scrollTo({
    top: Math.max(0, window.scrollY + rect.top - 128),
    behavior: "smooth",
  });
}

function selectRange(range: Range) {
  const selection = window.getSelection();

  if (!selection) {
    return;
  }

  selection.removeAllRanges();
  selection.addRange(range.cloneRange());
}

export function FindPanel({ documentKey, open, rootSelector, onClose }: FindPanelProps) {
  const [query, setQuery] = useState("");
  const [matchCount, setMatchCount] = useState(0);
  const [activeIndex, setActiveIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const rangesRef = useRef<Range[]>([]);

  const moveActiveMatch = useCallback(
    (direction: 1 | -1) => {
      setActiveIndex((current) => {
        if (matchCount === 0) {
          return -1;
        }

        const safeCurrent = current < 0 ? 0 : current;
        return (safeCurrent + direction + matchCount) % matchCount;
      });
    },
    [matchCount],
  );

  useEffect(() => {
    if (!open) {
      clearFindHighlights();
      return;
    }

    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }, [open]);

  useEffect(() => {
    clearFindHighlights();

    if (!open || !query.trim()) {
      rangesRef.current = [];
      setMatchCount(0);
      setActiveIndex(-1);
      return;
    }

    const root = window.document.querySelector(rootSelector);

    if (!root) {
      rangesRef.current = [];
      setMatchCount(0);
      setActiveIndex(-1);
      return;
    }

    const ranges = createSearchRanges(root, query.trim());
    rangesRef.current = ranges;
    setMatchCount(ranges.length);
    setActiveIndex(ranges.length > 0 ? 0 : -1);
  }, [documentKey, open, query, rootSelector]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const ranges = rangesRef.current;
    const hasCustomHighlights = applyHighlights(ranges, activeIndex);
    const activeRange = activeIndex >= 0 ? ranges[activeIndex] : null;

    if (!activeRange) {
      return;
    }

    scrollRangeIntoView(activeRange);

    if (!hasCustomHighlights) {
      selectRange(activeRange);
    }
  }, [activeIndex, matchCount, open, query]);

  useEffect(() => clearFindHighlights, []);

  if (!open) {
    return null;
  }

  const hasQuery = Boolean(query.trim());
  const currentMatch = activeIndex >= 0 ? activeIndex + 1 : 0;

  return (
    <aside className="find-panel" aria-label="Find in document">
      <Search size={15} aria-hidden="true" />
      <input
        ref={inputRef}
        type="search"
        value={query}
        placeholder="Find in document"
        aria-label="Find in document"
        onChange={(event) => setQuery(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            moveActiveMatch(event.shiftKey ? -1 : 1);
          }

          if (event.key === "Escape") {
            event.preventDefault();
            onClose();
          }
        }}
      />
      <span className="find-panel__count" aria-live="polite">
        {hasQuery ? `${currentMatch}/${matchCount}` : "0/0"}
      </span>
      <button
        type="button"
        className="icon-button"
        title="Previous match"
        disabled={matchCount === 0}
        onClick={() => moveActiveMatch(-1)}
      >
        <ChevronUp size={15} aria-hidden="true" />
      </button>
      <button
        type="button"
        className="icon-button"
        title="Next match"
        disabled={matchCount === 0}
        onClick={() => moveActiveMatch(1)}
      >
        <ChevronDown size={15} aria-hidden="true" />
      </button>
      <button type="button" className="icon-button" title="Close find" onClick={onClose}>
        <X size={15} aria-hidden="true" />
      </button>
    </aside>
  );
}
