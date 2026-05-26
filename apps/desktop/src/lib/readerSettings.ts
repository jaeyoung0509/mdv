import { FONT_PRESET_STACKS } from "./preferences";
import type { ReaderPreferences } from "./types";

type ReaderStyleProperties = Record<`--${string}`, string>;

export function getReaderStyleProperties(preferences: ReaderPreferences): ReaderStyleProperties {
  return {
    "--reader-font-family": FONT_PRESET_STACKS[preferences.fontPreset],
    "--reader-font-size": `${preferences.fontSize}px`,
    "--reader-line-height": String(preferences.lineHeight),
    "--reader-width": `${preferences.contentWidth}px`,
  };
}
