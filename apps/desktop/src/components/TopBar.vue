<script setup lang="ts">
import {
  AlertTriangle,
  BookmarkPlus,
  BookOpen,
  ChevronDown,
  Check,
  Copy,
  FileText,
  Folder,
  FolderOpen,
  ListTree,
  PenLine,
  Save,
  Search,
  Settings,
  Sparkles,
} from "@lucide/vue";
import { computed, onBeforeUnmount, ref, watch as vueWatch } from "vue";
import type { DirectoryDocument, DocumentPayload, EditorMode, SaveStatus } from "../lib/types";

const props = withDefaults(
  defineProps<{
    document: DocumentPayload | null;
    watch: boolean;
    outlineVisible: boolean;
    opening?: boolean;
    aiPanelOpen?: boolean;
    findOpen?: boolean;
    directoryDocuments?: DirectoryDocument[];
    editorMode?: EditorMode;
    saveStatus?: SaveStatus;
    wordCount?: number;
    selectedWordCount?: number;
  }>(),
  {
    opening: false,
    aiPanelOpen: false,
    findOpen: false,
    directoryDocuments: () => [],
    editorMode: "read",
    saveStatus: "idle",
    wordCount: 0,
    selectedWordCount: 0,
  },
);

const emit = defineEmits<{
  bookmarkAdd: [];
  aiToggle: [];
  documentOpen: [path: string];
  editorModeChange: [mode: EditorMode];
  findToggle: [];
  openFile: [];
  outlineToggle: [];
  save: [];
  settingsToggle: [];
}>();

const documentMenuOpen = ref(false);
const titleRef = ref<HTMLElement | null>(null);
const saveStatusLabel = computed(() => {
  if (props.saveStatus === "dirty") {
    return "Unsaved";
  }

  if (props.saveStatus === "saving") {
    return "Saving";
  }

  if (props.saveStatus === "saved") {
    return "Saved";
  }

  if (props.saveStatus === "conflict") {
    return "Conflict";
  }

  if (props.saveStatus === "error") {
    return "Save failed";
  }

  return "Ready";
});
const writingStatsLabel = computed(() => {
  const words = `${props.wordCount} ${props.wordCount === 1 ? "word" : "words"}`;

  if (props.selectedWordCount > 0) {
    return `${props.selectedWordCount} selected / ${words}`;
  }

  return words;
});

async function copyPath() {
  if (!props.document) {
    return;
  }

  await navigator.clipboard.writeText(props.document.path);
}

function openDocument(path: string) {
  documentMenuOpen.value = false;
  emit("documentOpen", path);
}

function openPicker() {
  documentMenuOpen.value = false;
  emit("openFile");
}

function closeDocumentMenu(event: PointerEvent) {
  const target = event.target;

  if (target instanceof Node && titleRef.value?.contains(target)) {
    return;
  }

  documentMenuOpen.value = false;
}

function closeOnEscape(event: KeyboardEvent) {
  if (event.key === "Escape") {
    documentMenuOpen.value = false;
  }
}

vueWatch(documentMenuOpen, (open) => {
  if (open) {
    window.document.addEventListener("pointerdown", closeDocumentMenu);
    window.document.addEventListener("keydown", closeOnEscape);
    return;
  }

  window.document.removeEventListener("pointerdown", closeDocumentMenu);
  window.document.removeEventListener("keydown", closeOnEscape);
});

vueWatch(
  () => props.document?.path,
  () => {
    documentMenuOpen.value = false;
  },
);

onBeforeUnmount(() => {
  window.document.removeEventListener("pointerdown", closeDocumentMenu);
  window.document.removeEventListener("keydown", closeOnEscape);
});
</script>

