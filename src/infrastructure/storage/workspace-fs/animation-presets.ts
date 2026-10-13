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

import type {
  AnimatableProperty,
  EasingConfig,
  Keyframe,
  SpatialBezierTangents,
  TemporalEase,
  TemporalEaseHandle,
  Vector2,
  VectorAnimatableProperty,
  VectorKeyframe,
} from '@/types/keyframe'
import type { VisualEffect } from '@/types/effects'
import type { TimelineItem } from '@/types/timeline'
import type {
  MotionModifier,
  MotionModifierChannel,
  MotionModifierType,
  MotionAnimationLayer,
  MotionLayerTrack,
} from '@/types/motion'
import type { TextMotionSpec } from '@/types/text-motion'
import { createLogger } from '@/shared/logging/logger'
import { sanitizeTextMotion } from '@/shared/projects/migrations/sanitize-text-motion'

import { requireWorkspaceRoot } from './root'
import { readJson, writeJsonAtomic } from './fs-primitives'
import { projectAnimationPresetsPath } from './paths'

const logger = createLogger('WorkspaceFS:AnimationPresets')

/** Keyframes for a single animatable property, frame-normalized to 0. */
export interface AnimationPresetProperty {
  property: AnimatableProperty
  keyframes: Keyframe[]
}

export interface AnimationPresetVectorProperty {
  property: VectorAnimatableProperty
  keyframes: VectorKeyframe[]
}

export interface AnimationPreset {
  id: string
  name: string
  /** The source clip type the preset was captured from. */
  sourceItemType: TimelineItem['type']
  /** Keyframes-by-property, frame-normalized so the earliest frame is 0. */
  properties: AnimationPresetProperty[]
  /** Coupled Position/Scale keyframes, including temporal and spatial handles. */
  vectorProperties?: AnimationPresetVectorProperty[]
  /** Effect definitions the effect-param keyframes animate. */
  effects: VisualEffect[]
  /** Live whole-layer behaviours captured from the source clip. */
  motionModifiers?: MotionModifier[]
  /** Named additive keyframe layers captured from the source clip. */
  motionLayers?: MotionAnimationLayer[]
  /** Per-character/word/line motion captured from a text clip. */
  textMotion?: TextMotionSpec
  /** Source clip duration in project frames, for optional retiming on apply. */
  sourceDurationInFrames: number
  createdAt: number
}

interface AnimationPresetsFile {
  version: 1 | 2 | 3 | 4
  presets: AnimationPreset[]
}

const VALID_MOTION_MODIFIER_TYPES = new Set<MotionModifierType>([
  'float-drift',
  'breath-pulse',
  'micro-shake',
  'sway',
  'spin',
])

const VALID_MOTION_MODIFIER_CHANNELS = new Set<MotionModifierChannel>([
  'x',
  'y',
  'width',
  'height',
  'rotation',
  'opacity',
])

const VALID_MOTION_LAYER_PROPERTIES = new Set(['x', 'y', 'width', 'height', 'rotation', 'opacity'])

