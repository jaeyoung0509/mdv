import { useEffect, useMemo, useState } from "react";
import { Bookmark, Trash2, X } from "lucide-react";
import type { OutlineHeading, ReaderBookmark } from "../lib/types";

interface OutlinePanelProps {
  bookmarks: ReaderBookmark[];
  headings: OutlineHeading[];
  open: boolean;
  onBookmarkRemove: (bookmarkId: string) => void;
  onBookmarkSelect: (bookmark: ReaderBookmark) => void;
  onClose: () => void;
}

function scrollToHeading(id: string): void {
  const element = document.getElementById(id);

  if (!element) {
    return;
  }

  element.scrollIntoView({ behavior: "smooth", block: "start" });
  window.history.replaceState(null, "", `#${id}`);
}

export function OutlinePanel({
  bookmarks,
  headings,
  open,
  onBookmarkRemove,
  onBookmarkSelect,
  onClose,
}: OutlinePanelProps) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"outline" | "bookmarks">("outline");
  const orderedBookmarks = useMemo(() => {
    const headingOrder = new Map(headings.map((heading, index) => [heading.id, index]));

    return [...bookmarks].sort((left, right) => {
      const leftIndex =
        left.target.kind === "heading"
          ? (headingOrder.get(left.target.headingId) ?? Number.MAX_SAFE_INTEGER)
          : Number.MAX_SAFE_INTEGER;
      const rightIndex =
        right.target.kind === "heading"
          ? (headingOrder.get(right.target.headingId) ?? Number.MAX_SAFE_INTEGER)
          : Number.MAX_SAFE_INTEGER;
      const leftOffset =
        left.target.kind === "heading" ? left.target.scrollYFallback : left.target.scrollY;
      const rightOffset =
        right.target.kind === "heading" ? right.target.scrollYFallback : right.target.scrollY;

      return leftIndex - rightIndex || leftOffset - rightOffset || left.createdAt - right.createdAt;
    });
  }, [bookmarks, headings]);

  useEffect(() => {
    if (!open) {
      setActiveId(null);
      return;
    }

    const elements = headings
      .map((heading) => document.getElementById(heading.id))
      .filter((element): element is HTMLElement => Boolean(element));

    if (elements.length === 0) {
      setActiveId(null);
      return;
    }

    const updateActiveHeading = () => {
      const isNearBottom =
        window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4;

      if (isNearBottom) {
        setActiveId(headings[headings.length - 1]?.id ?? null);
        return;
      }

      let nextActiveId = headings[0]?.id ?? null;

      for (const heading of headings) {
        const element = document.getElementById(heading.id);

        if (!element) {
          continue;
        }

        if (element.getBoundingClientRect().top <= 120) {
          nextActiveId = heading.id;
          continue;
        }

        break;
      }

      setActiveId(nextActiveId);
    };

    const observer = new IntersectionObserver(updateActiveHeading, {
      rootMargin: "-96px 0px -70% 0px",
      threshold: [0, 1],
    });

    elements.forEach((element) => observer.observe(element));
    updateActiveHeading();
    window.addEventListener("scroll", updateActiveHeading, { passive: true });

    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", updateActiveHeading);
    };
  }, [headings, open]);

  if (!open) {
    return null;
  }

  return (
    <aside className="outline-panel" aria-label="Outline">
      <div className="panel-header">
        <h2>Outline</h2>
        <button
          type="button"
          className="icon-button outline-panel__close"
          title="Close outline"
          onClick={onClose}
        >
          <X size={16} aria-hidden="true" />
        </button>
      </div>

      <div className="panel-tabs" role="tablist" aria-label="Outline panel sections">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "outline"}
          onClick={() => setActiveTab("outline")}
        >
          Outline
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "bookmarks"}
          onClick={() => setActiveTab("bookmarks")}
        >
          Bookmarks
          <span>{bookmarks.length}</span>
        </button>
      </div>

      {activeTab === "outline" ? (
        headings.length > 0 ? (
          <nav className="outline-nav">
            {headings.map((heading) => (
              <button
                key={heading.id}
                type="button"
                className="outline-nav__item"
                data-level={heading.level}
                aria-current={activeId === heading.id ? "true" : undefined}
                onClick={() => scrollToHeading(heading.id)}
              >
                {heading.text}
              </button>
            ))}
          </nav>
        ) : (
          <p className="outline-empty">No headings</p>
        )
      ) : orderedBookmarks.length > 0 ? (
          <div className="bookmark-list">
            {orderedBookmarks.map((bookmark) => (
              <div key={bookmark.id} className="bookmark-row">
                <button
                  type="button"
                  className="bookmark-row__jump"
                  title={bookmark.label}
                  onClick={() => onBookmarkSelect(bookmark)}
                >
                  <Bookmark size={13} aria-hidden="true" />
                  <span>{bookmark.label}</span>
                </button>
                <button
                  type="button"
                  className="icon-button bookmark-row__remove"
                  title="Remove bookmark"
                  onClick={() => onBookmarkRemove(bookmark.id)}
                >
                  <Trash2 size={13} aria-hidden="true" />
                </button>
              </div>
            ))}
          </div>
      ) : (
        <p className="outline-empty">No bookmarks</p>
      )}
    </aside>
  );
}
