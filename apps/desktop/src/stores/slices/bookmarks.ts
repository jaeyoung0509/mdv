import type { OutlineHeading, ReaderBookmark, ReaderPreferences } from "../../lib/types";
import type { AppState } from "../appState";

function getCurrentHeading(headings: OutlineHeading[]): OutlineHeading | null {
  let currentHeading = headings[0] ?? null;

  for (const heading of headings) {
    const element = window.document.getElementById(heading.id);

    if (!element) {
      continue;
    }

    if (element.getBoundingClientRect().top <= 140) {
      currentHeading = heading;
      continue;
    }

    break;
  }

  return currentHeading;
}

export function createBookmarksSlice(
  state: AppState,
  updatePreferences: (updater: (current: ReaderPreferences) => ReaderPreferences) => void,
) {
  function updateHeadings(nextHeadings: OutlineHeading[]) {
    state.headings.value = nextHeadings;
  }

  function toggleHeadingBookmark(headingId: string, label: string) {
    if (!state.document.value) {
      return;
    }

    const element = window.document.getElementById(headingId);
    const scrollYFallback = Math.max(
      0,
      Math.round((element?.getBoundingClientRect().top ?? 0) + window.scrollY),
    );
    const createdAt = Date.now();
    const documentPath = state.document.value.path;

    updatePreferences((current) => {
      const currentBookmarks = current.bookmarks[documentPath] ?? [];
      const existing = currentBookmarks.find(
        (bookmark) =>
          bookmark.target.kind === "heading" && bookmark.target.headingId === headingId,
      );
      const bookmarks = { ...current.bookmarks };

      if (existing) {
        const nextBookmarks = currentBookmarks.filter((bookmark) => bookmark.id !== existing.id);

        if (nextBookmarks.length > 0) {
          bookmarks[documentPath] = nextBookmarks;
        } else {
          delete bookmarks[documentPath];
        }

        return { ...current, bookmarks };
      }

      const nextBookmark: ReaderBookmark = {
        id: `${createdAt}-${Math.random().toString(36).slice(2, 8)}`,
        label,
        target: {
          kind: "heading",
          headingId,
          scrollYFallback,
        },
        createdAt,
      };

      return {
        ...current,
        bookmarks: {
          ...current.bookmarks,
          [documentPath]: [nextBookmark, ...currentBookmarks].slice(0, 40),
        },
      };
    });
  }

  function toggleCurrentBookmark() {
    if (!state.document.value) {
      return;
    }

    const heading = getCurrentHeading(state.headings.value);

    if (heading) {
      toggleHeadingBookmark(heading.id, heading.text);
      return;
    }

    const scrollY = Math.max(0, Math.round(window.scrollY));
    const createdAt = Date.now();
    const documentPath = state.document.value.path;
    const documentFileName = state.document.value.fileName;

    updatePreferences((current) => {
      const currentBookmarks = current.bookmarks[documentPath] ?? [];
      const existing = currentBookmarks.find((bookmark) => {
        if (bookmark.target.kind !== "offset") {
          return false;
        }

        return Math.abs(bookmark.target.scrollY - scrollY) <= 32;
      });
      const bookmarks = { ...current.bookmarks };

      if (existing) {
        const nextBookmarks = currentBookmarks.filter((bookmark) => bookmark.id !== existing.id);

        if (nextBookmarks.length > 0) {
          bookmarks[documentPath] = nextBookmarks;
        } else {
          delete bookmarks[documentPath];
        }

        return { ...current, bookmarks };
      }

      const nextBookmark: ReaderBookmark = {
        id: `${createdAt}-${Math.random().toString(36).slice(2, 8)}`,
        label: `${documentFileName} at ${scrollY}px`,
        target: {
          kind: "offset",
          scrollY,
        },
        createdAt,
      };

      return {
        ...current,
        bookmarks: {
          ...current.bookmarks,
          [documentPath]: [nextBookmark, ...currentBookmarks].slice(0, 40),
        },
      };
    });
  }

  function removeBookmark(bookmarkId: string) {
    if (!state.document.value) {
      return;
    }

    const documentPath = state.document.value.path;

    updatePreferences((current) => {
      const nextBookmarks = (current.bookmarks[documentPath] ?? []).filter(
        (bookmark) => bookmark.id !== bookmarkId,
      );
      const bookmarks = { ...current.bookmarks };

      if (nextBookmarks.length > 0) {
        bookmarks[documentPath] = nextBookmarks;
      } else {
        delete bookmarks[documentPath];
      }

      return { ...current, bookmarks };
    });
  }

  function selectBookmark(bookmark: ReaderBookmark) {
    if (bookmark.target.kind === "heading") {
      const heading = window.document.getElementById(bookmark.target.headingId);

      if (heading) {
        heading.scrollIntoView({ behavior: "smooth", block: "start" });
        window.history.replaceState(null, "", `#${bookmark.target.headingId}`);
        return;
      }

      window.scrollTo({ top: bookmark.target.scrollYFallback, behavior: "smooth" });
      return;
    }

    window.scrollTo({ top: bookmark.target.scrollY, behavior: "smooth" });
  }

  return {
    removeBookmark,
    selectBookmark,
    toggleCurrentBookmark,
    toggleHeadingBookmark,
    updateHeadings,
  };
}
