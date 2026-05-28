<script setup lang="ts">
import { markdown } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { EditorState } from "@codemirror/state";
import { basicSetup, EditorView } from "codemirror";
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { getReaderStyleProperties } from "../lib/readerSettings";
import type { EffectiveTheme, ReaderPreferences } from "../lib/types";

const props = defineProps<{
  content: string;
  focusMode: boolean;
  preferences: ReaderPreferences;
  theme: EffectiveTheme;
  typewriterMode: boolean;
}>();

const emit = defineEmits<{
  contentChange: [content: string];
  selectionChange: [text: string];
}>();

const sourceRoot = ref<HTMLElement | null>(null);
const readerStyle = computed(() => getReaderStyleProperties(props.preferences));
let view: EditorView | null = null;
let applyingExternalContent = false;

function selectedText(state: EditorState) {
  return state.selection.ranges
    .filter((range) => !range.empty)
    .map((range) => state.sliceDoc(range.from, range.to))
    .join("\n");
}

function emitSelection() {
  if (!view) {
    return;
  }

  emit("selectionChange", selectedText(view.state));
}

function keepCaretCentered() {
  if (!view || !props.typewriterMode) {
    return;
  }

  const coords = view.coordsAtPos(view.state.selection.main.head);

  if (!coords) {
    return;
  }

  const target = window.innerHeight * 0.42;
  const delta = coords.top - target;

  if (Math.abs(delta) > 48) {
    window.scrollBy({ top: delta, behavior: "smooth" });
  }
}

function plainTextPasteHandler(event: ClipboardEvent, editorView: EditorView) {
  const text = event.clipboardData?.getData("text/plain");

  if (!text) {
    return false;
  }

  event.preventDefault();
  editorView.dispatch(editorView.state.replaceSelection(text));
  return true;
}

function mountSourceEditor() {
  if (!sourceRoot.value || view) {
    return;
  }

  view = new EditorView({
    parent: sourceRoot.value,
    state: EditorState.create({
      doc: props.content,
      extensions: [
        basicSetup,
        markdown({ codeLanguages: languages }),
        EditorState.tabSize.of(2),
        EditorView.lineWrapping,
        EditorView.updateListener.of((update) => {
          if (update.docChanged && !applyingExternalContent) {
            emit("contentChange", update.state.doc.toString());
          }

          if (update.docChanged || update.selectionSet) {
            emit("selectionChange", selectedText(update.state));
            keepCaretCentered();
          }
        }),
        EditorView.domEventHandlers({
          paste: plainTextPasteHandler,
        }),
      ],
    }),
  });

  view.focus();
  emitSelection();
}

watch(
  () => props.content,
  (content) => {
    if (!view || view.state.doc.toString() === content) {
      return;
    }

    applyingExternalContent = true;
    view.dispatch({
      changes: {
        from: 0,
        to: view.state.doc.length,
        insert: content,
      },
    });
    applyingExternalContent = false;
  },
);

watch(
  () => props.typewriterMode,
  async () => {
    await nextTick();
    keepCaretCentered();
  },
);

onMounted(() => {
  mountSourceEditor();
});

onBeforeUnmount(() => {
  emit("selectionChange", "");
  view?.destroy();
  view = null;
});
</script>

<template>
  <div
    ref="sourceRoot"
    :class="[
      'markdown-source-editor',
      focusMode ? 'markdown-source-editor--focus' : '',
      typewriterMode ? 'markdown-source-editor--typewriter' : '',
    ]"
    :data-theme="theme"
    :style="readerStyle"
    aria-label="Markdown source editor"
  />
</template>
