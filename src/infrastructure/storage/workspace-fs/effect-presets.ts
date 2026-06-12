/**
 * User-saved effect presets (grades).
 *
 * Stored at `app/effect-presets.json` in the workspace — presets are
 * app-level (shared across projects) and travel with the user's workspace
 * folder like every other piece of FreeCut state.
 */

import type { VisualEffect } from '@/types/effects'
import { createLogger } from '@/shared/logging/logger'

import { requireWorkspaceRoot } from './root'
import { readJson, writeJsonAtomic } from './fs-primitives'

const logger = createLogger('WorkspaceFS:EffectPresets')

const EFFECT_PRESETS_PATH = ['app', 'effect-presets.json']

export interface UserEffectPreset {
  id: string
  name: string
  effects: VisualEffect[]
  createdAt: number
}

interface EffectPresetsFile {
  version: 1
  presets: UserEffectPreset[]
}

function isVisualEffect(value: unknown): value is VisualEffect {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<VisualEffect>
  return (
    candidate.type === 'gpu-effect' &&
    typeof candidate.gpuEffectType === 'string' &&
    typeof candidate.params === 'object' &&
    candidate.params !== null
  )
}

function sanitizePresets(value: unknown): UserEffectPreset[] {
  if (!value || typeof value !== 'object') return []
  const presets = (value as Partial<EffectPresetsFile>).presets
  if (!Array.isArray(presets)) return []

  return presets.flatMap((preset) => {
    if (!preset || typeof preset !== 'object') return []
    const candidate = preset as Partial<UserEffectPreset>
    if (
      typeof candidate.id !== 'string' ||
      typeof candidate.name !== 'string' ||
      !Array.isArray(candidate.effects)
    ) {
      return []
    }
    const effects = candidate.effects.filter(isVisualEffect)
    if (effects.length === 0) return []
    return [
      {
        id: candidate.id,
        name: candidate.name,
        effects,
        createdAt: typeof candidate.createdAt === 'number' ? candidate.createdAt : 0,
      },
    ]
  })
}

export async function readUserEffectPresets(): Promise<UserEffectPreset[]> {
  try {
    const root = requireWorkspaceRoot()
    const file = await readJson<EffectPresetsFile>(root, EFFECT_PRESETS_PATH)
    return sanitizePresets(file)
  } catch (error) {
    logger.warn('readUserEffectPresets failed', error)
    return []
  }
}

export async function saveUserEffectPresets(presets: UserEffectPreset[]): Promise<void> {
  try {
    const root = requireWorkspaceRoot()
    const file: EffectPresetsFile = { version: 1, presets }
    await writeJsonAtomic(root, EFFECT_PRESETS_PATH, file)
  } catch (error) {
    logger.error('saveUserEffectPresets failed', error)
    throw new Error('Failed to save effect presets')
  }
}
