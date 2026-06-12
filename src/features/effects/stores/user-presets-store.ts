import { create } from 'zustand'
import type { VisualEffect } from '@/types/effects'
import {
  readUserEffectPresets,
  saveUserEffectPresets,
  type UserEffectPreset,
} from '@/infrastructure/storage'
import { createLogger } from '@/shared/logging/logger'

const logger = createLogger('UserPresetsStore')

interface UserPresetsState {
  presets: UserEffectPreset[]
  loaded: boolean
}

interface UserPresetsActions {
  /** Load presets from the workspace (idempotent; first call wins). */
  loadPresets: () => Promise<void>
  addPreset: (name: string, effects: VisualEffect[]) => Promise<UserEffectPreset | null>
  removePreset: (presetId: string) => Promise<void>
}

/**
 * User-saved effect presets (grades), persisted to the workspace folder
 * (`app/effect-presets.json`) so they are shared across projects.
 */
export const useUserPresetsStore = create<UserPresetsState & UserPresetsActions>((set, get) => ({
  presets: [],
  loaded: false,

  loadPresets: async () => {
    if (get().loaded) return
    const presets = await readUserEffectPresets()
    set({ presets, loaded: true })
  },

  addPreset: async (name, effects) => {
    const trimmedName = name.trim()
    if (!trimmedName || effects.length === 0) return null

    const preset: UserEffectPreset = {
      id: crypto.randomUUID(),
      name: trimmedName,
      effects: effects.map((effect) => ({ ...effect, params: { ...effect.params } })),
      createdAt: Date.now(),
    }
    const presets = [...get().presets, preset]
    set({ presets, loaded: true })
    try {
      await saveUserEffectPresets(presets)
    } catch (error) {
      logger.error('Failed to persist effect preset', error)
    }
    return preset
  },

  removePreset: async (presetId) => {
    const presets = get().presets.filter((preset) => preset.id !== presetId)
    set({ presets })
    try {
      await saveUserEffectPresets(presets)
    } catch (error) {
      logger.error('Failed to persist effect preset removal', error)
    }
  },
}))
