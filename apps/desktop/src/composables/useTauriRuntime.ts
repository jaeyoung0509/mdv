import type { MdvError } from "../lib/types";

export function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function toMdvError(reason: unknown, message: string): MdvError {
  if (
    reason &&
    typeof reason === "object" &&
    "kind" in reason &&
    "message" in reason
  ) {
    return reason as MdvError;
  }

  return {
    kind: "ApplicationError",
    message,
    details: reason instanceof Error ? reason.message : String(reason),
  };
}