const VALID_ITEM_TYPES = new Set<TimelineItem['type']>([
  'video',
  'audio',
  'text',
  'image',
  'shape',
  'adjustment',
  'composition',
  'controller',
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

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function sanitizeMotionModifier(value: unknown): MotionModifier | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<MotionModifier>
  if (
    typeof candidate.id !== 'string' ||
    typeof candidate.type !== 'string' ||
    !VALID_MOTION_MODIFIER_TYPES.has(candidate.type as MotionModifierType)
  ) {
    return null
  }

  const channelGains =
    candidate.channelGains && typeof candidate.channelGains === 'object'
      ? Object.fromEntries(
          Object.entries(candidate.channelGains).flatMap(([channel, gain]) =>
            VALID_MOTION_MODIFIER_CHANNELS.has(channel as MotionModifierChannel) &&
            typeof gain === 'number' &&
            Number.isFinite(gain)
              ? [[channel, clamp(gain, 0, 2)]]
              : [],
          ),
        )
      : undefined

  return {
    ...(channelGains && { version: 2 as const }),
    id: candidate.id,
    type: candidate.type as MotionModifierType,
    enabled: typeof candidate.enabled === 'boolean' ? candidate.enabled : true,
    amplitude:
      typeof candidate.amplitude === 'number' && Number.isFinite(candidate.amplitude)
        ? clamp(candidate.amplitude, 0, 2)
        : 1,
    frequency:
      typeof candidate.frequency === 'number' && Number.isFinite(candidate.frequency)
        ? clamp(candidate.frequency, 0.01, 60)
        : 1,
    phaseFrames:
      typeof candidate.phaseFrames === 'number' && Number.isFinite(candidate.phaseFrames)
        ? Math.max(0, candidate.phaseFrames)
        : 0,
    seed:
      typeof candidate.seed === 'number' && Number.isFinite(candidate.seed)
        ? Math.round(candidate.seed)
        : 0,
    ...(channelGains && { channelGains }),
  }
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

function sanitizeMotionLayerTrack(value: unknown): MotionLayerTrack | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<MotionLayerTrack>
  if (
    typeof candidate.property !== 'string' ||
    !VALID_MOTION_LAYER_PROPERTIES.has(candidate.property) ||
    (candidate.blend !== 'add' && candidate.blend !== 'multiply') ||
    !Array.isArray(candidate.keyframes)
  ) {
    return null
  }
  const keyframes = candidate.keyframes
    .map(sanitizeKeyframe)
    .filter((keyframe): keyframe is Keyframe => keyframe !== null)
  if (keyframes.length === 0) return null
  return {
    property: candidate.property as MotionLayerTrack['property'],
    blend: candidate.blend,
    keyframes,
  }
}

function sanitizeMotionLayer(value: unknown): MotionAnimationLayer | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<MotionAnimationLayer>
  if (
    typeof candidate.id !== 'string' ||
    typeof candidate.name !== 'string' ||
    (candidate.source !== 'built-in-preset' && candidate.source !== 'saved-preset') ||
    typeof candidate.sourcePresetId !== 'string' ||
    !Array.isArray(candidate.tracks)
  ) {
    return null
  }
  const tracks = candidate.tracks
    .map(sanitizeMotionLayerTrack)
    .filter((track): track is MotionLayerTrack => track !== null)
  if (tracks.length === 0) return null
  return {
    id: candidate.id,
    name: candidate.name,
    enabled: typeof candidate.enabled === 'boolean' ? candidate.enabled : true,
    source: candidate.source,
    sourcePresetId: candidate.sourcePresetId,
    tracks,
  }
}

function sanitizeVector2(value: unknown): Vector2 | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<Vector2>
  if (
    typeof candidate.x !== 'number' ||
    !Number.isFinite(candidate.x) ||
    typeof candidate.y !== 'number' ||
    !Number.isFinite(candidate.y)
  ) {
    return null
  }
  return { x: candidate.x, y: candidate.y }
}

function readFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function readObject<T>(value: unknown): Partial<T> | null {
  return value && typeof value === 'object' ? (value as Partial<T>) : null
}

function isNonNegative(value: number | null): value is number {
  return value !== null && value >= 0
}

function isValidInfluence(value: number | null): value is number {
  return value !== null && value >= 0 && value <= 100
}

function sanitizeTemporalEaseHandle(value: unknown): TemporalEaseHandle | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as { speed?: unknown; influence?: unknown }
  const speed = readFiniteNumber(candidate.speed)
  const influence = readFiniteNumber(candidate.influence)
  if (!isNonNegative(speed) || !isValidInfluence(influence)) return null
  return { speed, influence }
}

function sanitizeTemporalEase(value: unknown): TemporalEase | undefined {
  if (!value || typeof value !== 'object') return undefined
  const candidate = value as Partial<TemporalEase>
  const incoming = sanitizeTemporalEaseHandle(candidate.in)
  const outgoing = sanitizeTemporalEaseHandle(candidate.out)
  if (!incoming && !outgoing) return undefined
  return {
    ...(incoming && { in: incoming }),
    ...(outgoing && { out: outgoing }),
  }
}

function sanitizeSpatialTangents(value: unknown): SpatialBezierTangents | undefined {
  if (!value || typeof value !== 'object') return undefined
  const candidate = value as Partial<SpatialBezierTangents>
  const inTangent = sanitizeVector2(candidate.inTangent)
  const outTangent = sanitizeVector2(candidate.outTangent)
  if (!inTangent || !outTangent) return undefined
  return {
    inTangent,
    outTangent,
    ...(typeof candidate.continuous === 'boolean' && { continuous: candidate.continuous }),
  }
}

