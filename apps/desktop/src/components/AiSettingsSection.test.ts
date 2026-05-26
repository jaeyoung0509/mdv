import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/vue";
import userEvent from "@testing-library/user-event";
import { defineComponent, h, ref } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AiSettingsSection from "./AiSettingsSection.vue";
import type { AiSettings } from "../lib/types";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
}));

const settings: AiSettings = {
  activeProviderId: "provider-1",
  providers: [
    {
      id: "provider-1",
      name: "Opencode",
      kind: "openaiCompatible",
      baseUrl: "https://opencode.ai/zen/go/v1",
      model: "deepseek-v4-flash",
      reasoning: "Max",
      apiKey: "",
      hasApiKey: false,
    },
  ],
};

function renderAiSettingsSection(initialSettings = settings) {
  const onChange = vi.fn();
  const Harness = defineComponent({
    setup() {
      const currentSettings = ref(initialSettings);

      return () =>
        h(AiSettingsSection, {
          settings: currentSettings.value,
          onChange(nextSettings: AiSettings) {
            onChange(nextSettings);
            currentSettings.value = nextSettings;
          },
        });
    },
  });

  render(Harness);

  return onChange;
}

beforeEach(() => {
  Object.defineProperty(window, "__TAURI_INTERNALS__", {
    configurable: true,
    value: {},
  });
  mocks.invoke.mockReset();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  delete (window as typeof window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
});

describe("AiSettingsSection", () => {
  it("saves a typed API key before testing the provider", async () => {
    const user = userEvent.setup();

    mocks.invoke.mockImplementation(async (command: string, args: unknown) => {
      if (command === "save_ai_provider") {
        return {
          ...settings,
          providers: [(args as { provider: AiSettings["providers"][number] }).provider],
        };
      }

      return null;
    });

    const onChange = renderAiSettingsSection();

    await user.type(screen.getByLabelText(/API key/), "sk-test");
    await user.click(screen.getByRole("button", { name: "Test" }));

    expect(mocks.invoke.mock.calls.map(([command]) => command)).toEqual([
      "save_ai_provider",
      "test_ai_provider",
    ]);
    expect(mocks.invoke).toHaveBeenCalledWith("save_ai_provider", {
      provider: expect.objectContaining({
        id: "provider-1",
        apiKey: "sk-test",
        hasApiKey: true,
      }),
    });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        providers: [
          expect.objectContaining({
            apiKey: "sk-test",
            hasApiKey: true,
          }),
        ],
      }),
    );
    expect(await screen.findByText("Connected")).toBeInTheDocument();
  });

  it("renders Tauri object errors as readable test status", async () => {
    const user = userEvent.setup();

    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === "save_ai_provider") {
        return settings;
      }

      if (command === "test_ai_provider") {
        throw {
          kind: "AiProviderError",
          message: "AI provider test failed.",
          details: "HTTP 400 Bad Request: invalid reasoning_effort",
        };
      }

      return null;
    });

    renderAiSettingsSection();

    await user.click(screen.getByRole("button", { name: "Test" }));

    expect(await screen.findByText(/AI provider test failed\./)).toBeInTheDocument();
    expect(screen.getByText(/HTTP 400 Bad Request/)).toBeInTheDocument();
    expect(screen.queryByText("[object Object]")).not.toBeInTheDocument();
  });
});
