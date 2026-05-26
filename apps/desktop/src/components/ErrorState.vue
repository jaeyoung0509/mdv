<script setup lang="ts">
import { FolderOpen } from "@lucide/vue";
import type { MdvError } from "../lib/types";

withDefaults(
  defineProps<{
    error: MdvError;
    rawContent?: string;
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
    <section class="state-panel state-panel--error">
      <p class="state-eyebrow">{{ error.kind }}</p>
      <h1>{{ error.message }}</h1>
      <p v-if="error.path" class="state-meta">Path: {{ error.path }}</p>
      <p v-if="error.cwd" class="state-meta">Working directory: {{ error.cwd }}</p>
      <pre v-if="error.details" class="state-details">{{ error.details }}</pre>
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
      <pre v-if="rawContent" class="raw-fallback">{{ rawContent }}</pre>
    </section>
  </main>
</template>
