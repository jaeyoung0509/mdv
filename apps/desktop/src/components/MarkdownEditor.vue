<script setup lang="ts">
import "@milkdown/crepe/theme/common/reset.css";
import "@milkdown/crepe/theme/common/style.css";
import "@milkdown/crepe/theme/common/prosemirror.css";
import "@milkdown/crepe/theme/common/cursor.css";
import "@milkdown/crepe/theme/common/list-item.css";
import "@milkdown/crepe/theme/common/link-tooltip.css";
import "@milkdown/crepe/theme/common/block-edit.css";
import "@milkdown/crepe/theme/common/toolbar.css";
import "@milkdown/crepe/theme/common/top-bar.css";
import "@milkdown/crepe/theme/common/code-mirror.css";
import "@milkdown/crepe/theme/common/table.css";
import "@milkdown/crepe/theme/common/latex.css";
import "@milkdown/crepe/theme/common/placeholder.css";
import {
  AlertTriangle,
  Code2,
  Eye,
  RefreshCw,
  Upload,
} from "@lucide/vue";
import {
  computed,
  defineAsyncComponent,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from "vue";
import { getReaderStyleProperties } from "../lib/readerSettings";
import type {
  AiNoteThread,
  EffectiveTheme,
  ReaderPreferences,
  SaveStatus,
  WritingSelection,
  WritingSurfaceMode,
} from "../lib/types";
import type { Crepe } from "@milkdown/crepe";

const props = defineProps<{
  aiNotes: AiNoteThread[];
  content: string;
  error: string | null;
  preferences: ReaderPreferences;
  saveStatus: SaveStatus;
  surfaceMode: WritingSurfaceMode;
  theme: EffectiveTheme;
}>();

const emit = defineEmits<{
  aiNoteSelect: [note: AiNoteThread];
  contentChange: [content: string];
  overwrite: [];
  reload: [];
  save: [];
  selectionChange: [selection: WritingSelection];
  surfaceModeChange: [mode: WritingSurfaceMode];
}>();

const MarkdownSourceEditor = defineAsyncComponent(() =>
  import("./MarkdownSourceEditor.vue").then((module) => module.default),
);

const editorRoot = ref<HTMLElement | null>(null);
const ready = ref(false);
let editor: Crepe | null = null;
let applyingExternalContent = false;
let destroyed = false;

const readerStyle = computed(() => getReaderStyleProperties(props.preferences));
const noticeTitle = computed(() =>
  props.saveStatus === "conflict" ? "This file changed on disk." : "Could not save this file.",
);

function setSurfaceMode(mode: WritingSurfaceMode) {
  emit("surfaceModeChange", mode);
}

async function replaceEditorContent(content: string) {
  if (!editor) {
    return;
  }

  const current = editor.getMarkdown();

  if (current === content) {
    return;
  }

  applyingExternalContent = true;
  const { replaceAll } = await import("@milkdown/kit/utils");
  editor.editor.action(replaceAll(content, true));
  await nextTick();
  applyingExternalContent = false;
}

async function destroyEditor() {
  ready.value = false;
  await editor?.destroy();
  editor = null;
}

async function mountEditor() {
  if (!editorRoot.value || props.surfaceMode !== "live" || editor) {
    return;
  }

  const { Crepe } = await import("@milkdown/crepe");

  if (destroyed || !editorRoot.value) {
    return;
  }

  editor = new Crepe({
    root: editorRoot.value,
    defaultValue: props.content,
    features: {
      [Crepe.Feature.AI]: false,
      [Crepe.Feature.TopBar]: true,
    },
    featureConfigs: {
      [Crepe.Feature.Placeholder]: {
        mode: "block",
        text: "Start writing...",
      },
    },
  });

  editor.on((listener) => {
    listener.markdownUpdated((_ctx, markdown) => {
      if (!applyingExternalContent) {
        emit("contentChange", markdown);
      }
    });
  });

  await editor.create();
  ready.value = true;
  await nextTick();
  focusLiveEditor();
  syncSelectionState();
}

function focusLiveEditor() {
  editorRoot.value?.querySelector<HTMLElement>(".ProseMirror")?.focus();
}

function syncSelectionState() {
  const selection = window.getSelection();
  emit("selectionChange", {
    text: selection?.toString() ?? "",
    from: null,
    to: null,
    fromLine: null,
    toLine: null,
  });
}

watch(
  () => props.content,
  (content) => {
    if (props.surfaceMode === "live") {
      void replaceEditorContent(content);
    }
  },
);

watch(
  () => props.surfaceMode,
  async (mode) => {
    if (mode === "live") {
      await nextTick();
      await mountEditor();
      return;
    }

    await destroyEditor();
  },
);

onMounted(() => {
  window.document.addEventListener("selectionchange", syncSelectionState);
  void mountEditor();
});

onBeforeUnmount(() => {
  destroyed = true;
  window.document.removeEventListener("selectionchange", syncSelectionState);
  void destroyEditor();
});
</script>

<template>
  <main class="document-shell document-shell--editor">
    <section
      :class="[
        'markdown-editor',
      ]"
      :data-surface-mode="surfaceMode"
      :data-theme="theme"
      :style="readerStyle"
    >
      <div class="writing-toolbar" role="toolbar" aria-label="Writing controls">
        <div class="writing-toolbar__segmented" role="group" aria-label="Writing surface">
          <button
            type="button"
            :aria-pressed="surfaceMode === 'live'"
            title="Live preview"
            @click="setSurfaceMode('live')"
          >
            <Eye :size="14" aria-hidden="true" />
            Live
          </button>
          <button
            type="button"
            :aria-pressed="surfaceMode === 'source'"
            title="Markdown source"
            @click="setSurfaceMode('source')"
          >
            <Code2 :size="14" aria-hidden="true" />
            Source
          </button>
        </div>
      </div>

      <div
        v-if="saveStatus === 'conflict' || (saveStatus === 'error' && error)"
        class="markdown-editor__notice"
        :data-status="saveStatus"
      >
        <AlertTriangle :size="16" aria-hidden="true" />
        <div>
          <strong>{{ noticeTitle }}</strong>
          <span v-if="error">{{ error }}</span>
        </div>
        <div v-if="saveStatus === 'conflict'" class="markdown-editor__notice-actions">
          <button
            type="button"
            title="Reload from disk"
            @click="emit('reload')"
          >
            <RefreshCw :size="14" aria-hidden="true" />
            Reload
          </button>
          <button
            type="button"
            title="Overwrite disk version"
            @click="emit('overwrite')"
          >
            <Upload :size="14" aria-hidden="true" />
            Overwrite
          </button>
        </div>
      </div>

      <div v-if="surfaceMode === 'live'" ref="editorRoot" class="markdown-editor__surface" />
      <MarkdownSourceEditor
        v-else
        :ai-notes="aiNotes"
        :content="content"
        :preferences="preferences"
        :theme="theme"
        @ai-note-select="emit('aiNoteSelect', $event)"
        @content-change="emit('contentChange', $event)"
        @selection-change="emit('selectionChange', $event)"
      />
      <div v-if="surfaceMode === 'live' && !ready" class="markdown-editor__loading">
        Opening editor...
      </div>
    </section>
  </main>
</template>
