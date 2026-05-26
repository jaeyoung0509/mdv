import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/vue";
import userEvent from "@testing-library/user-event";
import { createPinia } from "pinia";
import { defineComponent, h } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./app.vue";

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

const aiSettings = {
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

const initialDocument = {
  path: "/Users/apple/project/quiz123.md",
  fileName: "quiz123.md",
  directory: "/Users/apple/project",
  content: "# Quiz\n\nA long document body",
  watching: true,
};

const preferences = {
  theme: "light",
  fontPreset: "sans",
  fontSize: 16,
  lineHeight: 1.7,
  contentWidth: 780,
  outlineVisible: false,
  bookmarks: {},
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
  mocks.invoke.mockImplementation(async (command: string) => {
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
});
