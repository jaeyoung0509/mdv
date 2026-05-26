export type AppTheme = "light" | "dark" | "system";

export type EffectiveTheme = "light" | "dark";

export type FontPreset = "sans" | "serif" | "mono";

export interface ReaderPreferences {
  theme: AppTheme;
  fontPreset: FontPreset;
  fontSize: number;
  lineHeight: number;
  contentWidth: number;
  outlineVisible: boolean;
  bookmarks: Record<string, ReaderBookmark[]>;
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

export type AiProviderKind = "openaiCompatible" | "claude";

export interface AiProvider {
  id: string;
  name: string;
  kind: AiProviderKind;
  baseUrl: string;
  model: string;
  reasoning: string;
  // TODO: Move API keys back to OS secure storage once desktop keychain persistence is reliable.
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
  usage?: unknown;
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

export interface DocumentPayload {
  path: string;
  fileName: string;
  directory: string;
  content: string;
  watching: boolean;
}

export interface DirectoryDocument {
  path: string;
  fileName: string;
  directory: string;
}

export interface MdvError {
  kind: string;
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