function createVectorKeyframe(
  candidate: Partial<VectorKeyframe>,
  frame: number,
  value: Vector2,
): VectorKeyframe {
  return {
    id: typeof candidate.id === 'string' ? candidate.id : '',
    frame,
    value,
    easing: typeof candidate.easing === 'string' ? candidate.easing : 'linear',
  }
}

function applyVectorKeyframeMetadata(
  keyframe: VectorKeyframe,
  candidate: Partial<VectorKeyframe>,
): void {
  const easingConfig = readObject<EasingConfig>(candidate.easingConfig)
  if (easingConfig) keyframe.easingConfig = easingConfig as EasingConfig
  const temporalEase = sanitizeTemporalEase(candidate.temporalEase)
  if (temporalEase) keyframe.temporalEase = temporalEase
  const spatial = sanitizeSpatialTangents(candidate.spatial)
  if (spatial) keyframe.spatial = spatial
}

function sanitizeVectorKeyframe(value: unknown): VectorKeyframe | null {
  const candidate = readObject<VectorKeyframe>(value)
  if (!candidate) return null
  const frame = readFiniteNumber(candidate.frame)
  const vector = sanitizeVector2(candidate.value)
  if (frame === null || !vector) return null
  const keyframe = createVectorKeyframe(candidate, frame, vector)
  applyVectorKeyframeMetadata(keyframe, candidate)
  return keyframe
}

function sanitizeVectorProperty(value: unknown): AnimationPresetVectorProperty | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<AnimationPresetVectorProperty>
  if (candidate.property !== 'position' && candidate.property !== 'scale') return null
  if (!Array.isArray(candidate.keyframes)) return null
  const keyframes = candidate.keyframes
    .map(sanitizeVectorKeyframe)
    .filter((keyframe): keyframe is VectorKeyframe => keyframe !== null)
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
    const vectorProperties = Array.isArray(candidate.vectorProperties)
      ? candidate.vectorProperties
          .map(sanitizeVectorProperty)
          .filter((property): property is AnimationPresetVectorProperty => property !== null)
      : []
    const motionModifiers = Array.isArray(candidate.motionModifiers)
      ? candidate.motionModifiers
          .map(sanitizeMotionModifier)
          .filter((modifier): modifier is MotionModifier => modifier !== null)
      : []
    const motionLayers = Array.isArray(candidate.motionLayers)
      ? candidate.motionLayers
          .map(sanitizeMotionLayer)
          .filter((layer): layer is MotionAnimationLayer => layer !== null)
      : []
    const textMotion =
      candidate.sourceItemType === 'text' ? sanitizeTextMotion(candidate.textMotion) : undefined
    if (
      properties.length === 0 &&
      vectorProperties.length === 0 &&
      motionModifiers.length === 0 &&
      motionLayers.length === 0 &&
      !textMotion
    ) {
      return []
    }

    const effects = Array.isArray(candidate.effects) ? candidate.effects.filter(isVisualEffect) : []

    return [
      {
        id: candidate.id,
        name: candidate.name,
        sourceItemType: candidate.sourceItemType,
        properties,
        ...(vectorProperties.length > 0 && { vectorProperties }),
        effects,
        ...(motionModifiers.length > 0 && { motionModifiers }),
        ...(motionLayers.length > 0 && { motionLayers }),
        ...(textMotion && { textMotion }),
        sourceDurationInFrames:
          typeof candidate.sourceDurationInFrames === 'number' &&
          Number.isFinite(candidate.sourceDurationInFrames)
            ? candidate.sourceDurationInFrames
            : 0,
        createdAt:
          typeof candidate.createdAt === 'number' && Number.isFinite(candidate.createdAt)
            ? candidate.createdAt
            : 0,
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
    const file: AnimationPresetsFile = { version: 4, presets }
    await writeJsonAtomic(root, projectAnimationPresetsPath(projectId), file)
  } catch (error) {
    logger.error('saveAnimationPresets failed', error)
    throw new Error('Failed to save animation presets')
  }
}
