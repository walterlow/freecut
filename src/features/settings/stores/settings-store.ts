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
import {
  DEFAULT_PROXY_GENERATION_MODE,
  DEFAULT_PROXY_GENERATION_RESOLUTION,
  normalizeProxyGenerationMode,
  normalizeProxyGenerationResolution,
  type ProxyGenerationMode,
  type ProxyGenerationResolution,
} from '@/config/proxy-generation';

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

  // Proxy generation defaults
  proxyGenerationMode: ProxyGenerationMode;
  proxyGenerationResolution: ProxyGenerationResolution;
  proxyRecommendedMediaIds: string[];

  // Whisper defaults
  defaultWhisperModel: MediaTranscriptModel;
  defaultWhisperQuantization: MediaTranscriptQuantization;
  defaultWhisperLanguage: string;

  // Keyboard shortcuts
  hotkeyOverrides: HotkeyOverrideMap;
}

interface SettingsActions {
  setSetting: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
  markProxyRecommended: (mediaId: string) => void;
  clearProxyRecommended: (mediaId: string) => void;
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

function sanitizeProxyRecommendedMediaIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const uniqueIds = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== 'string') {
      continue;
    }

    const trimmed = entry.trim();
    if (!trimmed) {
      continue;
    }

    uniqueIds.add(trimmed);
    if (uniqueIds.size >= 200) {
      break;
    }
  }

  return [...uniqueIds];
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

  // Proxy generation defaults
  proxyGenerationMode: DEFAULT_PROXY_GENERATION_MODE,
  proxyGenerationResolution: DEFAULT_PROXY_GENERATION_RESOLUTION,
  proxyRecommendedMediaIds: [],

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

      markProxyRecommended: (mediaId) => set((state) => {
        const normalized = mediaId.trim();
        if (!normalized || state.proxyRecommendedMediaIds.includes(normalized)) {
          return state;
        }

        return {
          proxyRecommendedMediaIds: sanitizeProxyRecommendedMediaIds([
            normalized,
            ...state.proxyRecommendedMediaIds,
          ]),
        };
      }),

      clearProxyRecommended: (mediaId) => set((state) => {
        const normalized = mediaId.trim();
        if (!normalized || !state.proxyRecommendedMediaIds.includes(normalized)) {
          return state;
        }

        return {
          proxyRecommendedMediaIds: state.proxyRecommendedMediaIds.filter((id) => id !== normalized),
        };
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

        return {
          ...currentState,
          ...typedState,
          proxyGenerationMode: normalizeProxyGenerationMode(typedState.proxyGenerationMode),
          proxyGenerationResolution: normalizeProxyGenerationResolution(
            typedState.proxyGenerationResolution
          ),
          proxyRecommendedMediaIds: sanitizeProxyRecommendedMediaIds(
            typedState.proxyRecommendedMediaIds
          ),
          hotkeyOverrides: sanitizeHotkeyOverrides(typedState.hotkeyOverrides),
        };
      },
    }
  )
);
