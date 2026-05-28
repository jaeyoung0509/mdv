import type { WritingSelection } from "./types";

export function countWords(value: string): number {
  const words = value.match(/[\p{L}\p{N}_'-]+/gu);
  return words?.length ?? 0;
}

export function firstMeaningfulLine(value: string, fallback: string): string {
  return (
    value
      .split(/\r?\n/)
      .map((line) => line.replace(/^#+\s*/, "").trim())
      .find(Boolean) ?? fallback
  );
}

export function emptyWritingSelection(): WritingSelection {
  return {
    text: "",
    from: null,
    to: null,
    fromLine: null,
    toLine: null,
  };
}
