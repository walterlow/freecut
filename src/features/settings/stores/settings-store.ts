import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { MediaTranscriptModel, MediaTranscriptQuantization } from '@/types/storage';
import {
  DEFAULT_WHISPER_LANGUAGE,
  DEFAULT_WHISPER_MODEL,
  DEFAULT_WHISPER_QUANTIZATION,
} from '@/shared/utils/whisper-settings';
import type { EditorDensityPresetName } from '@/shared/ui/editor-layout';
import { DEFAULT_EDITOR_DENSITY_PRESET } from '@/shared/ui/editor-layout';
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

  // Keyboard shortcuts
  hotkeyOverrides: HotkeyOverrideMap;
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

      setSetting: (key, value) => set({ [key]: value }),

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

        return {
          ...currentState,
          ...typedState,
          hotkeyOverrides: sanitizeHotkeyOverrides(typedState.hotkeyOverrides),
        };
      },
    }
  )
);
