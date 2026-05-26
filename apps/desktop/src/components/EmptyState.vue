<script setup lang="ts">
import { FileUp, FolderOpen } from "@lucide/vue";

withDefaults(
  defineProps<{
    title: string;
    message: string;
    path?: string;
    opening?: boolean;
  }>(),
  {
    opening: false,
  },
);

const emit = defineEmits<{
  openFile: [];
}>();
</script>

<template>
  <main class="state-view">
    <section class="state-panel">
      <p class="state-eyebrow">No document</p>
      <h1>{{ title }}</h1>
      <p>{{ message }}</p>
      <p v-if="path" class="state-meta">Directory: {{ path }}</p>
      <div class="state-actions">
        <button
          type="button"
          class="primary-button"
          :disabled="opening"
          @click="emit('openFile')"
        >
          <FolderOpen :size="16" aria-hidden="true" />
          {{ opening ? "Opening..." : "Open Markdown" }}
        </button>
      </div>
      <p class="state-hint">
        <FileUp :size="15" aria-hidden="true" />
        Drag a .md or .markdown file into this window.
      </p>
      <pre class="state-command">mdv README.md</pre>
    </section>
  </main>
</template>
