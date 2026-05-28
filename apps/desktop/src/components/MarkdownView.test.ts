import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor, within } from "@testing-library/vue";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_READER_PREFERENCES } from "../lib/preferences";
import MarkdownView from "./MarkdownView.vue";
import type { DocumentPayload } from "../lib/types";

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
});
