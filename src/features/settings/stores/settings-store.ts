import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { MediaTranscriptModel, MediaTranscriptQuantization } from '@/types/storage';
import {
  DEFAULT_WHISPER_LANGUAGE,
  DEFAULT_WHISPER_MODEL,
  DEFAULT_WHISPER_QUANTIZATION,
  normalizeSelectableWhisperModel,
} from '@/shared/utils/whisper-settings';
import type { EditorDensityPresetName } from '@/app/editor-layout';
import { DEFAULT_EDITOR_DENSITY_PRESET } from '@/app/editor-layout';
import {
  HOTKEYS,
  normalizeHotkeyBinding,
  sanitizeHotkeyOverrides,
  type HotkeyKey,
  type HotkeyOverrideMap,
} from '@/config/hotkeys';

/**
 * App-wide settings stored in localStorage
 */
interface AppSettings {
  // Timeline defaults
  snapEnabled: boolean;
  showWaveforms: boolean;
  showFilmstrips: boolean;

  // Interface
  editorDensity: EditorDensityPresetName;

  // Performance
  maxUndoHistory: number;
  autoSaveInterval: number; // minutes (0 = disabled)

  // Whisper defaults
  defaultWhisperModel: MediaTranscriptModel;
  defaultWhisperQuantization: MediaTranscriptQuantization;
  defaultWhisperLanguage: string;

  // AI captioning — interval between sampled frames when running LFM captions.
  // Frames mode is converted to seconds at capture time using media.fps.
  captioningIntervalUnit: CaptioningIntervalUnit;
  captioningIntervalValue: number;

  // Scene Browser — how caption search matches queries. `semantic` uses a
  // sentence-transformer model to rank by meaning; `keyword` uses
  // substring + fuzzy-prefix matching on caption text.
  captionSearchMode: CaptionSearchMode;

  // Keyboard shortcuts
  hotkeyOverrides: HotkeyOverrideMap;
}

export type CaptionSearchMode = 'keyword' | 'semantic';

function normalizeCaptionSearchMode(value: unknown): CaptionSearchMode {
  return value === 'semantic' ? 'semantic' : 'keyword';
}

export type CaptioningIntervalUnit = 'seconds' | 'frames';

export const CAPTIONING_INTERVAL_BOUNDS = {
  seconds: { min: 0.5, max: 60 },
  frames: { min: 1, max: 1800 },
} as const;

export const DEFAULT_CAPTIONING_INTERVAL_SECONDS = 3;

function normalizeCaptioningIntervalUnit(value: unknown): CaptioningIntervalUnit {
  return value === 'frames' ? 'frames' : 'seconds';
}

function clampCaptioningIntervalValue(
  value: unknown,
  unit: CaptioningIntervalUnit,
): number {
  const bounds = CAPTIONING_INTERVAL_BOUNDS[unit];
  const fallback = unit === 'seconds' ? DEFAULT_CAPTIONING_INTERVAL_SECONDS : 90;
  const numeric = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return Math.min(bounds.max, Math.max(bounds.min, numeric));
}

/**
 * Derive the effective `sampleIntervalSec` to pass to the captioning provider.
 * Frames mode divides by the source media FPS (falling back to 30 when the
 * media reports no usable frame rate).
 */
export function resolveCaptioningIntervalSec(
  unit: CaptioningIntervalUnit,
  value: number,
  fps: number,
): number {
  if (unit === 'seconds') return value;
  const effectiveFps = fps > 0 ? fps : 30;
  return value / effectiveFps;
}

interface SettingsActions {
  setSetting: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
  setHotkeyBinding: (key: HotkeyKey, binding: string) => void;
  replaceHotkeyOverrides: (overrides: HotkeyOverrideMap) => void;
  resetHotkeyBinding: (key: HotkeyKey) => void;
  resetHotkeys: () => void;
  resetToDefaults: () => void;
}

type SettingsStore = AppSettings & SettingsActions;

function areHotkeyOverridesEqual(
  left: HotkeyOverrideMap,
  right: HotkeyOverrideMap
): boolean {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);

  if (leftKeys.length !== rightKeys.length) {
    return false;
  }

  return leftKeys.every((key) => left[key as HotkeyKey] === right[key as HotkeyKey]);
}

