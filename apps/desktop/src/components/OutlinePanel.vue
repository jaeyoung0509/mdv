<script setup lang="ts">
import { Bookmark, CheckCircle2, MessageSquareText, Trash2, X } from "@lucide/vue";
import { computed, onBeforeUnmount, ref, watch } from "vue";
import type { AiNoteThread, OutlineHeading, ReaderBookmark } from "../lib/types";

const props = defineProps<{
  aiNotes: AiNoteThread[];
  bookmarks: ReaderBookmark[];
  headings: OutlineHeading[];
  open: boolean;
}>();

const emit = defineEmits<{
  aiNoteRemove: [noteId: string];
  aiNoteResolve: [noteId: string, resolved: boolean];
  aiNoteSelect: [note: AiNoteThread];
  bookmarkRemove: [bookmarkId: string];
  bookmarkSelect: [bookmark: ReaderBookmark];
  close: [];
}>();

const activeId = ref<string | null>(null);
const activeTab = ref<"outline" | "bookmarks" | "aiNotes">("outline");
let observer: IntersectionObserver | null = null;

const orderedBookmarks = computed(() => {
  const headingOrder = new Map(props.headings.map((heading, index) => [heading.id, index]));

  return [...props.bookmarks].sort((left, right) => {
    const leftIndex =
      left.target.kind === "heading"
        ? (headingOrder.get(left.target.headingId) ?? Number.MAX_SAFE_INTEGER)
        : Number.MAX_SAFE_INTEGER;
    const rightIndex =
      right.target.kind === "heading"
        ? (headingOrder.get(right.target.headingId) ?? Number.MAX_SAFE_INTEGER)
        : Number.MAX_SAFE_INTEGER;
    const leftOffset =
      left.target.kind === "heading" ? left.target.scrollYFallback : left.target.scrollY;
    const rightOffset =
      right.target.kind === "heading" ? right.target.scrollYFallback : right.target.scrollY;

    return leftIndex - rightIndex || leftOffset - rightOffset || left.createdAt - right.createdAt;
  });
});
const groupedAiNotes = computed(() => {
  const headingOrder = new Map(props.headings.map((heading, index) => [heading.id, index]));

  return [...props.aiNotes].sort((left, right) => {
    const leftIndex =
      left.anchor.kind === "heading"
        ? (headingOrder.get(left.anchor.headingId) ?? Number.MAX_SAFE_INTEGER)
        : Number.MAX_SAFE_INTEGER;
    const rightIndex =
      right.anchor.kind === "heading"
        ? (headingOrder.get(right.anchor.headingId) ?? Number.MAX_SAFE_INTEGER)
        : Number.MAX_SAFE_INTEGER;
    const leftLine = left.anchor.kind === "lineRange" ? left.anchor.fromLine : Number.MAX_SAFE_INTEGER;
    const rightLine = right.anchor.kind === "lineRange" ? right.anchor.fromLine : Number.MAX_SAFE_INTEGER;

    return leftIndex - rightIndex || leftLine - rightLine || right.updatedAt - left.updatedAt;
  });
});

function aiNoteAnchorLabel(note: AiNoteThread): string {
  if (note.anchor.kind === "lineRange") {
    return note.anchor.fromLine === note.anchor.toLine
      ? `Line ${note.anchor.fromLine}`
      : `Lines ${note.anchor.fromLine}-${note.anchor.toLine}`;
  }

  return note.anchor.label;
}

function scrollToHeading(id: string): void {
  const element = document.getElementById(id);

  if (!element) {
    return;
  }

  element.scrollIntoView({ behavior: "smooth", block: "start" });
  window.history.replaceState(null, "", `#${id}`);
}

function updateActiveHeading() {
  const isNearBottom =
    window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4;

  if (isNearBottom) {
    activeId.value = props.headings[props.headings.length - 1]?.id ?? null;
    return;
  }

  let nextActiveId = props.headings[0]?.id ?? null;

  for (const heading of props.headings) {
    const element = document.getElementById(heading.id);

    if (!element) {
      continue;
    }

    if (element.getBoundingClientRect().top <= 120) {
      nextActiveId = heading.id;
      continue;
    }

    break;
  }

  activeId.value = nextActiveId;
}

function teardownObserver() {
  observer?.disconnect();
  observer = null;
  window.removeEventListener("scroll", updateActiveHeading);
}

