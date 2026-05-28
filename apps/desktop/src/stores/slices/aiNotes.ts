import type { AiNoteAnchor, AiNoteMessage, AiNoteThread, OutlineHeading, ReaderPreferences } from "../../lib/types";
import { firstMeaningfulLine } from "../../lib/text";
import type { AppState } from "../appState";

function newId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function getCurrentHeading(headings: OutlineHeading[]): OutlineHeading | null {
  let currentHeading = headings[0] ?? null;

  for (const heading of headings) {
    const element = window.document.getElementById(heading.id);

    if (!element) {
      continue;
    }

    if (element.getBoundingClientRect().top <= 140) {
      currentHeading = heading;
      continue;
    }

    break;
  }

  return currentHeading;
}

export function createAiNotesSlice(
  state: AppState,
  updatePreferences: (updater: (current: ReaderPreferences) => ReaderPreferences) => void,
) {
  function currentAnchor(): AiNoteAnchor {
    const selection = state.writingSelection.value;

    if (
      state.editorMode.value === "write" &&
      state.writingSurfaceMode.value === "source" &&
      selection.fromLine &&
      selection.toLine
    ) {
      return {
        kind: "lineRange",
        fromLine: selection.fromLine,
        toLine: selection.toLine,
        label:
          selection.fromLine === selection.toLine
            ? `Line ${selection.fromLine}`
            : `Lines ${selection.fromLine}-${selection.toLine}`,
      };
    }

    const heading = getCurrentHeading(state.headings.value);

    if (heading) {
      const element = window.document.getElementById(heading.id);
      const scrollYFallback = Math.max(
        0,
        Math.round((element?.getBoundingClientRect().top ?? 0) + window.scrollY),
      );

      return {
        kind: "heading",
        headingId: heading.id,
        label: heading.text,
        scrollYFallback,
      };
    }

    return {
      kind: "offset",
      scrollY: Math.max(0, Math.round(window.scrollY)),
      label: state.document.value?.fileName ?? "Document",
    };
  }

  function addAiNoteThread(options: {
    anchor?: AiNoteAnchor;
    prompt?: string;
    answer: string;
    title?: string;
  }): AiNoteThread | null {
    if (!state.document.value || !options.answer.trim()) {
      return null;
    }

    const createdAt = Date.now();
    const prompt = options.prompt?.trim() || state.aiLastPrompt.value.trim();
    const messages: AiNoteMessage[] = [];

    if (prompt) {
      messages.push({
        id: newId("note-user"),
        role: "user",
        content: prompt,
        createdAt,
      });
    }

    messages.push({
      id: newId("note-assistant"),
      role: "assistant",
      content: options.answer.trim(),
      createdAt,
    });

    const anchor = options.anchor ?? currentAnchor();
    const thread: AiNoteThread = {
      id: newId("note"),
      anchor,
      title: options.title?.trim() || firstMeaningfulLine(options.answer, anchor.label),
      messages,
      resolved: false,
      createdAt,
      updatedAt: createdAt,
    };
    const documentPath = state.document.value.path;

    updatePreferences((current) => ({
      ...current,
      aiNotes: {
        ...current.aiNotes,
        [documentPath]: [thread, ...(current.aiNotes[documentPath] ?? [])].slice(0, 80),
      },
    }));

    return thread;
  }

  function attachAiAnswerAsNote() {
    addAiNoteThread({
      answer: state.aiAnswer.value,
      prompt: state.aiLastPrompt.value,
    });
  }

  function removeAiNote(noteId: string) {
    if (!state.document.value) {
      return;
    }

    const documentPath = state.document.value.path;

    updatePreferences((current) => {
      const notes = (current.aiNotes[documentPath] ?? []).filter((note) => note.id !== noteId);
      const aiNotes = { ...current.aiNotes };

      if (notes.length > 0) {
        aiNotes[documentPath] = notes;
      } else {
        delete aiNotes[documentPath];
      }

      return { ...current, aiNotes };
    });
  }

  function setAiNoteResolved(noteId: string, resolved: boolean) {
    if (!state.document.value) {
      return;
    }

    const documentPath = state.document.value.path;

    updatePreferences((current) => ({
      ...current,
      aiNotes: {
        ...current.aiNotes,
        [documentPath]: (current.aiNotes[documentPath] ?? []).map((note) =>
          note.id === noteId ? { ...note, resolved, updatedAt: Date.now() } : note,
        ),
      },
    }));
  }

  function selectAiNote(note: AiNoteThread) {
    if (note.anchor.kind === "heading") {
      const heading = window.document.getElementById(note.anchor.headingId);

      if (heading) {
        heading.scrollIntoView({ behavior: "smooth", block: "start" });
        window.history.replaceState(null, "", `#${note.anchor.headingId}`);
        return;
      }

      window.scrollTo({ top: note.anchor.scrollYFallback, behavior: "smooth" });
      return;
    }

    if (note.anchor.kind === "offset") {
      window.scrollTo({ top: note.anchor.scrollY, behavior: "smooth" });
    }
  }

  return {
    addAiNoteThread,
    attachAiAnswerAsNote,
    removeAiNote,
    selectAiNote,
    setAiNoteResolved,
  };
}
