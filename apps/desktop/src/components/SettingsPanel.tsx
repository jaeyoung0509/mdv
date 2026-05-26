import { RotateCcw, X } from "lucide-react";
import { AiSettingsSection } from "./AiSettingsSection";
import { readerSettingsPlugins } from "../plugins/readerSettings";
import type { AiSettings, ReaderPreferences } from "../lib/types";

interface SettingsPanelProps {
  open: boolean;
  preferences: ReaderPreferences;
  onChange: (patch: Partial<ReaderPreferences>) => void;
  onAiChange: (settings: AiSettings) => void;
  onClose: () => void;
  onReset: () => void;
}

export function SettingsPanel({
  open,
  preferences,
  onChange,
  onAiChange,
  onClose,
  onReset,
}: SettingsPanelProps) {
  if (!open) {
    return null;
  }

  return (
    <aside className="settings-panel" aria-label="Settings">
      <div className="panel-header">
        <h2>Settings</h2>
        <button type="button" className="icon-button" title="Close settings" onClick={onClose}>
          <X size={16} aria-hidden="true" />
        </button>
      </div>

      {readerSettingsPlugins.map((plugin) => (
        <div key={plugin.id} className="settings-plugin" data-plugin={plugin.id}>
          {plugin.renderSettings({ preferences, onChange })}
        </div>
      ))}

      <div className="settings-plugin" data-plugin="ai">
        <AiSettingsSection settings={preferences.ai} onChange={onAiChange} />
      </div>

      <button type="button" className="reset-button" onClick={onReset}>
        <RotateCcw size={15} aria-hidden="true" />
        Reset
      </button>
    </aside>
  );
}
