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

/**
 * App-wide settings stored in localStorage
 */
interface AppSettings {
  // Timeline defaults
  defaultFps: number;
  snapEnabled: boolean;
  showWaveforms: boolean;
  showFilmstrips: boolean;

  // Preview
  previewQuality: 'low' | 'medium' | 'high';
  editorDensity: EditorDensityPresetName;

  // Export defaults
  defaultExportFormat: 'mp4' | 'webm';
  defaultExportQuality: 'low' | 'medium' | 'high' | 'ultra';

  // Performance
  maxUndoHistory: number;
  autoSaveInterval: number; // minutes (0 = disabled)

  // Whisper defaults
  defaultWhisperModel: MediaTranscriptModel;
  defaultWhisperQuantization: MediaTranscriptQuantization;
  defaultWhisperLanguage: string;
}

interface SettingsActions {
  setSetting: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
  resetToDefaults: () => void;
}

type SettingsStore = AppSettings & SettingsActions;

const DEFAULT_SETTINGS: AppSettings = {
  // Timeline defaults
  defaultFps: 30,
  snapEnabled: true,
  showWaveforms: true,
  showFilmstrips: true,

  // Preview
  previewQuality: 'high',
  editorDensity: DEFAULT_EDITOR_DENSITY_PRESET,

  // Export defaults
  defaultExportFormat: 'mp4',
  defaultExportQuality: 'high',

  // Performance
  maxUndoHistory: 50,
  autoSaveInterval: 0, // Auto-save disabled by default

  // Whisper defaults
  defaultWhisperModel: DEFAULT_WHISPER_MODEL,
  defaultWhisperQuantization: DEFAULT_WHISPER_QUANTIZATION,
  defaultWhisperLanguage: DEFAULT_WHISPER_LANGUAGE,
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

      resetToDefaults: () => set(DEFAULT_SETTINGS),
    }),
    {
      name: 'freecut-settings',
    }
  )
);
