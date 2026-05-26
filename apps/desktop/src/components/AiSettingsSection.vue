<script setup lang="ts">
import { invoke } from "@tauri-apps/api/core";
import { Check, KeyRound, Plus, Trash2 } from "@lucide/vue";
import { computed, reactive } from "vue";
import { isTauriRuntime } from "../composables/useTauriRuntime";
import { formatUnknownError } from "../lib/errors";
import type { AiProvider, AiProviderKind, AiSettings } from "../lib/types";

const props = defineProps<{
  settings: AiSettings;
}>();

const emit = defineEmits<{
  change: [settings: AiSettings];
}>();

const status = reactive<Record<string, string>>({});

const activeProvider = computed(
  () =>
    props.settings.providers.find((provider) => provider.id === props.settings.activeProviderId) ??
    props.settings.providers[0],
);

function providerKindLabel(kind: AiProviderKind): string {
  return kind === "claude" ? "Claude" : "OpenAI-compatible";
}

function providerHealthLabel(provider: AiProvider): string {
  if (status[provider.id]) {
    return status[provider.id];
  }

  if (!provider.baseUrl || !provider.model) {
    return "Needs host and model";
  }

  return provider.hasApiKey ? "Ready" : "API key missing";
}

function providerTabStatus(provider: AiProvider): string {
  const message = status[provider.id];

  if (!message) {
    return provider.hasApiKey ? "Ready" : "Setup";
  }

  if (/failed|could not|error|bad request/i.test(message)) {
    return "Error";
  }

  if (/testing/i.test(message)) {
    return "Testing";
  }

  return message;
}

function createProvider(kind: AiProviderKind): AiProvider {
  const createdAt = Date.now();
  const id = `${kind === "claude" ? "claude" : "openai"}-${createdAt}`;

  return {
    id,
    name: id,
    kind,
    baseUrl: "",
    model: "",
    reasoning: "",
    apiKey: "",
    hasApiKey: false,
  };
}

function updateProvider(providerId: string, patch: Partial<AiProvider>) {
  emit("change", {
    ...props.settings,
    providers: props.settings.providers.map((provider) =>
      provider.id === providerId ? { ...provider, ...patch } : provider,
    ),
  });
}

function addProvider(kind: AiProviderKind) {
  const provider = createProvider(kind);

  emit("change", {
    activeProviderId: provider.id,
    providers: [...props.settings.providers, provider],
  });
}

async function saveProviderSettings(providerId: string) {
  const provider = props.settings.providers.find((item) => item.id === providerId);

  if (!provider) {
    return null;
  }

  return invoke<AiSettings>("save_ai_provider", { provider });
}

async function deleteProvider(providerId: string) {
  const nextProviders = props.settings.providers.filter((provider) => provider.id !== providerId);
  const nextSettings = {
    activeProviderId:
      props.settings.activeProviderId === providerId
        ? nextProviders[0]?.id || ""
        : props.settings.activeProviderId,
    providers: nextProviders,
  };

  emit("change", nextSettings);

  if (isTauriRuntime()) {
    try {
      emit("change", await invoke<AiSettings>("delete_ai_provider", { providerId }));
    } catch {
      status[providerId] = "Could not delete provider";
    }
  }
}

async function saveApiKey(providerId: string) {
  if (!isTauriRuntime()) {
    status[providerId] = "Desktop app required";
    return;
  }

  try {
    const remoteSettings = await saveProviderSettings(providerId);
    if (remoteSettings) {
      emit("change", remoteSettings);
    }
    status[providerId] = "Saved to settings JSON";
  } catch (error) {
    status[providerId] = formatUnknownError(error, "Could not save this API key.");
  }
}

async function testProvider(providerId: string) {
  if (!isTauriRuntime()) {
    status[providerId] = "Desktop app required";
    return;
  }

  status[providerId] = "Testing...";

  try {
    const remoteSettings = await saveProviderSettings(providerId);
    if (remoteSettings) {
      emit("change", remoteSettings);
    }
    await invoke("test_ai_provider", { providerId });
    status[providerId] = "Connected";
  } catch (error) {
    status[providerId] = formatUnknownError(error, "AI provider test failed.");
  }
}
</script>

