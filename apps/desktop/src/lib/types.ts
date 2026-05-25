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
