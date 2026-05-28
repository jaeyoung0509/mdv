import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/vue";
import userEvent from "@testing-library/user-event";
import { createPinia, setActivePinia } from "pinia";
import { defineComponent, h } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./app.vue";
import type { AiSettings, DocumentPayload, ReaderPreferences } from "./lib/types";
import { useAppStore } from "./stores/app";
import { AUTOSAVE_DELAY_MS } from "./stores/slices/writing";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(),
  onDragDropEvent: vi.fn(),
  markdownRenderCount: { value: 0 },
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: mocks.listen,
}));

vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({
    onDragDropEvent: mocks.onDragDropEvent,
  }),
}));

vi.mock("./components/MarkdownView.vue", () => ({
  default: defineComponent({
    name: "MarkdownView",
    setup() {
      mocks.markdownRenderCount.value += 1;
      return () => h("article", { "data-testid": "markdown-view" }, "Rendered Markdown");
    },
  }),
}));

vi.mock("./components/MarkdownEditor.vue", () => ({
  __esModule: true,
  default: defineComponent({
    name: "MarkdownEditor",
    props: {
      content: {
        type: String,
        required: true,
      },
      error: {
        type: String,
        default: null,
      },
      saveStatus: {
        type: String,
        required: true,
      },
      surfaceMode: {
        type: String,
        required: true,
      },
      aiNotes: {
        type: Array,
        default: () => [],
      },
    },
    emits: [
      "aiNoteSelect",
      "contentChange",
      "overwrite",
      "reload",
      "save",
      "selectionChange",
      "surfaceModeChange",
    ],
    setup(props, { emit }) {
      return () =>
        h("section", { "aria-label": "Markdown editor" }, [
          h(
            "button",
            {
              type: "button",
              onClick: () => emit("surfaceModeChange", "live"),
            },
            "Live",
          ),
          h(
            "button",
            {
              type: "button",
              onClick: () => emit("surfaceModeChange", "source"),
            },
            "Source",
          ),
          h("textarea", {
            "aria-label": "Markdown editor",
            value: props.content,
            onInput: (event: Event) => {
              emit("contentChange", (event.target as HTMLTextAreaElement).value);
            },
          }),
          h("span", { "data-testid": "save-status" }, props.saveStatus),
          h("span", { "data-testid": "surface-mode" }, props.surfaceMode),
          props.error ? h("span", { role: "alert" }, props.error) : null,
          h(
            "button",
            {
              type: "button",
              onClick: () => emit("save"),
            },
            "Save",
          ),
          h(
            "button",
            {
              type: "button",
              onClick: () => emit("reload"),
            },
            "Reload",
          ),
          h(
            "button",
            {
              type: "button",
              onClick: () => emit("overwrite"),
            },
            "Overwrite",
          ),
        ]);
    },
  }),
}));

const aiSettings: AiSettings = {
  activeProviderId: "provider-1",
  providers: [
    {
      id: "provider-1",
      name: "Provider",
      kind: "openaiCompatible",
      baseUrl: "https://example.test/v1",
      model: "test-model",
      reasoning: "",
      apiKey: "sk-test",
      hasApiKey: true,
    },
  ],
};

const initialDocument: DocumentPayload = {
  path: "/Users/apple/project/quiz123.md",
  fileName: "quiz123.md",
  directory: "/Users/apple/project",
  content: "# Quiz\n\nA long document body",
  watching: true,
  modifiedMillis: 10,
};

const preferences: ReaderPreferences = {
  theme: "light",
  fontPreset: "sans",
  fontSize: 16,
  lineHeight: 1.7,
  contentWidth: 780,
  outlineVisible: false,
  bookmarks: {},
  aiNotes: {},
  ai: aiSettings,
};

function renderApp() {
  return render(App, {
    global: {
      plugins: [createPinia()],
    },
  });
}

