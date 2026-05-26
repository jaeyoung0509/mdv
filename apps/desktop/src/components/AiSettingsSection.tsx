import { invoke } from "@tauri-apps/api/core";
import { Check, KeyRound, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import type { AiProvider, AiProviderKind, AiSettings } from "../lib/types";

interface AiSettingsSectionProps {
  settings: AiSettings;
  onChange: (settings: AiSettings) => void;
}

function isTauriRuntime(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

function createProvider(kind: AiProviderKind): AiProvider {
  const createdAt = Date.now();
  const id = `${kind === "claude" ? "claude" : "openai"}-${createdAt}`;

  if (kind === "claude") {
    return {
      id,
      name: id,
      kind,
      baseUrl: "",
      model: "",
      reasoning: "",
      hasApiKey: false,
    };
  }

  return {
    id,
    name: id,
    kind,
    baseUrl: "",
    model: "",
    reasoning: "",
    hasApiKey: false,
  };
}

export function AiSettingsSection({ settings, onChange }: AiSettingsSectionProps) {
  const [apiKeys, setApiKeys] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<Record<string, string>>({});

  const updateProvider = (providerId: string, patch: Partial<AiProvider>) => {
    onChange({
      ...settings,
      providers: settings.providers.map((provider) =>
        provider.id === providerId ? { ...provider, ...patch } : provider,
      ),
    });
  };

  const addProvider = (kind: AiProviderKind) => {
    const provider = createProvider(kind);

    onChange({
      activeProviderId: provider.id,
      providers: [...settings.providers, provider],
    });
  };

  const deleteProvider = async (providerId: string) => {
    const nextProviders = settings.providers.filter((provider) => provider.id !== providerId);
    const nextSettings = {
      activeProviderId:
        settings.activeProviderId === providerId
          ? nextProviders[0]?.id || ""
          : settings.activeProviderId,
      providers: nextProviders,
    };

    onChange(nextSettings);

    if (isTauriRuntime()) {
      try {
        const remoteSettings = await invoke<AiSettings>("delete_ai_provider", { providerId });
        onChange(remoteSettings);
      } catch {
        setStatus((current) => ({ ...current, [providerId]: "Could not delete keychain entry" }));
      }
    }
  };

  const saveApiKey = async (providerId: string) => {
    if (!isTauriRuntime()) {
      setStatus((current) => ({ ...current, [providerId]: "Desktop app required" }));
      return;
    }

    try {
      const provider = settings.providers.find((item) => item.id === providerId);

      if (provider) {
        await invoke<AiSettings>("save_ai_provider", { provider });
      }

      const remoteSettings = await invoke<AiSettings>("set_ai_api_key", {
        providerId,
        apiKey: apiKeys[providerId] || "",
      });
      setApiKeys((current) => ({ ...current, [providerId]: "" }));
      setStatus((current) => ({ ...current, [providerId]: "Saved" }));
      onChange(remoteSettings);
    } catch (error) {
      setStatus((current) => ({
        ...current,
        [providerId]: error instanceof Error ? error.message : String(error),
      }));
    }
  };

  const testProvider = async (providerId: string) => {
    if (!isTauriRuntime()) {
      setStatus((current) => ({ ...current, [providerId]: "Desktop app required" }));
      return;
    }

    setStatus((current) => ({ ...current, [providerId]: "Testing..." }));

    try {
      const provider = settings.providers.find((item) => item.id === providerId);

      if (provider) {
        await invoke<AiSettings>("save_ai_provider", { provider });
      }

      await invoke("test_ai_provider", { providerId });
      setStatus((current) => ({ ...current, [providerId]: "Connected" }));
    } catch (error) {
      setStatus((current) => ({
        ...current,
        [providerId]: error instanceof Error ? error.message : String(error),
      }));
    }
  };

  return (
    <section className="settings-section ai-settings" aria-label="AI settings">
      <div className="settings-section__title">
        <h3>AI</h3>
        <div className="settings-actions">
          <button
            type="button"
            className="secondary-button secondary-button--compact"
            title="Add OpenAI-compatible provider"
            onClick={() => addProvider("openaiCompatible")}
          >
            <Plus size={14} aria-hidden="true" />
            OpenAI
          </button>
          <button
            type="button"
            className="secondary-button secondary-button--compact"
            title="Add Claude-compatible provider"
            onClick={() => addProvider("claude")}
          >
            <Plus size={14} aria-hidden="true" />
            Claude
          </button>
        </div>
      </div>

      {settings.providers.length > 0 ? (
        <>
          <label className="settings-label" htmlFor="ai-active-provider">
            Provider
          </label>
          <select
            id="ai-active-provider"
            className="settings-input"
            value={settings.activeProviderId}
            onChange={(event) =>
              onChange({ ...settings, activeProviderId: event.currentTarget.value })
            }
          >
            {settings.providers.map((provider) => (
              <option key={provider.id} value={provider.id}>
                {provider.name}
              </option>
            ))}
          </select>
        </>
      ) : (
        <p className="settings-empty">Add a provider, then paste its host, model, and API key.</p>
      )}

      <div className="ai-provider-list">
        {settings.providers.map((provider) => (
          <section key={provider.id} className="ai-provider-editor">
            <div className="ai-provider-editor__header">
              <select
                className="settings-input"
                value={provider.kind}
                onChange={(event) =>
                  updateProvider(provider.id, {
                    kind: event.currentTarget.value as AiProviderKind,
                  })
                }
              >
                <option value="openaiCompatible">OpenAI-compatible</option>
                <option value="claude">Claude</option>
              </select>
              <button
                type="button"
                className="icon-button"
                title="Delete provider"
                onClick={() => void deleteProvider(provider.id)}
              >
                <Trash2 size={14} aria-hidden="true" />
              </button>
            </div>

            <label className="settings-label" htmlFor={`${provider.id}-name`}>
              Display name
            </label>
            <input
              id={`${provider.id}-name`}
              className="settings-input"
              value={provider.name}
              onChange={(event) => updateProvider(provider.id, { name: event.currentTarget.value })}
            />

            <label className="settings-label" htmlFor={`${provider.id}-base`}>
              Base URL
            </label>
            <input
              id={`${provider.id}-base`}
              className="settings-input"
              value={provider.baseUrl}
              onChange={(event) =>
                updateProvider(provider.id, { baseUrl: event.currentTarget.value })
              }
            />

            <label className="settings-label" htmlFor={`${provider.id}-model`}>
              Model
            </label>
            <input
              id={`${provider.id}-model`}
              className="settings-input"
              value={provider.model}
              onChange={(event) => updateProvider(provider.id, { model: event.currentTarget.value })}
            />

            <label className="settings-label" htmlFor={`${provider.id}-reasoning`}>
              Reasoning
            </label>
            <input
              id={`${provider.id}-reasoning`}
              className="settings-input"
              value={provider.reasoning}
              placeholder="Optional; OpenAI effort or Claude token budget"
              onChange={(event) =>
                updateProvider(provider.id, { reasoning: event.currentTarget.value })
              }
            />

            <label className="settings-label" htmlFor={`${provider.id}-key`}>
              API key {provider.hasApiKey ? <Check size={13} aria-hidden="true" /> : null}
            </label>
            <div className="api-key-row">
              <input
                id={`${provider.id}-key`}
                className="settings-input"
                type="password"
                value={apiKeys[provider.id] || ""}
                placeholder={provider.hasApiKey ? "Stored in keychain" : "Paste API key"}
                onChange={(event) =>
                  setApiKeys((current) => ({
                    ...current,
                    [provider.id]: event.currentTarget.value,
                  }))
                }
              />
              <button
                type="button"
                className="icon-button"
                title="Save API key"
                onClick={() => void saveApiKey(provider.id)}
              >
                <KeyRound size={14} aria-hidden="true" />
              </button>
            </div>

            <div className="ai-provider-editor__footer">
              <button
                type="button"
                className="secondary-button"
                onClick={() => void testProvider(provider.id)}
              >
                Test
              </button>
              {status[provider.id] ? <span>{status[provider.id]}</span> : null}
            </div>
          </section>
        ))}
      </div>
    </section>
  );
}
