/**
 * User-saved animation presets.
 *
 * Stored at `projects/{id}/animation-presets.json` in the workspace —
 * unlike effect presets (which are app-level and shared across projects),
 * animation presets are scoped to a single project, rooted under the
 * project directory like `render-queue.json`.
 *
 * The envelope + defensive sanitizer mirror `effect-presets.ts` so the
 * bundle import path (U8) can reuse `sanitizeAnimationPresets`.
 */

import type { AnimatableProperty, Keyframe } from '@/types/keyframe'
import type { VisualEffect } from '@/types/effects'
import type { TimelineItem } from '@/types/timeline'
import { createLogger } from '@/shared/logging/logger'

import { requireWorkspaceRoot } from './root'
import { readJson, writeJsonAtomic } from './fs-primitives'
import { projectAnimationPresetsPath } from './paths'

const logger = createLogger('WorkspaceFS:AnimationPresets')

/** Keyframes for a single animatable property, frame-normalized to 0. */
export interface AnimationPresetProperty {
  property: AnimatableProperty
  keyframes: Keyframe[]
}

export interface AnimationPreset {
  id: string
  name: string
  /** The source clip type the preset was captured from. */
  sourceItemType: TimelineItem['type']
  /** Keyframes-by-property, frame-normalized so the earliest frame is 0. */
  properties: AnimationPresetProperty[]
  /** Effect definitions the effect-param keyframes animate. */
  effects: VisualEffect[]
  /** Source clip duration in project frames, for optional retiming on apply. */
  sourceDurationInFrames: number
  createdAt: number
}

interface AnimationPresetsFile {
  version: 1
  presets: AnimationPreset[]
}

const VALID_ITEM_TYPES = new Set<TimelineItem['type']>([
  'video',
  'audio',
  'text',
  'image',
  'shape',
  'adjustment',
  'composition',
  'subtitle',
])

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

function sanitizeKeyframe(value: unknown): Keyframe | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<Keyframe>
  if (typeof candidate.frame !== 'number' || !Number.isFinite(candidate.frame)) return null
  if (typeof candidate.value !== 'number' || !Number.isFinite(candidate.value)) return null
  // Preserve id/easing/easingConfig as-is when present; fall back defensively.
  const keyframe: Keyframe = {
    id: typeof candidate.id === 'string' ? candidate.id : '',
    frame: candidate.frame,
    value: candidate.value,
    easing: typeof candidate.easing === 'string' ? candidate.easing : 'linear',
  }
  if (candidate.easingConfig && typeof candidate.easingConfig === 'object') {
    keyframe.easingConfig = candidate.easingConfig
  }
  return keyframe
}

function sanitizeProperty(value: unknown): AnimationPresetProperty | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<AnimationPresetProperty>
  if (typeof candidate.property !== 'string') return null
  if (!Array.isArray(candidate.keyframes)) return null
  const keyframes = candidate.keyframes
    .map(sanitizeKeyframe)
    .filter((kf): kf is Keyframe => kf !== null)
  if (keyframes.length === 0) return null
  return { property: candidate.property, keyframes }
}

/**
 * Defensive sanitizer — drops bad entries, never throws. Exported so the
 * project-bundle import path can reuse the same validation.
 */
export function sanitizeAnimationPresets(value: unknown): AnimationPreset[] {
  if (!value || typeof value !== 'object') return []
  const presets = (value as Partial<AnimationPresetsFile>).presets
  if (!Array.isArray(presets)) return []

  return presets.flatMap((preset) => {
    if (!preset || typeof preset !== 'object') return []
    const candidate = preset as Partial<AnimationPreset>
    if (
      typeof candidate.id !== 'string' ||
      typeof candidate.name !== 'string' ||
      typeof candidate.sourceItemType !== 'string' ||
      !VALID_ITEM_TYPES.has(candidate.sourceItemType) ||
      !Array.isArray(candidate.properties)
    ) {
      return []
    }

    const properties = candidate.properties
      .map(sanitizeProperty)
      .filter((prop): prop is AnimationPresetProperty => prop !== null)
    if (properties.length === 0) return []

    const effects = Array.isArray(candidate.effects)
      ? candidate.effects.filter(isVisualEffect)
      : []

    return [
      {
        id: candidate.id,
        name: candidate.name,
        sourceItemType: candidate.sourceItemType,
        properties,
        effects,
        sourceDurationInFrames:
          typeof candidate.sourceDurationInFrames === 'number' &&
          Number.isFinite(candidate.sourceDurationInFrames)
            ? candidate.sourceDurationInFrames
            : 0,
        createdAt: typeof candidate.createdAt === 'number' ? candidate.createdAt : 0,
      },
    ]
  })
}

export async function readAnimationPresets(projectId: string): Promise<AnimationPreset[]> {
  try {
    const root = requireWorkspaceRoot()
    const file = await readJson<AnimationPresetsFile>(root, projectAnimationPresetsPath(projectId))
    return sanitizeAnimationPresets(file)
  } catch (error) {
    logger.warn('readAnimationPresets failed', error)
    return []
  }
}

export async function saveAnimationPresets(
  projectId: string,
  presets: AnimationPreset[],
): Promise<void> {
  try {
    const root = requireWorkspaceRoot()
    const file: AnimationPresetsFile = { version: 1, presets }
    await writeJsonAtomic(root, projectAnimationPresetsPath(projectId), file)
  } catch (error) {
    logger.error('saveAnimationPresets failed', error)
    throw new Error('Failed to save animation presets')
  }
}
