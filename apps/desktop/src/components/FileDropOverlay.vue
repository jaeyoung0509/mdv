<script setup lang="ts">
import { FileUp } from "@lucide/vue";

defineProps<{
  active: boolean;
}>();
</script>

<template>
  <div v-if="active" class="drop-overlay" role="status" aria-live="polite">
    <div class="drop-overlay__panel">
      <FileUp :size="24" aria-hidden="true" />
      <span>Drop Markdown to open</span>
    </div>
  </div>
</template>
