// @vitest-environment node

import { describe, expect, it, beforeEach } from 'vite-plus/test'
import { useSettingsStore } from './settings-store'

const DEFAULT_SETTINGS = {
  snapEnabled: true,
  showWaveforms: true,
  showFilmstrips: true,
  enableFilmstripExtraction: true,
  editorDensity: 'compact' as const,
  maxUndoHistory: 50,
  autoSaveInterval: 5,
  defaultWhisperModel: 'parakeet-tdt-v3' as const,
  defaultWhisperQuantization: 'hybrid' as const,
  defaultWhisperLanguage: '',
}

describe('settings-store', () => {
  beforeEach(() => {
    useSettingsStore.getState().resetToDefaults()
  })

  describe('setSetting', () => {
    it('updates boolean settings', () => {
      useSettingsStore.getState().setSetting('snapEnabled', false)
      expect(useSettingsStore.getState().snapEnabled).toBe(false)
    })

    it('persists the guided-tour seen flag', () => {
      useSettingsStore.getState().setSetting('hasSeenGuide', true)
      expect(useSettingsStore.getState().hasSeenGuide).toBe(true)
    })

    it('updates string settings', () => {
      useSettingsStore.getState().setSetting('defaultWhisperLanguage', 'en')
      expect(useSettingsStore.getState().defaultWhisperLanguage).toBe('en')
    })

    it('normalizes removed editor density presets back to compact', () => {
      useSettingsStore.getState().setSetting('editorDensity', 'default' as never)

      expect(useSettingsStore.getState().editorDensity).toBe('compact')
    })

    it('updates whisper defaults', () => {
      useSettingsStore.getState().setSetting('defaultWhisperModel', 'whisper-small')
      useSettingsStore.getState().setSetting('defaultWhisperQuantization', 'q8')

      expect(useSettingsStore.getState().defaultWhisperModel).toBe('whisper-small')
      expect(useSettingsStore.getState().defaultWhisperQuantization).toBe('q8')
    })

    it('normalizes legacy tiny model selections back to the default model', () => {
      useSettingsStore.getState().setSetting('defaultWhisperModel', 'whisper-tiny')

      expect(useSettingsStore.getState().defaultWhisperModel).toBe('parakeet-tdt-v3')
    })

    it('updates auto-save interval', () => {
      useSettingsStore.getState().setSetting('autoSaveInterval', 5)
      expect(useSettingsStore.getState().autoSaveInterval).toBe(5)
    })

    it('does not affect other settings when changing one', () => {
      useSettingsStore.getState().setSetting('snapEnabled', false)
      expect(useSettingsStore.getState().showWaveforms).toBe(true)
      expect(useSettingsStore.getState().editorDensity).toBe('compact')
    })
  })

  describe('resetToDefaults', () => {
    it('restores all settings to defaults', () => {
      // Change several settings
      useSettingsStore.getState().setSetting('snapEnabled', false)
      useSettingsStore.getState().setSetting('autoSaveInterval', 10)
      useSettingsStore.getState().setSetting('defaultWhisperModel', 'whisper-large')
      useSettingsStore.getState().setSetting('defaultWhisperLanguage', 'es')

      // Reset
      useSettingsStore.getState().resetToDefaults()

      const state = useSettingsStore.getState()
      expect(state.snapEnabled).toBe(DEFAULT_SETTINGS.snapEnabled)
      expect(state.editorDensity).toBe(DEFAULT_SETTINGS.editorDensity)
      expect(state.autoSaveInterval).toBe(DEFAULT_SETTINGS.autoSaveInterval)
      expect(state.defaultWhisperModel).toBe(DEFAULT_SETTINGS.defaultWhisperModel)
      expect(state.defaultWhisperLanguage).toBe(DEFAULT_SETTINGS.defaultWhisperLanguage)
    })
  })

  describe('replaceHotkeyOverrides', () => {
    it('unassigns hotkeys with explicit blank overrides', () => {
      useSettingsStore.getState().unbindHotkeyBinding('DELETE_SELECTED')

      expect(useSettingsStore.getState().hotkeyOverrides).toEqual({
        DELETE_SELECTED: '',
      })
    })

    it('replaces hotkey overrides with a sanitized imported preset', () => {
      useSettingsStore.getState().setHotkeyBinding('PLAY_PAUSE', 'shift+space')

      useSettingsStore.getState().replaceHotkeyOverrides({
        EXPORT: 'Ctrl+E',
        PLAY_PAUSE: 'space',
        DELETE_SELECTED: '',
        UNKNOWN_COMMAND: 'q',
      } as never)

      expect(useSettingsStore.getState().hotkeyOverrides).toEqual({
        EXPORT: 'mod+e',
        DELETE_SELECTED: '',
      })
    })

    it('does not update state for equivalent overrides with different key order', () => {
      useSettingsStore.getState().replaceHotkeyOverrides({
        PLAY_PAUSE: 'shift+space',
        EXPORT: 'ctrl+e',
      })

      const previousState = useSettingsStore.getState()

      useSettingsStore.getState().replaceHotkeyOverrides({
        EXPORT: 'ctrl+e',
        PLAY_PAUSE: 'shift+space',
      })

      expect(useSettingsStore.getState()).toBe(previousState)
    })
  })
})