<template>
  <header class="top-bar">
    <div ref="titleRef" class="top-bar__title">
      <template v-if="document">
        <button
          type="button"
          class="document-switcher__trigger"
          aria-haspopup="menu"
          :aria-expanded="documentMenuOpen"
          aria-label="Open document switcher"
          @click="documentMenuOpen = !documentMenuOpen"
        >
          <span class="top-bar__file">{{ document.fileName }}</span>
          <span class="top-bar__path" :title="document.path">{{ document.directory }}</span>
          <ChevronDown :size="14" aria-hidden="true" />
        </button>

        <div v-if="documentMenuOpen" class="document-menu" role="menu">
          <button
            type="button"
            class="document-menu__directory"
            role="menuitem"
            :title="document.directory"
            @click="openDocument(document.directory)"
          >
            <Folder :size="14" aria-hidden="true" />
            <span>{{ document.directory }}</span>
          </button>

          <div class="document-menu__files">
            <button
              v-for="item in directoryDocuments"
              :key="item.path"
              type="button"
              class="document-menu__file"
              role="menuitem"
              :aria-current="item.path === document.path ? 'page' : undefined"
              :disabled="item.path === document.path"
              :title="item.path"
              @click="openDocument(item.path)"
            >
              <FileText :size="14" aria-hidden="true" />
              <span>{{ item.fileName }}</span>
            </button>
            <p v-if="directoryDocuments.length === 0" class="document-menu__empty">
              No Markdown files found.
            </p>
          </div>

          <button
            type="button"
            class="document-menu__open"
            role="menuitem"
            :disabled="opening"
            @click="openPicker"
          >
            <FolderOpen :size="14" aria-hidden="true" />
            <span>{{ opening ? "Opening..." : "Open another file..." }}</span>
          </button>
        </div>
      </template>
      <span v-else class="top-bar__file">mdv</span>
    </div>

    <div class="top-bar__actions">
      <span class="watch-status">
        <Check v-if="watch && document?.watching" :size="14" aria-hidden="true" />
        {{ watch && document?.watching ? "Watching" : "Static" }}
      </span>

      <div class="mode-switcher" role="group" aria-label="Editor mode">
        <button
          type="button"
          :aria-pressed="editorMode === 'read'"
          :disabled="!document"
          title="Read mode"
          @click="emit('editorModeChange', 'read')"
        >
          <BookOpen :size="14" aria-hidden="true" />
          <span>Read</span>
        </button>
        <button
          type="button"
          :aria-pressed="editorMode === 'write'"
          :disabled="!document"
          title="Write mode"
          @click="emit('editorModeChange', 'write')"
        >
          <PenLine :size="14" aria-hidden="true" />
          <span>Write</span>
        </button>
      </div>

      <button
        type="button"
        class="icon-button"
        title="Save document"
        :disabled="!document || editorMode !== 'write' || saveStatus === 'saving'"
        @click="emit('save')"
      >
        <Save :size="15" aria-hidden="true" />
      </button>

      <span v-if="editorMode === 'write'" class="save-status" :data-status="saveStatus">
        <AlertTriangle
          v-if="saveStatus === 'conflict' || saveStatus === 'error'"
          :size="13"
          aria-hidden="true"
        />
        <span v-else class="save-status__dot" aria-hidden="true" />
        <span>{{ saveStatusLabel }}</span>
        <span class="save-status__stats">{{ writingStatsLabel }}</span>
      </span>

      <button
        type="button"
        class="icon-button"
        title="Open Markdown file"
        :disabled="opening"
        @click="emit('openFile')"
      >
        <FolderOpen :size="15" aria-hidden="true" />
      </button>

      <button
        type="button"
        class="icon-button"
        title="Toggle outline"
        :aria-pressed="outlineVisible"
        :disabled="!document"
        @click="emit('outlineToggle')"
      >
        <ListTree :size="15" aria-hidden="true" />
      </button>

      <button
        type="button"
        class="icon-button"
        title="Find in document"
        :aria-pressed="findOpen"
        :disabled="!document"
        @click="emit('findToggle')"
      >
        <Search :size="15" aria-hidden="true" />
      </button>

      <button
        type="button"
        class="icon-button"
        title="Copy file path"
        :disabled="!document"
        @click="copyPath"
      >
        <Copy :size="15" aria-hidden="true" />
      </button>

      <button
        type="button"
        class="icon-button"
        title="Toggle bookmark for current heading"
        :disabled="!document"
        @click="emit('bookmarkAdd')"
      >
        <BookmarkPlus :size="15" aria-hidden="true" />
      </button>

      <button
        type="button"
        class="icon-button"
        title="Ask AI"
        :aria-pressed="aiPanelOpen"
        @click="emit('aiToggle')"
      >
        <Sparkles :size="15" aria-hidden="true" />
      </button>

      <button
        type="button"
        class="icon-button"
        title="Open settings"
        @click="emit('settingsToggle')"
      >
        <Settings :size="15" aria-hidden="true" />
      </button>
    </div>
  </header>
</template>
