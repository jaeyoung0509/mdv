<script setup lang="ts">
import {
  AlertCircle,
  ArrowUp,
  Bot,
  FileText,
  MessageSquareQuote,
  Sparkles,
  Square,
  Trash2,
  X,
} from "@lucide/vue";
import { computed, ref, watch, type Component } from "vue";
import MarkdownHtml from "./MarkdownHtml.vue";
import type { AiContextItem, AiProvider, AiSettings } from "../lib/types";

const TEXT_CONTEXT_LIMIT = 40 * 1024;

const props = defineProps<{
  answer: string;
  contextItems: AiContextItem[];
  currentDocumentLabel?: string;
  error: string | null;
  open: boolean;
  settings: AiSettings;
  status: "idle" | "streaming" | "error";
}>();

const emit = defineEmits<{
  cancel: [];
  close: [];
  contextAdd: [items: AiContextItem[]];
  contextRemove: [index: number];
  providerChange: [providerId: string];
  send: [prompt: string];
}>();

const draftPrompt = ref("");

const contextIcons: Record<AiContextItem["kind"], Component> = {
  file: FileText,
  selection: MessageSquareQuote,
  documentExcerpt: Bot,
};

const provider = computed<AiProvider | undefined>(
  () =>
    props.settings.providers.find((item) => item.id === props.settings.activeProviderId) ??
    props.settings.providers[0],
);
const trimmedPrompt = computed(() => draftPrompt.value.trim());
const canSend = computed(() =>
  Boolean(
    provider.value?.baseUrl &&
      provider.value.model &&
      trimmedPrompt.value &&
      props.status !== "streaming",
  ),
);
const contextCount = computed(
  () => props.contextItems.length + (props.currentDocumentLabel ? 1 : 0),
);

watch(
  () => props.open,
  (open) => {
    if (!open) {
      draftPrompt.value = "";
    }
  },
);

function truncateText(value: string): string {
  if (value.length <= TEXT_CONTEXT_LIMIT) {
    return value;
  }

  const head = value.slice(0, TEXT_CONTEXT_LIMIT / 2);
  const tail = value.slice(-TEXT_CONTEXT_LIMIT / 4);
  return `${head}\n\n[truncated: context item exceeded 40KB]\n\n${tail}`;
}

function isTextContextFile(fileName: string): boolean {
  return /\.(md|markdown|txt)$/i.test(fileName);
}

async function handleDrop(event: DragEvent) {
  event.preventDefault();
  event.stopPropagation();

  const text = event.dataTransfer?.getData("text/plain") ?? "";
  const files = Array.from(event.dataTransfer?.files ?? []);
  const nextItems: AiContextItem[] = [];

  if (text.trim()) {
    nextItems.push({
      kind: "selection",
      label: "Dropped text",
      text: truncateText(text.trim()),
    });
  }

  for (const file of files) {
    if (!isTextContextFile(file.name)) {
      nextItems.push({
        kind: "file",
        label: file.name,
        text: "Unsupported file type. Only .md, .markdown, and .txt are accepted.",
      });
      continue;
    }

    nextItems.push({
      kind: "file",
      label: file.name,
      text: truncateText(await file.text()),
    });
  }

  if (nextItems.length > 0) {
    emit("contextAdd", nextItems);
  }
}

function sendPrompt() {
  if (canSend.value) {
    const prompt = trimmedPrompt.value;
    draftPrompt.value = "";
    emit("send", prompt);
  }
}

function handlePromptKeyDown(event: KeyboardEvent) {
  if (event.key !== "Enter" || event.shiftKey || event.isComposing) {
    return;
  }

  event.preventDefault();
  sendPrompt();
}
</script>