const DEFAULT_SETTINGS: AppSettings = {
  // Timeline defaults
  snapEnabled: true,
  showWaveforms: true,
  showFilmstrips: true,

  // Interface
  editorDensity: DEFAULT_EDITOR_DENSITY_PRESET,

  // Performance
  maxUndoHistory: 50,
  autoSaveInterval: 0, // Auto-save disabled by default

  // Whisper defaults
  defaultWhisperModel: DEFAULT_WHISPER_MODEL,
  defaultWhisperQuantization: DEFAULT_WHISPER_QUANTIZATION,
  defaultWhisperLanguage: DEFAULT_WHISPER_LANGUAGE,

  // AI captioning defaults
  captioningIntervalUnit: 'seconds',
  captioningIntervalValue: DEFAULT_CAPTIONING_INTERVAL_SECONDS,

  // Scene Browser defaults
  captionSearchMode: 'keyword',

  // Keyboard shortcuts
  hotkeyOverrides: {},
};

/**
 * Settings store with localStorage persistence.
 *
 * Usage:
 *   const theme = useSettingsStore(s => s.theme);
 *   const setSetting = useSettingsStore(s => s.setSetting);
 *   setSetting('theme', 'light');
 */
export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set) => ({
      ...DEFAULT_SETTINGS,

      setSetting: (key, value) => set((state) => {
        if (key === 'defaultWhisperModel') {
          return { [key]: normalizeSelectableWhisperModel(value as MediaTranscriptModel) };
        }
        if (key === 'captioningIntervalUnit') {
          const unit = normalizeCaptioningIntervalUnit(value);
          return {
            captioningIntervalUnit: unit,
            captioningIntervalValue: clampCaptioningIntervalValue(state.captioningIntervalValue, unit),
          };
        }
        if (key === 'captioningIntervalValue') {
          return {
            captioningIntervalValue: clampCaptioningIntervalValue(value, state.captioningIntervalUnit),
          };
        }
        return { [key]: value };
      }),

      setHotkeyBinding: (key, binding) => set((state) => {
        const normalizedBinding = normalizeHotkeyBinding(binding);
        if (!normalizedBinding || normalizedBinding === HOTKEYS[key]) {
          if (!(key in state.hotkeyOverrides)) {
            return state;
          }

          const remainingOverrides = { ...state.hotkeyOverrides };
          delete remainingOverrides[key];
          return { hotkeyOverrides: remainingOverrides };
        }

        if (state.hotkeyOverrides[key] === normalizedBinding) {
          return state;
        }

        return {
          hotkeyOverrides: {
            ...state.hotkeyOverrides,
            [key]: normalizedBinding,
          },
        };
      }),

      replaceHotkeyOverrides: (overrides) => set((state) => {
        const normalizedOverrides = sanitizeHotkeyOverrides(overrides);

        if (areHotkeyOverridesEqual(state.hotkeyOverrides, normalizedOverrides)) {
          return state;
        }

        return { hotkeyOverrides: normalizedOverrides };
      }),

      resetHotkeyBinding: (key) => set((state) => {
        if (!(key in state.hotkeyOverrides)) {
          return state;
        }

        const remainingOverrides = { ...state.hotkeyOverrides };
        delete remainingOverrides[key];
        return { hotkeyOverrides: remainingOverrides };
      }),

      resetHotkeys: () => set((state) => {
        if (Object.keys(state.hotkeyOverrides).length === 0) {
          return state;
        }

        return { hotkeyOverrides: {} };
      }),

      resetToDefaults: () => set(DEFAULT_SETTINGS),
    }),
    {
      name: 'freecut-settings',
      merge: (persistedState, currentState) => {
        const typedState = (persistedState as Partial<AppSettings> | undefined) ?? {};
        const captioningIntervalUnit = normalizeCaptioningIntervalUnit(typedState.captioningIntervalUnit);

        return {
          ...currentState,
          ...typedState,
          defaultWhisperModel: normalizeSelectableWhisperModel(typedState.defaultWhisperModel),
          hotkeyOverrides: sanitizeHotkeyOverrides(typedState.hotkeyOverrides),
          captioningIntervalUnit,
          captioningIntervalValue: clampCaptioningIntervalValue(
            typedState.captioningIntervalValue,
            captioningIntervalUnit,
          ),
          captionSearchMode: normalizeCaptionSearchMode(typedState.captionSearchMode),
        };
      },
    }
  )
);