watch(
  () => [props.open, props.headings] as const,
  ([open]) => {
    teardownObserver();

    if (!open) {
      activeId.value = null;
      return;
    }

    const elements = props.headings
      .map((heading) => document.getElementById(heading.id))
      .filter((element): element is HTMLElement => Boolean(element));

    if (elements.length === 0) {
      activeId.value = null;
      return;
    }

    if ("IntersectionObserver" in window) {
      observer = new IntersectionObserver(updateActiveHeading, {
        rootMargin: "-96px 0px -70% 0px",
        threshold: [0, 1],
      });
      elements.forEach((element) => observer?.observe(element));
    }

    updateActiveHeading();
    window.addEventListener("scroll", updateActiveHeading, { passive: true });
  },
  { immediate: true, deep: true },
);

onBeforeUnmount(teardownObserver);
</script>

<template>
  <aside v-if="open" class="outline-panel" aria-label="Outline">
    <div class="panel-header">
      <h2>Outline</h2>
      <button
        type="button"
        class="icon-button outline-panel__close"
        title="Close outline"
        @click="emit('close')"
      >
        <X :size="16" aria-hidden="true" />
      </button>
    </div>

    <div class="panel-tabs" role="tablist" aria-label="Outline panel sections">
      <button
        type="button"
        role="tab"
        :aria-selected="activeTab === 'outline'"
        @click="activeTab = 'outline'"
      >
        Outline
      </button>
      <button
        type="button"
        role="tab"
        :aria-selected="activeTab === 'bookmarks'"
        @click="activeTab = 'bookmarks'"
      >
        Bookmarks
        <span>{{ bookmarks.length }}</span>
      </button>
      <button
        type="button"
        role="tab"
        :aria-selected="activeTab === 'aiNotes'"
        @click="activeTab = 'aiNotes'"
      >
        AI Notes
        <span>{{ aiNotes.length }}</span>
      </button>
    </div>

    <template v-if="activeTab === 'outline'">
      <nav v-if="headings.length > 0" class="outline-nav">
        <button
          v-for="heading in headings"
          :key="heading.id"
          type="button"
          class="outline-nav__item"
          :data-level="heading.level"
          :aria-current="activeId === heading.id ? 'true' : undefined"
          @click="scrollToHeading(heading.id)"
        >
          {{ heading.text }}
        </button>
      </nav>
      <p v-else class="outline-empty">No headings</p>
    </template>

    <template v-else-if="activeTab === 'bookmarks'">
      <div v-if="orderedBookmarks.length > 0" class="bookmark-list">
        <div v-for="bookmark in orderedBookmarks" :key="bookmark.id" class="bookmark-row">
          <button
            type="button"
            class="bookmark-row__jump"
            :title="bookmark.label"
            @click="emit('bookmarkSelect', bookmark)"
          >
            <Bookmark :size="13" aria-hidden="true" />
            <span>{{ bookmark.label }}</span>
          </button>
          <button
            type="button"
            class="icon-button bookmark-row__remove"
            title="Remove bookmark"
            @click="emit('bookmarkRemove', bookmark.id)"
          >
            <Trash2 :size="13" aria-hidden="true" />
          </button>
        </div>
      </div>
      <p v-else class="outline-empty">No bookmarks</p>
    </template>

    <template v-else>
      <div v-if="groupedAiNotes.length > 0" class="ai-note-list">
        <div
          v-for="note in groupedAiNotes"
          :key="note.id"
          class="ai-note-row"
          :data-resolved="note.resolved"
        >
          <button
            type="button"
            class="ai-note-row__jump"
            :title="note.title"
            @click="emit('aiNoteSelect', note)"
          >
            <MessageSquareText :size="13" aria-hidden="true" />
            <span>{{ note.title }}</span>
            <small>{{ aiNoteAnchorLabel(note) }}</small>
          </button>
          <div class="ai-note-row__actions">
            <button
              type="button"
              class="icon-button"
              :title="note.resolved ? 'Reopen AI note' : 'Resolve AI note'"
              @click="emit('aiNoteResolve', note.id, !note.resolved)"
            >
              <CheckCircle2 :size="13" aria-hidden="true" />
            </button>
            <button
              type="button"
              class="icon-button"
              title="Remove AI note"
              @click="emit('aiNoteRemove', note.id)"
            >
              <Trash2 :size="13" aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>
      <p v-else class="outline-empty">No AI notes</p>
    </template>
  </aside>
</template>
