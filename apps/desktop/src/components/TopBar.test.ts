import "@testing-library/jest-dom/vitest";
import { render, screen, within } from "@testing-library/vue";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import TopBar from "./TopBar.vue";
import type { DirectoryDocument, DocumentPayload } from "../lib/types";

const currentDocument: DocumentPayload = {
  path: "/Users/apple/project/quiz123.md",
  fileName: "quiz123.md",
  directory: "/Users/apple/project",
  content: "# Quiz",
  watching: true,
  modifiedMillis: 10,
};

const directoryDocuments: DirectoryDocument[] = [
  {
    path: currentDocument.path,
    fileName: currentDocument.fileName,
    directory: currentDocument.directory,
  },
  {
    path: "/Users/apple/project/notes.md",
    fileName: "notes.md",
    directory: currentDocument.directory,
  },
];

function renderTopBar(overrides: Partial<InstanceType<typeof TopBar>["$props"]> = {}) {
  const props = {
    document: currentDocument,
    watch: true,
    outlineVisible: false,
    opening: false,
    aiPanelOpen: false,
    findOpen: false,
    directoryDocuments,
    editorMode: "read" as const,
    saveStatus: "idle" as const,
    wordCount: 0,
    selectedWordCount: 0,
    ...overrides,
  };
  const handlers = {
    onBookmarkAdd: vi.fn(),
    onAiToggle: vi.fn(),
    onDocumentOpen: vi.fn(),
    onEditorModeChange: vi.fn(),
    onFindToggle: vi.fn(),
    onOpenFile: vi.fn(),
    onOutlineToggle: vi.fn(),
    onSave: vi.fn(),
    onSettingsToggle: vi.fn(),
  };

  render(TopBar, {
    props: {
      ...props,
      ...handlers,
    },
  });

  return handlers;
}

describe("TopBar document switcher", () => {
  it("opens sibling Markdown files from the file title menu", async () => {
    const user = userEvent.setup();
    const handlers = renderTopBar();

    await user.click(screen.getByRole("button", { name: "Open document switcher" }));

    const menu = screen.getByRole("menu");
    expect(within(menu).getByText(currentDocument.directory)).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: "quiz123.md" })).toHaveAttribute(
      "aria-current",
      "page",
    );

    await user.click(within(menu).getByRole("menuitem", { name: "notes.md" }));

    expect(handlers.onDocumentOpen).toHaveBeenCalledWith("/Users/apple/project/notes.md");
  });
});

describe("TopBar writing controls", () => {
  it("switches between read and write modes", async () => {
    const user = userEvent.setup();
    const handlers = renderTopBar();

    await user.click(screen.getByRole("button", { name: "Write" }));

    expect(handlers.onEditorModeChange).toHaveBeenCalledWith("write");
  });

  it("emits save from the save button in write mode", async () => {
    const user = userEvent.setup();
    const handlers = renderTopBar({ editorMode: "write", saveStatus: "dirty" });

    await user.click(screen.getByRole("button", { name: "Save document" }));

    expect(handlers.onSave).toHaveBeenCalled();
  });

  it("shows compact writing save and word status", () => {
    renderTopBar({
      editorMode: "write",
      saveStatus: "dirty",
      wordCount: 12,
      selectedWordCount: 3,
    });

    expect(screen.getByText("Unsaved")).toBeInTheDocument();
    expect(screen.getByText("3 selected / 12 words")).toBeInTheDocument();
  });
});