beforeEach(() => {
  Object.defineProperty(window, "__TAURI_INTERNALS__", {
    configurable: true,
    value: {},
  });
  window.scrollTo = vi.fn();
  window.matchMedia = vi.fn().mockReturnValue({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  window.requestAnimationFrame = (callback: FrameRequestCallback) => {
    callback(0);
    return 0;
  };

  mocks.markdownRenderCount.value = 0;
  mocks.listen.mockReset();
  mocks.listen.mockResolvedValue(() => undefined);
  mocks.onDragDropEvent.mockReset();
  mocks.onDragDropEvent.mockResolvedValue(() => undefined);
  mocks.invoke.mockReset();
  mocks.invoke.mockImplementation(async (command: string, args?: Record<string, unknown>) => {
    if (command === "get_initial_state") {
      return {
        preferences,
        watch: true,
        allowHtml: false,
        document: initialDocument,
        error: null,
      };
    }

    if (command === "get_ai_settings") {
      return aiSettings;
    }

    if (command === "list_directory_documents") {
      return [
        {
          path: initialDocument.path,
          fileName: initialDocument.fileName,
          directory: initialDocument.directory,
        },
        {
          path: "/Users/apple/project/notes.md",
          fileName: "notes.md",
          directory: initialDocument.directory,
        },
      ];
    }

    if (command === "start_ai_chat") {
      return "run-1";
    }

    if (command === "save_document") {
      return {
        ...initialDocument,
        content: String(args?.content ?? initialDocument.content),
        modifiedMillis: 20,
      };
    }

    if (command === "import_document_asset") {
      return "assets/dropped.png";
    }

    return null;
  });
});

afterEach(() => {
  cleanup();
  delete (window as typeof window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  vi.clearAllMocks();
});

describe("App AI prompt performance", () => {
  it("does not re-render the markdown document while typing in the AI prompt", async () => {
    const user = userEvent.setup();

    renderApp();

    await screen.findByTestId("markdown-view");
    await waitFor(() => {
      expect(mocks.invoke.mock.calls.map(([command]) => command)).toEqual(
        expect.arrayContaining([
          "get_initial_state",
          "get_ai_settings",
          "list_directory_documents",
        ]),
      );
    });

    await user.click(screen.getByRole("button", { name: "Ask AI" }));
    const renderCountAfterOpeningAi = mocks.markdownRenderCount.value;

    await user.type(screen.getByRole("textbox", { name: "Ask AI" }), "hello world");

    expect(mocks.markdownRenderCount.value).toBe(renderCountAfterOpeningAi);
  });

  it("toggles the AI panel from the top bar button", async () => {
    const user = userEvent.setup();

    renderApp();

    await screen.findByTestId("markdown-view");
    const aiButton = screen.getByRole("button", { name: "Ask AI" });

    expect(screen.queryByRole("complementary", { name: "AI chat" })).not.toBeInTheDocument();

    await user.click(aiButton);
    expect(screen.getByRole("complementary", { name: "AI chat" })).toBeInTheDocument();

    await user.click(aiButton);
    expect(screen.queryByRole("complementary", { name: "AI chat" })).not.toBeInTheDocument();
  });

  it("clears the AI prompt after sending with Enter", async () => {
    const user = userEvent.setup();

    renderApp();

    await screen.findByTestId("markdown-view");
    await user.click(screen.getByRole("button", { name: "Ask AI" }));

    const prompt = screen.getByRole("textbox", { name: "Ask AI" });
    await user.type(prompt, "summarize this{Enter}");

    await waitFor(() => {
      expect(prompt).toHaveValue("");
    });
    expect(mocks.invoke).toHaveBeenCalledWith("start_ai_chat", {
      request: expect.objectContaining({
        prompt: "summarize this",
      }),
    });
  });

  it("closes open panels with Escape", async () => {
    const user = userEvent.setup();

    renderApp();

    await screen.findByTestId("markdown-view");

    await user.click(screen.getByRole("button", { name: "Ask AI" }));
    expect(screen.getByRole("complementary", { name: "AI chat" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("complementary", { name: "AI chat" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Open settings" }));
    expect(screen.getByRole("complementary", { name: "Settings" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("complementary", { name: "Settings" })).not.toBeInTheDocument();
  });

  it("switches into writing mode from the top bar", async () => {
    const user = userEvent.setup();

    renderApp();

    await screen.findByTestId("markdown-view");
    await user.click(screen.getByRole("button", { name: "Write" }));

    expect(await screen.findByRole("textbox", { name: "Markdown editor" })).toHaveValue(
      initialDocument.content,
    );
  });

  it("saves edited Markdown manually", async () => {
    const user = userEvent.setup();

    renderApp();

    await screen.findByTestId("markdown-view");
    await user.click(screen.getByRole("button", { name: "Write" }));
    const editor = await screen.findByRole("textbox", { name: "Markdown editor" });

    await user.clear(editor);
    await user.type(editor, "# Updated");
    await user.click(screen.getByRole("button", { name: "Save document" }));

    await waitFor(() => {
      expect(mocks.invoke).toHaveBeenCalledWith("save_document", {
        content: "# Updated",
        expectedModifiedMillis: 10,
        force: false,
      });
    });
  });

  it("keeps the same draft while switching between live and source writing surfaces", async () => {
    const user = userEvent.setup();

    renderApp();

    await screen.findByTestId("markdown-view");
    await user.click(screen.getByRole("button", { name: "Write" }));
    const editor = await screen.findByRole("textbox", { name: "Markdown editor" });

    await user.clear(editor);
    await user.type(editor, "# Source draft");
    await user.click(screen.getByRole("button", { name: "Source" }));

    expect(screen.getByTestId("surface-mode")).toHaveTextContent("source");
    expect(screen.getByRole("textbox", { name: "Markdown editor" })).toHaveValue(
      "# Source draft",
    );
  });

  it("toggles source mode with Cmd/Ctrl slash while writing", async () => {
    const user = userEvent.setup();

    renderApp();

    await screen.findByTestId("markdown-view");
    await user.click(screen.getByRole("button", { name: "Write" }));

    expect(screen.getByTestId("surface-mode")).toHaveTextContent("live");

    await user.keyboard("{Meta>}/{/Meta}");

    expect(screen.getByTestId("surface-mode")).toHaveTextContent("source");
  });
});

describe("App writing store", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("autosaves dirty content after the debounce window", async () => {
    vi.useFakeTimers();
    setActivePinia(createPinia());
    const store = useAppStore();

    store.document = initialDocument;
    store.resetWritingForDocument(initialDocument);
    store.setEditorMode("write");
    store.updateDraftContent("# Autosaved");

    expect(mocks.invoke).not.toHaveBeenCalledWith("save_document", expect.anything());

    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);

    expect(mocks.invoke).toHaveBeenCalledWith("save_document", {
      content: "# Autosaved",
      expectedModifiedMillis: 10,
      force: false,
    });
  });

  it("pauses autosave and reports a conflict when the file changes while dirty", async () => {
    vi.useFakeTimers();
    setActivePinia(createPinia());
    const store = useAppStore();

    store.document = initialDocument;
    store.resetWritingForDocument(initialDocument);
    store.setEditorMode("write");
    store.updateDraftContent("# Local draft");
    await store.handleExternalDocumentUpdate();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);

    expect(store.saveStatus).toBe("conflict");
    expect(store.saveError).toBe("This file changed on disk after you started editing.");
    expect(mocks.invoke).not.toHaveBeenCalledWith("reload_document");
    expect(mocks.invoke).not.toHaveBeenCalledWith("save_document", expect.anything());
  });

  it("tracks writing surface and selection without changing the draft", () => {
    setActivePinia(createPinia());
    const store = useAppStore();

    store.document = initialDocument;
    store.resetWritingForDocument(initialDocument);
    store.updateDraftContent("# Draft");
    store.setWritingSurfaceMode("source");
    store.updateWritingSelection({
      text: "two words",
      from: 0,
      to: 9,
      fromLine: 1,
      toLine: 1,
    });

    expect(store.writingSurfaceMode).toBe("source");
    expect(store.wordCount).toBe(1);
    expect(store.selectedWordCount).toBe(2);
    expect(store.draftContent).toBe("# Draft");
  });

  it("imports dropped images as relative Markdown while writing", async () => {
    setActivePinia(createPinia());
    const store = useAppStore();

    store.document = initialDocument;
    store.resetWritingForDocument(initialDocument);

    await expect(store.insertImageAsset("/Users/apple/Desktop/dropped.png")).resolves.toBe(true);

    expect(mocks.invoke).toHaveBeenCalledWith("import_document_asset", {
      sourcePath: "/Users/apple/Desktop/dropped.png",
      documentPath: initialDocument.path,
    });
    expect(store.draftContent).toContain("![dropped](assets/dropped.png)");
  });

  it("applies AI writing output to the current draft selection", () => {
    setActivePinia(createPinia());
    const store = useAppStore();

    store.document = initialDocument;
    store.resetWritingForDocument(initialDocument);
    store.setEditorMode("write");
    store.updateWritingSelection({
      text: "# Quiz",
      from: 0,
      to: 6,
      fromLine: 1,
      toLine: 1,
    });
    store.aiAnswer = "# Revised Quiz";

    store.applyAiAnswerToDraft("replace");

    expect(store.draftContent).toBe("# Revised Quiz\n\nA long document body");
    expect(store.saveStatus).toBe("dirty");
  });

  it("stores AI answers as local document notes", () => {
    setActivePinia(createPinia());
    const store = useAppStore();

    store.document = initialDocument;
    store.preferences = preferences;
    store.aiLastPrompt = "Review this section";
    store.aiAnswer = "Looks good, but add an example.";

    store.attachAiAnswerAsNote();

    expect(store.preferences.aiNotes[initialDocument.path]).toHaveLength(1);
    expect(store.preferences.aiNotes[initialDocument.path][0]).toMatchObject({
      title: "Looks good, but add an example.",
      messages: expect.arrayContaining([
        expect.objectContaining({ role: "user", content: "Review this section" }),
        expect.objectContaining({ role: "assistant", content: "Looks good, but add an example." }),
      ]),
    });
  });
});
