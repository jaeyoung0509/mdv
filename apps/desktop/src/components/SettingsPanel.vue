<script setup lang="ts">
import {
  AlignVerticalSpaceAround,
  Baseline,
  Columns3,
  Monitor,
  Moon,
  PanelLeft,
  RotateCcw,
  Sun,
  X,
} from "@lucide/vue";
import type { Component } from "vue";
import AiSettingsSection from "./AiSettingsSection.vue";
import { FONT_PRESET_LABELS } from "../lib/preferences";
import type { AiSettings, AppTheme, FontPreset, ReaderPreferences } from "../lib/types";

defineProps<{
  open: boolean;
  preferences: ReaderPreferences;
}>();

const emit = defineEmits<{
  change: [patch: Partial<ReaderPreferences>];
  aiChange: [settings: AiSettings];
  close: [];
  reset: [];
}>();

const themeOptions: Array<{ value: AppTheme; label: string; icon: Component }> = [
  { value: "system", label: "System", icon: Monitor },
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
];
const fontOptions: FontPreset[] = ["sans", "serif", "mono"];
</script>

<template>
  <aside v-if="open" class="settings-panel" aria-label="Settings">
    <div class="panel-header">
      <h2>Settings</h2>
      <button type="button" class="icon-button" title="Close settings" @click="emit('close')">
        <X :size="16" aria-hidden="true" />
      </button>
    </div>

    <div class="settings-plugin" data-plugin="appearance.theme">
      <section class="settings-section">
        <div class="settings-label">
          <Monitor :size="13" aria-hidden="true" />
          Theme
        </div>
        <div class="segmented-control segmented-control--icons">
          <button
            v-for="option in themeOptions"
            :key="option.value"
            type="button"
            :aria-pressed="preferences.theme === option.value"
            :title="option.label"
            @click="emit('change', { theme: option.value })"
          >
            <component :is="option.icon" :size="15" aria-hidden="true" />
            <span>{{ option.label }}</span>
          </button>
        </div>
      </section>
    </div>

    <div class="settings-plugin" data-plugin="typography.font">
      <section class="settings-section">
        <div class="settings-label">
          <Baseline :size="13" aria-hidden="true" />
          Font
        </div>
        <div class="segmented-control">
          <button
            v-for="fontPreset in fontOptions"
            :key="fontPreset"
            type="button"
            :aria-pressed="preferences.fontPreset === fontPreset"
            @click="emit('change', { fontPreset })"
          >
            {{ FONT_PRESET_LABELS[fontPreset] }}
          </button>
        </div>
      </section>

      <label class="range-control">
        <span>
          <span class="settings-label">
            <Baseline :size="13" aria-hidden="true" />
            Size
          </span>
          <output>{{ preferences.fontSize }}px</output>
        </span>
        <input
          type="range"
          min="14"
          max="22"
          step="1"
          :value="preferences.fontSize"
          @input="
            emit('change', {
              fontSize: Number(($event.currentTarget as HTMLInputElement).value),
            })
          "
        />
      </label>

      <label class="range-control">
        <span>
          <span class="settings-label">
            <AlignVerticalSpaceAround :size="13" aria-hidden="true" />
            Line
          </span>
          <output>{{ preferences.lineHeight.toFixed(2) }}</output>
        </span>
        <input
          type="range"
          min="1.45"
          max="1.95"
          step="0.05"
          :value="preferences.lineHeight"
          @input="
            emit('change', {
              lineHeight: Number(($event.currentTarget as HTMLInputElement).value),
            })
          "
        />
      </label>
    </div>

    <div class="settings-plugin" data-plugin="layout.measure">
      <label class="range-control">
        <span>
          <span class="settings-label">
            <Columns3 :size="13" aria-hidden="true" />
            Width
          </span>
          <output>{{ preferences.contentWidth }}px</output>
        </span>
        <input
          type="range"
          min="680"
          max="960"
          step="20"
          :value="preferences.contentWidth"
          @input="
            emit('change', {
              contentWidth: Number(($event.currentTarget as HTMLInputElement).value),
            })
          "
        />
      </label>

      <section class="settings-section">
        <div class="settings-label">
          <PanelLeft :size="13" aria-hidden="true" />
          Navigation
        </div>
        <label class="toggle-control">
          <input
            type="checkbox"
            :checked="preferences.outlineVisible"
            @change="
              emit('change', {
                outlineVisible: ($event.currentTarget as HTMLInputElement).checked,
              })
            "
          />
          <span>Show outline</span>
        </label>
      </section>
    </div>

    <div class="settings-plugin" data-plugin="ai">
      <AiSettingsSection :settings="preferences.ai" @change="emit('aiChange', $event)" />
    </div>

    <button type="button" class="reset-button" @click="emit('reset')">
      <RotateCcw :size="15" aria-hidden="true" />
      Reset
    </button>
  </aside>
</template>
