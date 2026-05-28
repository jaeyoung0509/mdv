import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor, within } from "@testing-library/vue";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_READER_PREFERENCES } from "../lib/preferences";
import MarkdownView from "./MarkdownView.vue";
import type { AiNoteThread, DocumentPayload } from "../lib/types";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const documentPayload: DocumentPayload = {
  path: "/Users/apple/project/readme.md",
  fileName: "readme.md",
  directory: "/Users/apple/project",
  content: "# Title\n\nBody",
  watching: true,
  modifiedMillis: 10,
};

function renderMarkdownView(bookmarkedHeadingIds = new Set<string>()) {
  return render(MarkdownView, {
    props: {
      allowHtml: false,
      aiNotes: [],
      bookmarkedHeadingIds,
      document: documentPayload,
      preferences: DEFAULT_READER_PREFERENCES,
      theme: "light",
    },
  });
}

describe("MarkdownView bookmarks", () => {
  it("adds bookmark controls to rendered headings", async () => {
    renderMarkdownView();

    const title = await screen.findByText("Title");
    const heading = title.closest("h1");

    await waitFor(() => {
      expect(heading).toHaveClass("bookmarkable-heading");
      expect(within(heading as HTMLElement).getByTitle("Add bookmark")).toHaveAttribute(
        "aria-pressed",
        "false",
      );
    });
  });

  it("emits a heading bookmark toggle when the heading control is clicked", async () => {
    const user = userEvent.setup();
    const wrapper = renderMarkdownView();

    await user.click(await screen.findByTitle("Add bookmark"));

    expect(wrapper.emitted().headingBookmarkToggle?.[0]).toEqual(["title", "Title"]);
  });

  it("syncs bookmarked heading visual state", async () => {
    renderMarkdownView(new Set(["title"]));

    await waitFor(() => {
      expect(screen.getByTitle("Remove bookmark")).toHaveAttribute("aria-pressed", "true");
    });
  });

  it("adds bookmark controls to h5 and h6 headings", async () => {
    render(MarkdownView, {
      props: {
        allowHtml: false,
        aiNotes: [],
        bookmarkedHeadingIds: new Set<string>(),
        document: {
          ...documentPayload,
          content: "##### Deep\n\n###### Deeper",
        },
        preferences: DEFAULT_READER_PREFERENCES,
        theme: "light",
      },
    });

    expect(await screen.findByText("Deep")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getAllByTitle("Add bookmark")).toHaveLength(2);
    });
  });

  it("renders AI note markers on heading anchors", async () => {
    const wrapper = render(MarkdownView, {
      props: {
        allowHtml: false,
        aiNotes: [
          {
            id: "note-1",
            anchor: {
              kind: "heading",
              headingId: "title",
              label: "Title",
              scrollYFallback: 0,
            },
            title: "AI note",
            messages: [
              {
                id: "message-1",
                role: "assistant",
                content: "Answer",
                createdAt: 1,
              },
            ],
            resolved: false,
            createdAt: 1,
            updatedAt: 1,
          },
        ],
        bookmarkedHeadingIds: new Set<string>(),
        document: documentPayload,
        preferences: DEFAULT_READER_PREFERENCES,
        theme: "light",
      },
    });
    const user = userEvent.setup();

    await user.click(await screen.findByTitle("1 AI note"));

    const emitted = wrapper.emitted() as Record<string, unknown[][]>;

    expect(emitted.aiNoteSelect?.[0]?.[0] as AiNoteThread).toMatchObject({
      id: "note-1",
    });
  });

  it("sanitizes raw HTML attributes when HTML is allowed", async () => {
    render(MarkdownView, {
      props: {
        allowHtml: true,
        aiNotes: [],
        bookmarkedHeadingIds: new Set<string>(),
        document: {
          ...documentPayload,
          content: '<img src="https://example.test/image.png" onerror="alert(1)" />',
        },
        preferences: DEFAULT_READER_PREFERENCES,
        theme: "light",
      },
    });

    await waitFor(() => {
      const image = document.querySelector("img");
      expect(image).toBeInTheDocument();
      expect(image).not.toHaveAttribute("onerror");
    });
  });
});
