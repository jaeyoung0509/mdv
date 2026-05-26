<script setup lang="ts">
import { invoke } from "@tauri-apps/api/core";
import { Check, KeyRound, Plus, Trash2 } from "@lucide/vue";
import { reactive } from "vue";
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
    <div class="settings-section__title">
      <h3>AI</h3>
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

    <template v-if="settings.providers.length > 0">
      <label class="settings-label" for="ai-active-provider">Provider</label>
      <select
        id="ai-active-provider"
        class="settings-input"
        :value="settings.activeProviderId"
        @change="
          emit('change', {
            ...settings,
            activeProviderId: ($event.currentTarget as HTMLSelectElement).value,
          })
        "
      >
        <option v-for="provider in settings.providers" :key="provider.id" :value="provider.id">
          {{ provider.name }}
        </option>
      </select>
    </template>
    <p v-else class="settings-empty">Add a provider, then paste its host, model, and API key.</p>

    <div class="ai-provider-list">
      <section v-for="provider in settings.providers" :key="provider.id" class="ai-provider-editor">
        <div class="ai-provider-editor__header">
          <select
            class="settings-input"
            :value="provider.kind"
            @change="
              updateProvider(provider.id, {
                kind: ($event.currentTarget as HTMLSelectElement).value as AiProviderKind,
              })
            "
          >
            <option value="openaiCompatible">OpenAI-compatible</option>
            <option value="claude">Claude</option>
          </select>
          <button
            type="button"
            class="icon-button"
            title="Delete provider"
            @click="deleteProvider(provider.id)"
          >
            <Trash2 :size="14" aria-hidden="true" />
          </button>
        </div>

        <label class="settings-label" :for="`${provider.id}-name`">Display name</label>
        <input
          :id="`${provider.id}-name`"
          class="settings-input"
          :value="provider.name"
          @input="
            updateProvider(provider.id, {
              name: ($event.currentTarget as HTMLInputElement).value,
            })
          "
        />

        <label class="settings-label" :for="`${provider.id}-base`">Base URL</label>
        <input
          :id="`${provider.id}-base`"
          class="settings-input"
          :value="provider.baseUrl"
          @input="
            updateProvider(provider.id, {
              baseUrl: ($event.currentTarget as HTMLInputElement).value,
            })
          "
        />

        <label class="settings-label" :for="`${provider.id}-model`">Model</label>
        <input
          :id="`${provider.id}-model`"
          class="settings-input"
          :value="provider.model"
          @input="
            updateProvider(provider.id, {
              model: ($event.currentTarget as HTMLInputElement).value,
            })
          "
        />

        <label class="settings-label" :for="`${provider.id}-reasoning`">Reasoning</label>
        <input
          :id="`${provider.id}-reasoning`"
          class="settings-input"
          :value="provider.reasoning"
          placeholder="Optional; OpenAI effort or Claude token budget"
          @input="
            updateProvider(provider.id, {
              reasoning: ($event.currentTarget as HTMLInputElement).value,
            })
          "
        />

        <label class="settings-label" :for="`${provider.id}-key`">
          API key
          <Check v-if="provider.hasApiKey" :size="13" aria-hidden="true" />
        </label>
        <div class="api-key-row">
          <input
            :id="`${provider.id}-key`"
            class="settings-input"
            type="password"
            :value="provider.apiKey"
            :placeholder="provider.hasApiKey ? 'Stored in settings JSON' : 'Paste API key'"
            @input="
              updateProvider(provider.id, {
                apiKey: ($event.currentTarget as HTMLInputElement).value,
                hasApiKey: Boolean(($event.currentTarget as HTMLInputElement).value.trim()),
              })
            "
          />
          <button
            type="button"
            class="icon-button"
            title="Save API key to settings JSON"
            @click="saveApiKey(provider.id)"
          >
            <KeyRound :size="14" aria-hidden="true" />
          </button>
        </div>

        <div class="ai-provider-editor__footer">
          <button type="button" class="secondary-button" @click="testProvider(provider.id)">
            Test
          </button>
          <span v-if="status[provider.id]" :title="status[provider.id]">
            {{ status[provider.id] }}
          </span>
        </div>
      </section>
    </div>
  </section>
</template>
