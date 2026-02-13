import { describe, expect, it, beforeEach } from 'vitest';
import { useSettingsStore } from './settings-store';

const DEFAULT_SETTINGS = {
  defaultFps: 30,
  snapEnabled: true,
  showWaveforms: true,
  showFilmstrips: true,
  previewQuality: 'high' as const,
  defaultExportFormat: 'mp4' as const,
  defaultExportQuality: 'high' as const,
  maxUndoHistory: 50,
  autoSaveInterval: 0,
};

describe('settings-store', () => {
  beforeEach(() => {
    useSettingsStore.getState().resetToDefaults();
  });

  it('has correct default values', () => {
    const state = useSettingsStore.getState();
    expect(state.defaultFps).toBe(30);
    expect(state.snapEnabled).toBe(true);
    expect(state.showWaveforms).toBe(true);
    expect(state.showFilmstrips).toBe(true);
    expect(state.previewQuality).toBe('high');
    expect(state.defaultExportFormat).toBe('mp4');
    expect(state.defaultExportQuality).toBe('high');
    expect(state.maxUndoHistory).toBe(50);
    expect(state.autoSaveInterval).toBe(0);
  });

  describe('setSetting', () => {
    it('updates individual settings', () => {
      useSettingsStore.getState().setSetting('defaultFps', 60);
      expect(useSettingsStore.getState().defaultFps).toBe(60);
    });

    it('updates boolean settings', () => {
      useSettingsStore.getState().setSetting('snapEnabled', false);
      expect(useSettingsStore.getState().snapEnabled).toBe(false);
    });

    it('updates string settings', () => {
      useSettingsStore.getState().setSetting('previewQuality', 'low');
      expect(useSettingsStore.getState().previewQuality).toBe('low');

      useSettingsStore.getState().setSetting('defaultExportFormat', 'webm');
      expect(useSettingsStore.getState().defaultExportFormat).toBe('webm');
    });

    it('updates auto-save interval', () => {
      useSettingsStore.getState().setSetting('autoSaveInterval', 5);
      expect(useSettingsStore.getState().autoSaveInterval).toBe(5);
    });

    it('does not affect other settings when changing one', () => {
      useSettingsStore.getState().setSetting('defaultFps', 60);
      expect(useSettingsStore.getState().snapEnabled).toBe(true);
      expect(useSettingsStore.getState().previewQuality).toBe('high');
    });
  });

  describe('resetToDefaults', () => {
    it('restores all settings to defaults', () => {
      // Change several settings
      useSettingsStore.getState().setSetting('defaultFps', 60);
      useSettingsStore.getState().setSetting('snapEnabled', false);
      useSettingsStore.getState().setSetting('previewQuality', 'low');
      useSettingsStore.getState().setSetting('autoSaveInterval', 10);

      // Reset
      useSettingsStore.getState().resetToDefaults();

      const state = useSettingsStore.getState();
      expect(state.defaultFps).toBe(DEFAULT_SETTINGS.defaultFps);
      expect(state.snapEnabled).toBe(DEFAULT_SETTINGS.snapEnabled);
      expect(state.previewQuality).toBe(DEFAULT_SETTINGS.previewQuality);
      expect(state.autoSaveInterval).toBe(DEFAULT_SETTINGS.autoSaveInterval);
    });
  });
});
