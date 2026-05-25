export type AppTheme = "light" | "dark" | "system";

export type EffectiveTheme = "light" | "dark";

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
  theme: AppTheme;
  watch: boolean;
  allowHtml: boolean;
  document: DocumentPayload | null;
  error: MdvError | null;
}
