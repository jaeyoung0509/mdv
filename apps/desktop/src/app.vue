<script setup lang="ts">
import { defineAsyncComponent } from "vue";
import AiPanel from "./components/AiPanel.vue";
import EmptyState from "./components/EmptyState.vue";
import ErrorState from "./components/ErrorState.vue";
import FileDropOverlay from "./components/FileDropOverlay.vue";
import FindPanel from "./components/FindPanel.vue";
import MarkdownView from "./components/MarkdownView.vue";
import OutlinePanel from "./components/OutlinePanel.vue";
import SettingsPanel from "./components/SettingsPanel.vue";
import TopBar from "./components/TopBar.vue";
import { useAppLifecycle } from "./composables/useAppLifecycle";
import { useThemeSync } from "./composables/useThemeSync";
import { useAppStore } from "./stores/app";

const store = useAppStore();
const MarkdownEditor = defineAsyncComponent(() =>
  import("./components/MarkdownEditor.vue").then((module) => module.default),
);

useThemeSync(store);
useAppLifecycle(store);
</script>

<template>
  <div v-if="store.loading" class="app-frame">
    <TopBar
      :document="null"
      :watch="store.watch"
      :outline-visible="store.preferences.outlineVisible"
      :opening="store.opening"
      :ai-panel-open="store.aiPanelOpen"
      :find-open="store.findOpen"
      :directory-documents="[]"
      editor-mode="read"
      save-status="idle"
      :word-count="0"
      :selected-word-count="0"
      @bookmark-add="store.toggleCurrentBookmark"
      @ai-toggle="store.toggleAiPanel"
      @document-open="store.openDocumentPath"
      @editor-mode-change="store.setEditorMode"
      @find-toggle="store.toggleFind"
      @open-file="store.openFilePicker"
      @outline-toggle="store.toggleOutline"
      @save="store.saveCurrentDocument"
      @settings-toggle="store.openSettingsPanel"
    />
    <main class="state-view">
      <section class="state-panel">
        <p class="state-eyebrow">Loading</p>
        <h1>Opening Markdown...</h1>
      </section>
    </main>
  </div>

  <div v-else class="app-frame">
    <TopBar
      :document="store.document"
      :watch="store.watch"
      :outline-visible="store.preferences.outlineVisible"
      :opening="store.opening"
      :ai-panel-open="store.aiPanelOpen"
      :find-open="store.findOpen"
      :directory-documents="store.directoryDocuments"
      :editor-mode="store.editorMode"
      :save-status="store.saveStatus"
      :word-count="store.wordCount"
      :selected-word-count="store.selectedWordCount"
      @bookmark-add="store.toggleCurrentBookmark"
      @ai-toggle="store.toggleAiPanel"
      @document-open="store.openDocumentPath"
      @editor-mode-change="store.setEditorMode"
      @find-toggle="store.toggleFind"
      @open-file="store.openFilePicker"
      @outline-toggle="store.toggleOutline"
      @save="store.saveCurrentDocument"
      @settings-toggle="store.openSettingsPanel"
    />

    <div
      v-if="store.document && !store.error"
      :class="[
        'reader-layout',
        store.preferences.outlineVisible ? 'reader-layout--with-outline' : '',
      ]"
    >
      <OutlinePanel
        :bookmarks="store.documentBookmarks"
        :headings="store.headings"
        :open="store.preferences.outlineVisible"
        @close="store.changePreferences({ outlineVisible: false })"
        @bookmark-remove="store.removeBookmark"
        @bookmark-select="store.selectBookmark"
      />
      <MarkdownView
        v-if="store.editorMode === 'read'"
        :document="store.document"
        :allow-html="store.allowHtml"
        :preferences="store.preferences"
        :theme="store.effectiveTheme"
        :bookmarked-heading-ids="store.bookmarkedHeadingIds"
        @headings-change="store.updateHeadings"
        @heading-bookmark-toggle="store.toggleHeadingBookmark"
        @text-selection="store.handleTextSelection"
      />
      <MarkdownEditor
        v-else
        :content="store.draftContent"
        :error="store.saveError"
        :focus-mode="store.focusMode"
        :preferences="store.preferences"
        :save-status="store.saveStatus"
        :surface-mode="store.writingSurfaceMode"
        :theme="store.effectiveTheme"
        :typewriter-mode="store.typewriterMode"
        @content-change="store.updateDraftContent"
        @focus-mode-change="store.setFocusMode"
        @overwrite="store.overwriteExternalChanges"
        @reload="store.reloadWritingDocument"
        @save="store.saveCurrentDocument"
        @selection-change="store.updateWritingSelection"
        @surface-mode-change="store.setWritingSurfaceMode"
        @typewriter-mode-change="store.setTypewriterMode"
      />
    </div>

    <EmptyState
      v-else-if="store.noMarkdown"
      title="No Markdown files found in this directory."
      message="Open a Markdown file directly or add a README.md file."
      :path="store.error?.path"
      :opening="store.opening"
      @open-file="store.openFilePicker"
    />

    <ErrorState
      v-else-if="store.error"
      :error="store.error"
      :raw-content="store.document?.content"
      :opening="store.opening"
      @open-file="store.openFilePicker"
    />

    <EmptyState
      v-else
      title="No Markdown file selected."
      message="Open a Markdown file directly or drop one into this window."
      :opening="store.opening"
      @open-file="store.openFilePicker"
    />

    <SettingsPanel
      :open="store.settingsOpen"
      :preferences="store.preferences"
      @change="store.changePreferences"
      @ai-change="store.changeAiSettings"
      @close="store.closeSettingsPanel"
      @reset="store.resetPreferences"
    />

    <AiPanel
      :answer="store.aiAnswer"
      :context-items="store.aiContextItems"
      :current-document-label="store.document?.fileName"
      :error="store.aiError"
      :open="store.aiPanelOpen"
      :settings="store.preferences.ai"
      :status="store.aiStatus"
      @cancel="store.cancelAiQuestion"
      @close="store.closeAiPanel"
      @context-add="store.addAiContextItems"
      @context-remove="store.removeAiContextItem"
      @provider-change="store.updateAiProvider"
      @send="store.sendAiQuestion"
    />

    <FindPanel
      :document-key="store.document?.path"
      :open="store.findOpen && Boolean(store.document && !store.error)"
      root-selector=".document-shell .mdv-markdown"
      @close="store.findOpen = false"
    />

    <button
      v-if="store.selectionChip"
      type="button"
      class="ask-ai-chip"
      :style="{
        left: `${store.selectionChip.x}px`,
        top: `${store.selectionChip.y}px`,
      }"
      @mousedown.prevent
      @click="store.addSelectionToAi(store.selectionChip.text)"
    >
      Ask AI
    </button>

    <button
      v-if="store.settingsOpen"
      type="button"
      class="panel-backdrop panel-backdrop--settings"
      aria-label="Close settings"
      @click="store.closeSettingsPanel"
    />

    <button
      v-if="store.document && !store.error && store.preferences.outlineVisible"
      type="button"
      class="panel-backdrop panel-backdrop--outline"
      aria-label="Close outline"
      @click="store.changePreferences({ outlineVisible: false })"
    />

    <FileDropOverlay :active="store.dragActive && !store.aiPanelOpen" />
  </div>
</template>
