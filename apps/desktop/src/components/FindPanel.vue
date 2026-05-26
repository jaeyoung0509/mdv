<script setup lang="ts">
import { ChevronDown, ChevronUp, Search, X } from "@lucide/vue";
import { nextTick, onBeforeUnmount, ref, watch } from "vue";

const RESULT_HIGHLIGHT = "mdv-find-result";
const ACTIVE_HIGHLIGHT = "mdv-find-active";

type HighlightLike = unknown;
type HighlightConstructor = new (...ranges: Range[]) => HighlightLike;
type HighlightRegistry = {
  delete: (name: string) => void;
  set: (name: string, highlight: HighlightLike) => void;
};

interface TextSegment {
  node: Text;
  start: number;
  end: number;
}

const props = defineProps<{
  documentKey?: string;
  open: boolean;
  rootSelector: string;
}>();

const emit = defineEmits<{
  close: [];
}>();

const query = ref("");
const matchCount = ref(0);
const activeIndex = ref(-1);
const inputRef = ref<HTMLInputElement | null>(null);
let ranges: Range[] = [];

function getHighlightTools():
  | { Highlight: HighlightConstructor; registry: HighlightRegistry }
  | null {
  if (typeof CSS === "undefined" || typeof window === "undefined") {
    return null;
  }

  const registry = (CSS as unknown as { highlights?: HighlightRegistry }).highlights;
  const Highlight = (window as unknown as { Highlight?: HighlightConstructor }).Highlight;

  if (!registry || !Highlight) {
    return null;
  }

  return { Highlight, registry };
}

function clearFindHighlights() {
  const tools = getHighlightTools();

  if (!tools) {
    return;
  }

  tools.registry.delete(RESULT_HIGHLIGHT);
  tools.registry.delete(ACTIVE_HIGHLIGHT);
}

function collectTextSegments(root: Element): TextSegment[] {
  const walker = window.document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.textContent?.trim()) {
        return NodeFilter.FILTER_REJECT;
      }

      const parent = node.parentElement;

      if (!parent || parent.closest("button, input, select, textarea, .heading-anchor")) {
        return NodeFilter.FILTER_REJECT;
      }

      return NodeFilter.FILTER_ACCEPT;
    },
  });
  const segments: TextSegment[] = [];
  let offset = 0;
  let node = walker.nextNode();

  while (node) {
    const text = node.textContent ?? "";
    const nextOffset = offset + text.length;
    segments.push({ node: node as Text, start: offset, end: nextOffset });
    offset = nextOffset;
    node = walker.nextNode();
  }

  return segments;
}

function pointAt(segments: TextSegment[], offset: number) {
  if (segments.length === 0) {
    return null;
  }

  if (offset <= 0) {
    return { node: segments[0].node, offset: 0 };
  }

  for (const segment of segments) {
    if (offset >= segment.start && offset <= segment.end) {
      return {
        node: segment.node,
        offset: offset - segment.start,
      };
    }
  }

  const last = segments[segments.length - 1];
  return { node: last.node, offset: last.node.data.length };
}

function createSearchRanges(root: Element, searchQuery: string): Range[] {
  const segments = collectTextSegments(root);
  const haystack = segments.map((segment) => segment.node.data).join("");
  const normalizedHaystack = haystack.toLocaleLowerCase();
  const normalizedQuery = searchQuery.toLocaleLowerCase();
  const searchRanges: Range[] = [];
  let matchIndex = normalizedHaystack.indexOf(normalizedQuery);

  while (matchIndex >= 0) {
    const start = pointAt(segments, matchIndex);
    const end = pointAt(segments, matchIndex + searchQuery.length);

    if (start && end) {
      const range = window.document.createRange();
      range.setStart(start.node, start.offset);
      range.setEnd(end.node, end.offset);
      searchRanges.push(range);
    }

    matchIndex = normalizedHaystack.indexOf(normalizedQuery, matchIndex + searchQuery.length);
  }

  return searchRanges;
}

