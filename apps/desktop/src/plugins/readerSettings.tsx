import type { CSSProperties, ReactNode } from "react";
import {
  AlignVerticalSpaceAround,
  Baseline,
  Columns3,
  Monitor,
  Moon,
  PanelLeft,
  Sun,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { FONT_PRESET_LABELS, FONT_PRESET_STACKS } from "../lib/preferences";
import type { AppTheme, FontPreset, ReaderPreferences } from "../lib/types";

type ReaderStyleProperties = CSSProperties & Record<`--${string}`, string>;

export interface ReaderSettingsPluginContext {
  preferences: ReaderPreferences;
  onChange: (patch: Partial<ReaderPreferences>) => void;
}

export interface ReaderSettingsPlugin {
  id: string;
  title: string;
  getReaderStyle?: (preferences: ReaderPreferences) => ReaderStyleProperties;
  renderSettings: (context: ReaderSettingsPluginContext) => ReactNode;
}

const themeOptions: Array<{ value: AppTheme; label: string; icon: LucideIcon }> = [
  { value: "system", label: "System", icon: Monitor },
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
];

const fontOptions: FontPreset[] = ["sans", "serif", "mono"];

function SettingsSection({
  icon: Icon,
  label,
  children,
}: {
  icon: LucideIcon;
  label: string;
  children: ReactNode;
}) {
  return (
    <section className="settings-section">
      <div className="settings-label">
        <Icon size={13} aria-hidden="true" />
        {label}
      </div>
      {children}
    </section>
  );
}

function RangeControl({
  icon,
  label,
  value,
  output,
  min,
  max,
  step,
  onChange,
}: {
  icon: LucideIcon;
  label: string;
  value: number;
  output: string;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  const Icon = icon;

  return (
    <label className="range-control">
      <span>
        <span className="settings-label">
          <Icon size={13} aria-hidden="true" />
          {label}
        </span>
        <output>{output}</output>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
      />
    </label>
  );
}

export const readerSettingsPlugins: ReaderSettingsPlugin[] = [
  {
    id: "appearance.theme",
    title: "Theme",
    renderSettings: ({ preferences, onChange }) => (
      <SettingsSection icon={Monitor} label="Theme">
        <div className="segmented-control segmented-control--icons">
          {themeOptions.map((option) => {
            const Icon = option.icon;

            return (
              <button
                key={option.value}
                type="button"
                aria-pressed={preferences.theme === option.value}
                title={option.label}
                onClick={() => onChange({ theme: option.value })}
              >
                <Icon size={15} aria-hidden="true" />
                <span>{option.label}</span>
              </button>
            );
          })}
        </div>
      </SettingsSection>
    ),
  },
  {
    id: "typography.font",
    title: "Typography",
    getReaderStyle: (preferences) =>
      ({
        "--reader-font-family": FONT_PRESET_STACKS[preferences.fontPreset],
        "--reader-font-size": `${preferences.fontSize}px`,
        "--reader-line-height": String(preferences.lineHeight),
      }) as ReaderStyleProperties,
    renderSettings: ({ preferences, onChange }) => (
      <>
        <SettingsSection icon={Baseline} label="Font">
          <div className="segmented-control">
            {fontOptions.map((fontPreset) => (
              <button
                key={fontPreset}
                type="button"
                aria-pressed={preferences.fontPreset === fontPreset}
                onClick={() => onChange({ fontPreset })}
              >
                {FONT_PRESET_LABELS[fontPreset]}
              </button>
            ))}
          </div>
        </SettingsSection>

        <RangeControl
          icon={Baseline}
          label="Size"
          min={14}
          max={22}
          step={1}
          value={preferences.fontSize}
          output={`${preferences.fontSize}px`}
          onChange={(fontSize) => onChange({ fontSize })}
        />

        <RangeControl
          icon={AlignVerticalSpaceAround}
          label="Line"
          min={1.45}
          max={1.95}
          step={0.05}
          value={preferences.lineHeight}
          output={preferences.lineHeight.toFixed(2)}
          onChange={(lineHeight) => onChange({ lineHeight })}
        />
      </>
    ),
  },
  {
    id: "layout.measure",
    title: "Layout",
    getReaderStyle: (preferences) =>
      ({
        "--reader-width": `${preferences.contentWidth}px`,
      }) as ReaderStyleProperties,
    renderSettings: ({ preferences, onChange }) => (
      <>
        <RangeControl
          icon={Columns3}
          label="Width"
          min={680}
          max={960}
          step={20}
          value={preferences.contentWidth}
          output={`${preferences.contentWidth}px`}
          onChange={(contentWidth) => onChange({ contentWidth })}
        />

        <SettingsSection icon={PanelLeft} label="Navigation">
          <label className="toggle-control">
            <input
              type="checkbox"
              checked={preferences.outlineVisible}
              onChange={(event) => onChange({ outlineVisible: event.currentTarget.checked })}
            />
            <span>Show outline</span>
          </label>
        </SettingsSection>
      </>
    ),
  },
];

export function getReaderStyleProperties(preferences: ReaderPreferences): CSSProperties {
  return readerSettingsPlugins.reduce<CSSProperties>(
    (style, plugin) => ({
      ...style,
      ...plugin.getReaderStyle?.(preferences),
    }),
    {},
  );
}