<template>
  <section class="settings-section ai-settings" aria-label="AI settings">
    <div class="settings-section__title ai-settings__title">
      <div>
        <h3>AI</h3>
        <p>Manage providers used by Ask AI.</p>
      </div>
      <div class="settings-actions">
        <button
          type="button"
          class="secondary-button secondary-button--compact"
          title="Add OpenAI-compatible provider"
          @click="addProvider('openaiCompatible')"
        >
          <Plus :size="14" aria-hidden="true" />
          OpenAI
        </button>
        <button
          type="button"
          class="secondary-button secondary-button--compact"
          title="Add Claude-compatible provider"
          @click="addProvider('claude')"
        >
          <Plus :size="14" aria-hidden="true" />
          Claude
        </button>
      </div>
    </div>

    <template v-if="settings.providers.length > 0 && activeProvider">
      <div class="ai-provider-tabs" aria-label="AI providers">
        <button
          v-for="provider in settings.providers"
          :key="provider.id"
          type="button"
          class="ai-provider-tab"
          :aria-pressed="provider.id === activeProvider.id"
          @click="emit('change', { ...settings, activeProviderId: provider.id })"
        >
          <span>{{ provider.name || "Unnamed provider" }}</span>
          <small>{{ provider.model || providerKindLabel(provider.kind) }}</small>
          <em>{{ providerTabStatus(provider) }}</em>
        </button>
      </div>

      <section class="ai-provider-editor ai-provider-editor--active">
        <div class="ai-provider-editor__header">
          <div>
            <p class="settings-kicker">Active provider</p>
            <h4>{{ activeProvider.name || "Unnamed provider" }}</h4>
          </div>
          <button
            type="button"
            class="icon-button"
            title="Delete provider"
            @click="deleteProvider(activeProvider.id)"
          >
            <Trash2 :size="14" aria-hidden="true" />
          </button>
        </div>

        <label class="settings-label" :for="`${activeProvider.id}-kind`">Provider type</label>
        <select
          :id="`${activeProvider.id}-kind`"
          class="settings-input"
          :value="activeProvider.kind"
          @change="
            updateProvider(activeProvider.id, {
              kind: ($event.currentTarget as HTMLSelectElement).value as AiProviderKind,
            })
          "
        >
          <option value="openaiCompatible">OpenAI-compatible</option>
          <option value="claude">Claude</option>
        </select>

        <div class="ai-provider-field-grid">
          <label>
            <span class="settings-label">Display name</span>
            <input
              :id="`${activeProvider.id}-name`"
              class="settings-input"
              :value="activeProvider.name"
              placeholder="Opencode"
              @input="
                updateProvider(activeProvider.id, {
                  name: ($event.currentTarget as HTMLInputElement).value,
                })
              "
            />
          </label>

          <label>
            <span class="settings-label">Model</span>
            <input
              :id="`${activeProvider.id}-model`"
              class="settings-input"
              :value="activeProvider.model"
              placeholder="deepseek-v4-flash"
              @input="
                updateProvider(activeProvider.id, {
                  model: ($event.currentTarget as HTMLInputElement).value,
                })
              "
            />
          </label>
        </div>

        <label>
          <span class="settings-label">Base URL</span>
          <input
            :id="`${activeProvider.id}-base`"
            class="settings-input"
            :value="activeProvider.baseUrl"
            placeholder="https://example.com/v1"
            @input="
              updateProvider(activeProvider.id, {
                baseUrl: ($event.currentTarget as HTMLInputElement).value,
              })
            "
          />
        </label>

        <label>
          <span class="settings-label">Reasoning</span>
          <input
            :id="`${activeProvider.id}-reasoning`"
            class="settings-input"
            :value="activeProvider.reasoning"
            placeholder="Optional; OpenAI effort or Claude token budget"
            @input="
              updateProvider(activeProvider.id, {
                reasoning: ($event.currentTarget as HTMLInputElement).value,
              })
            "
          />
        </label>

        <label>
          <span class="settings-label">
            API key
            <Check v-if="activeProvider.hasApiKey" :size="13" aria-hidden="true" />
          </span>
          <div class="api-key-row">
            <input
              :id="`${activeProvider.id}-key`"
              class="settings-input"
              type="password"
              :value="activeProvider.apiKey"
              :placeholder="activeProvider.hasApiKey ? 'Stored in settings JSON' : 'Paste API key'"
              @input="
                updateProvider(activeProvider.id, {
                  apiKey: ($event.currentTarget as HTMLInputElement).value,
                  hasApiKey: Boolean(($event.currentTarget as HTMLInputElement).value.trim()),
                })
              "
            />
            <button
              type="button"
              class="secondary-button secondary-button--compact"
              title="Save API key to settings JSON"
              @click="saveApiKey(activeProvider.id)"
            >
              <KeyRound :size="14" aria-hidden="true" />
              Save key
            </button>
          </div>
        </label>

        <div class="ai-provider-editor__footer">
          <span class="ai-provider-status" :title="providerHealthLabel(activeProvider)">
            Status: {{ providerHealthLabel(activeProvider) }}
          </span>
          <button
            type="button"
            class="secondary-button"
            @click="testProvider(activeProvider.id)"
          >
            Test
          </button>
        </div>
      </section>
    </template>
    <p v-else class="settings-empty">Add a provider, then paste its host, model, and API key.</p>
  </section>
</template>
