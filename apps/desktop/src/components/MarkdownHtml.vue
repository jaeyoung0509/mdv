<script setup lang="ts">
import { ref, watch } from "vue";
import { renderMarkdownHtml } from "../lib/markdown";

const props = withDefaults(
  defineProps<{
    content: string;
    allowHtml?: boolean;
  }>(),
  {
    allowHtml: false,
  },
);

const html = ref("");

watch(
  () => [props.content, props.allowHtml] as const,
  async ([content, allowHtml]) => {
    html.value = await renderMarkdownHtml(content, allowHtml);
  },
  { immediate: true },
);
</script>

<template>
  <div v-html="html" />
</template>