function applyHighlights(searchRanges: Range[], currentIndex: number): boolean {
  clearFindHighlights();

  const tools = getHighlightTools();

  if (!tools || searchRanges.length === 0) {
    return false;
  }

  const resultRanges = searchRanges.filter((_, index) => index !== currentIndex);

  if (resultRanges.length > 0) {
    tools.registry.set(RESULT_HIGHLIGHT, new tools.Highlight(...resultRanges));
  }

  if (currentIndex >= 0 && searchRanges[currentIndex]) {
    tools.registry.set(ACTIVE_HIGHLIGHT, new tools.Highlight(searchRanges[currentIndex]));
  }

  return true;
}

function getRangeRect(range: Range): DOMRect | null {
  const rect = range.getBoundingClientRect();

  if (rect.width || rect.height) {
    return rect;
  }

  return range.getClientRects()[0] ?? null;
}

function scrollRangeIntoView(range: Range) {
  const rect = getRangeRect(range);

  if (!rect) {
    return;
  }

  window.scrollTo({
    top: Math.max(0, window.scrollY + rect.top - 128),
    behavior: "smooth",
  });
}

function selectRange(range: Range) {
  const selection = window.getSelection();

  if (!selection) {
    return;
  }

  selection.removeAllRanges();
  selection.addRange(range.cloneRange());
}

function moveActiveMatch(direction: 1 | -1) {
  if (matchCount.value === 0) {
    activeIndex.value = -1;
    return;
  }

  const safeCurrent = activeIndex.value < 0 ? 0 : activeIndex.value;
  activeIndex.value = (safeCurrent + direction + matchCount.value) % matchCount.value;
}

function updateRanges() {
  clearFindHighlights();

  if (!props.open || !query.value.trim()) {
    ranges = [];
    matchCount.value = 0;
    activeIndex.value = -1;
    return;
  }

  const root = window.document.querySelector(props.rootSelector);

  if (!root) {
    ranges = [];
    matchCount.value = 0;
    activeIndex.value = -1;
    return;
  }

  ranges = createSearchRanges(root, query.value.trim());
  matchCount.value = ranges.length;
  activeIndex.value = ranges.length > 0 ? 0 : -1;
}

watch(
  () => props.open,
  async (open) => {
    if (!open) {
      clearFindHighlights();
      return;
    }

    await nextTick();
    requestAnimationFrame(() => {
      inputRef.value?.focus();
      inputRef.value?.select();
    });
  },
);

watch(() => [props.documentKey, props.open, query.value, props.rootSelector], updateRanges);

watch([activeIndex, matchCount, () => props.open, query], () => {
  if (!props.open) {
    return;
  }

  const hasCustomHighlights = applyHighlights(ranges, activeIndex.value);
  const activeRange = activeIndex.value >= 0 ? ranges[activeIndex.value] : null;

  if (!activeRange) {
    return;
  }

  scrollRangeIntoView(activeRange);

  if (!hasCustomHighlights) {
    selectRange(activeRange);
  }
});

onBeforeUnmount(clearFindHighlights);
</script>

<template>
  <aside v-if="open" class="find-panel" aria-label="Find in document">
    <Search :size="15" aria-hidden="true" />
    <input
      ref="inputRef"
      v-model="query"
      type="search"
      placeholder="Find in document"
      aria-label="Find in document"
      @keydown.enter.prevent="moveActiveMatch($event.shiftKey ? -1 : 1)"
      @keydown.esc.prevent="emit('close')"
    />
    <span class="find-panel__count" aria-live="polite">
      {{ query.trim() ? `${activeIndex >= 0 ? activeIndex + 1 : 0}/${matchCount}` : "0/0" }}
    </span>
    <button
      type="button"
      class="icon-button"
      title="Previous match"
      :disabled="matchCount === 0"
      @click="moveActiveMatch(-1)"
    >
      <ChevronUp :size="15" aria-hidden="true" />
    </button>
    <button
      type="button"
      class="icon-button"
      title="Next match"
      :disabled="matchCount === 0"
      @click="moveActiveMatch(1)"
    >
      <ChevronDown :size="15" aria-hidden="true" />
    </button>
    <button type="button" class="icon-button" title="Close find" @click="emit('close')">
      <X :size="15" aria-hidden="true" />
    </button>
  </aside>
</template>