<template>
  <aside
    v-if="open"
    class="ai-panel"
    aria-label="AI chat"
    @drop="handleDrop"
    @dragover.prevent
  >
    <div class="ai-panel__header">
      <div class="ai-panel__title">
        <Sparkles :size="16" aria-hidden="true" />
        <h2>Ask AI</h2>
      </div>
      <div class="ai-panel__header-actions">
        <select
          v-if="settings.providers.length > 0"
          id="ai-provider"
          class="ai-provider-select"
          aria-label="AI provider"
          :value="provider?.id || ''"
          @change="emit('providerChange', ($event.currentTarget as HTMLSelectElement).value)"
        >
          <option v-for="item in settings.providers" :key="item.id" :value="item.id">
            {{ item.name }} · {{ item.model || "no model" }}
          </option>
        </select>
        <button type="button" class="icon-button" title="Close AI panel" @click="emit('close')">
          <X :size="16" aria-hidden="true" />
        </button>
      </div>
    </div>

    <div class="ai-panel__conversation">
      <section
        v-if="!answer && status !== 'streaming' && !error"
        class="ai-empty-state"
        aria-label="AI suggestions"
      >
        <div class="ai-avatar">
          <Sparkles :size="24" aria-hidden="true" />
        </div>
        <h3>Ask AI</h3>
        <div class="ai-suggestion-list">
          <button type="button" @click="draftPrompt = 'Summarize this document.'">
            <Sparkles :size="14" aria-hidden="true" />
            Summarize this document
          </button>
          <button type="button" @click="draftPrompt = 'Translate this page to Korean.'">
            <MessageSquareQuote :size="14" aria-hidden="true" />
            Translate to Korean
          </button>
          <button type="button" @click="draftPrompt = 'List the key decisions and trade-offs.'">
            <Bot :size="14" aria-hidden="true" />
            Find key trade-offs
          </button>
        </div>
      </section>

      <section v-if="answer" class="ai-answer mdv-markdown markdown-body" aria-live="polite">
        <MarkdownHtml :content="answer" />
      </section>

      <div
        v-if="status === 'streaming' && !answer"
        class="ai-thinking"
        role="status"
        aria-live="polite"
      >
        <div class="ai-thinking__orb" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <div class="ai-thinking__copy">
          <strong>Thinking</strong>
          <span>Reading context and drafting a response</span>
          <div class="ai-thinking__meter" aria-hidden="true">
            <span />
          </div>
        </div>
      </div>

      <div v-if="error" class="ai-error" role="alert">
        <AlertCircle :size="15" aria-hidden="true" />
        <span>{{ error }}</span>
      </div>
    </div>

    <form class="ai-composer" @submit.prevent="sendPrompt">
      <div
        v-if="contextCount > 0"
        class="ai-context-list ai-context-list--composer"
        aria-label="AI context"
      >
        <div v-if="currentDocumentLabel" class="ai-context-chip">
          <Bot :size="13" aria-hidden="true" />
          <span :title="currentDocumentLabel">{{ currentDocumentLabel }}</span>
        </div>
        <div
          v-for="(item, index) in contextItems"
          :key="`${item.kind}-${item.label}-${index}`"
          class="ai-context-chip"
        >
          <component :is="contextIcons[item.kind]" :size="13" aria-hidden="true" />
          <span :title="item.label">{{ item.label }}</span>
          <button
            type="button"
            class="icon-button"
            title="Remove context"
            @click="emit('contextRemove', index)"
          >
            <Trash2 :size="12" aria-hidden="true" />
          </button>
        </div>
      </div>

      <textarea
        id="ai-prompt"
        v-model="draftPrompt"
        class="ai-prompt"
        aria-label="Ask AI"
        placeholder="Ask AI anything..."
        @keydown="handlePromptKeyDown"
      />

      <div class="ai-composer__footer">
        <span v-if="settings.providers.length > 0" class="ai-mode-pill">Auto</span>
        <span v-else class="ai-provider-warning">Add an AI provider in Settings first.</span>
        <div class="ai-composer__actions">
          <button
            type="button"
            class="ai-cancel-button"
            title="Cancel response"
            :disabled="status !== 'streaming'"
            @click="emit('cancel')"
          >
            <Square :size="13" aria-hidden="true" />
          </button>
          <button type="submit" class="ai-send-button" title="Send" :disabled="!canSend">
            <ArrowUp :size="17" aria-hidden="true" />
          </button>
        </div>
      </div>
    </form>
  </aside>
</template>
