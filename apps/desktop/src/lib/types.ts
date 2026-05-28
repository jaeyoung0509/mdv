export type AppTheme = "light" | "dark" | "system";

export type EffectiveTheme = "light" | "dark";

export type FontPreset = "sans" | "serif" | "mono";

export type EditorMode = "read" | "write";

export type WritingSurfaceMode = "live" | "source";

export type AiPanelMode = "ask" | "write";

export type AiWriteApplyAction = "insert" | "replace" | "append";

export type SaveStatus = "idle" | "dirty" | "saving" | "saved" | "conflict" | "error";

export type MdvErrorKind =
  | "AiApiKeyMissing"
  | "AiNetworkError"
  | "AiProviderError"
  | "AiProviderNotFound"
  | "ApplicationError"
  | "DocumentConflict"
  | "FileNotFound"
  | "InvalidAiPrompt"
  | "InvalidAiProvider"
  | "NoMarkdownFiles"
  | "PreferencesError"
  | "PreviewMode"
  | "ReloadError"
  | "UnknownError"
  | (string & {});

export interface ReaderPreferences {
  theme: AppTheme;
  fontPreset: FontPreset;
  fontSize: number;
  lineHeight: number;
  contentWidth: number;
  outlineVisible: boolean;
  bookmarks: Record<string, ReaderBookmark[]>;
  aiNotes: Record<string, AiNoteThread[]>;
  ai: AiSettings;
}

export type BookmarkTarget =
  | {
      kind: "heading";
      headingId: string;
      scrollYFallback: number;
    }
  | {
      kind: "offset";
      scrollY: number;
    };

export interface ReaderBookmark {
  id: string;
  label: string;
  target: BookmarkTarget;
  createdAt: number;
}

export type AiNoteAnchor =
  | {
      kind: "heading";
      headingId: string;
      label: string;
      scrollYFallback: number;
    }
  | {
      kind: "lineRange";
      fromLine: number;
      toLine: number;
      label: string;
    }
  | {
      kind: "offset";
      scrollY: number;
      label: string;
    };

export interface AiNoteMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: number;
}

export interface AiNoteThread {
  id: string;
  anchor: AiNoteAnchor;
  title: string;
  messages: AiNoteMessage[];
  resolved: boolean;
  createdAt: number;
  updatedAt: number;
}

export type AiProviderKind = "openaiCompatible" | "claude";

export interface AiProvider {
  id: string;
  name: string;
  kind: AiProviderKind;
  baseUrl: string;
  model: string;
  reasoning: string;
  apiKey: string;
  hasApiKey: boolean;
}

export interface AiSettings {
  activeProviderId: string;
  providers: AiProvider[];
}

export interface AiContextItem {
  kind: "selection" | "file" | "documentExcerpt";
  label: string;
  text: string;
}

export interface AiChatRequest {
  providerId: string;
  mode?: AiPanelMode;
  prompt: string;
  contextItems: AiContextItem[];
  conversationId?: string;
}

export interface AiStreamEvent {
  runId: string;
  delta: string;
}

export interface AiCompleteEvent {
  runId: string;
  usage?: AiUsage;
}

export interface AiErrorEvent {
  runId: string;
  message: string;
  details?: string;
}

export interface OutlineHeading {
  id: string;
  level: number;
  text: string;
}

export interface WritingSelection {
  text: string;
  from: number | null;
  to: number | null;
  fromLine: number | null;
  toLine: number | null;
}

export interface AiUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  [key: string]: unknown;
}

export interface DocumentPayload {
  path: string;
  fileName: string;
  directory: string;
  content: string;
  watching: boolean;
  modifiedMillis: number | null;
}

export interface DirectoryDocument {
  path: string;
  fileName: string;
  directory: string;
}

export interface MdvError {
  kind: MdvErrorKind;
  message: string;
  path?: string;
  cwd?: string;
  details?: string;
}

export interface InitialState {
  preferences: ReaderPreferences;
  watch: boolean;
  allowHtml: boolean;
  document: DocumentPayload | null;
  error: MdvError | null;
}
