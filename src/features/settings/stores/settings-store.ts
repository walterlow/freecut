import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * App-wide settings stored in localStorage
 */
export interface AppSettings {
  // Timeline defaults
  defaultFps: number;
  snapEnabled: boolean;
  showWaveforms: boolean;
  showFilmstrips: boolean;

  // Preview
  previewQuality: 'low' | 'medium' | 'high';

  // Export defaults
  defaultExportFormat: 'mp4' | 'webm';
  defaultExportQuality: 'low' | 'medium' | 'high' | 'ultra';

  // Performance
  maxUndoHistory: number;
  autoSaveInterval: number; // minutes (0 = disabled)

  // Server configuration (empty = use env var default)
  serverApiUrl: string;
  serverSocketUrl: string;
}

interface SettingsActions {
  setSetting: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
  resetToDefaults: () => void;
}

export type SettingsStore = AppSettings & SettingsActions;

const DEFAULT_SETTINGS: AppSettings = {
  // Timeline defaults
  defaultFps: 30,
  snapEnabled: true,
  showWaveforms: true,
  showFilmstrips: true,

  // Preview
  previewQuality: 'high',

  // Export defaults
  defaultExportFormat: 'mp4',
  defaultExportQuality: 'high',

  // Performance
  maxUndoHistory: 50,
  autoSaveInterval: 0, // Auto-save disabled by default

  // Server configuration (empty = use env var default)
  serverApiUrl: '',
  serverSocketUrl: '',
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

// Selectors for granular subscriptions
export const selectDefaultFps = (state: SettingsStore) => state.defaultFps;
export const selectSnapEnabled = (state: SettingsStore) => state.snapEnabled;
export const selectShowWaveforms = (state: SettingsStore) => state.showWaveforms;
export const selectShowFilmstrips = (state: SettingsStore) => state.showFilmstrips;
export const selectPreviewQuality = (state: SettingsStore) => state.previewQuality;
export const selectDefaultExportFormat = (state: SettingsStore) =>
  state.defaultExportFormat;
export const selectDefaultExportQuality = (state: SettingsStore) =>
  state.defaultExportQuality;
export const selectServerApiUrl = (state: SettingsStore) => state.serverApiUrl;
export const selectServerSocketUrl = (state: SettingsStore) => state.serverSocketUrl;
