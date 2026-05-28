<script setup lang="ts">
import { markdown } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { EditorState } from "@codemirror/state";
import { basicSetup, EditorView } from "codemirror";
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { getReaderStyleProperties } from "../lib/readerSettings";
import type { AiNoteThread, EffectiveTheme, ReaderPreferences, WritingSelection } from "../lib/types";

const props = defineProps<{
  aiNotes: AiNoteThread[];
  content: string;
  preferences: ReaderPreferences;
  theme: EffectiveTheme;
}>();

const emit = defineEmits<{
  aiNoteSelect: [note: AiNoteThread];
  contentChange: [content: string];
  selectionChange: [selection: WritingSelection];
}>();

const sourceRoot = ref<HTMLElement | null>(null);
const readerStyle = computed(() => getReaderStyleProperties(props.preferences));
let view: EditorView | null = null;
let applyingExternalContent = false;

function currentSelection(state: EditorState): WritingSelection {
  const text = state.selection.ranges
    .filter((range) => !range.empty)
    .map((range) => state.sliceDoc(range.from, range.to))
    .join("\n");
  const main = state.selection.main;
  const fromLine = state.doc.lineAt(main.from);
  const toLine = state.doc.lineAt(main.to);

  return {
    text,
    from: main.from,
    to: main.to,
    fromLine: fromLine.number,
    toLine: toLine.number,
  };
}

function emitSelection() {
  if (!view) {
    return;
  }

  emit("selectionChange", currentSelection(view.state));
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

function clearLineNoteMarkers() {
  sourceRoot.value
    ?.querySelectorAll(".source-note-marker")
    .forEach((marker) => marker.remove());
}

function syncLineNoteMarkers() {
  if (!view || !sourceRoot.value) {
    return;
  }

  clearLineNoteMarkers();

  for (const note of props.aiNotes) {
    if (note.resolved || note.anchor.kind !== "lineRange") {
      continue;
    }

    const lineNumber = Math.min(Math.max(note.anchor.fromLine, 1), view.state.doc.lines);
    const line = view.state.doc.line(lineNumber);
    const block = view.lineBlockAt(line.from);
    const marker = document.createElement("button");
    marker.type = "button";
    marker.className = "source-note-marker";
    marker.title = note.title;
    marker.textContent = String(props.aiNotes.indexOf(note) + 1);
    marker.style.top = `${block.top}px`;
    marker.onclick = () => emit("aiNoteSelect", note);
    sourceRoot.value.append(marker);
  }
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
            emit("selectionChange", currentSelection(update.state));
            void nextTick(syncLineNoteMarkers);
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
  void nextTick(syncLineNoteMarkers);
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
    void nextTick(syncLineNoteMarkers);
  },
);

watch(
  () => props.aiNotes,
  () => void nextTick(syncLineNoteMarkers),
  { deep: true },
);

onMounted(() => {
  mountSourceEditor();
});

onBeforeUnmount(() => {
  emit("selectionChange", {
    text: "",
    from: null,
    to: null,
    fromLine: null,
    toLine: null,
  });
  clearLineNoteMarkers();
  view?.destroy();
  view = null;
});
</script>

<template>
  <div
    ref="sourceRoot"
    class="markdown-source-editor"
    :data-theme="theme"
    :style="readerStyle"
    aria-label="Markdown source editor"
  />
</template>
