import { FileUp } from "lucide-react";

interface FileDropOverlayProps {
  active: boolean;
}

export function FileDropOverlay({ active }: FileDropOverlayProps) {
  if (!active) {
    return null;
  }

  return (
    <div className="drop-overlay" role="status" aria-live="polite">
      <div className="drop-overlay__panel">
        <FileUp size={24} aria-hidden="true" />
        <span>Drop Markdown to open</span>
      </div>
    </div>
  );
}
