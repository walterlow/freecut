import type { ItemEffect, VisualEffect } from '@/types/effects'
import type { TimelineItem } from '@/types/timeline'
import { isGradePresetEffect } from '@/features/editor/deps/effects-contract'
import type { CinematicEditingProfile } from './cinematic-editing-profile'

type CreateId = () => string

const CINEMATIC_FINISH_ID_PREFIX = 'cinematic-finish'

const CINEMATIC_FINISH_GRADE: VisualEffect[] = [
  {
    type: 'gpu-effect',
    gpuEffectType: 'gpu-color-wheels',
    params: {
      exposure: 0.08,
      contrast: 1.05,
      pivot: 0.48,
      lift: 0.032,
      gamma: 1.055,
      gain: 1.055,
      blackPoint: 0,
      whitePoint: 1.01,
      temperature: 2,
      saturation: 5,
      shadows: 12,
      highlights: 2,
      midDetail: 10,
      colorBoost: 6,
      hue: 50,
      lumMix: 100,
    },
  },
]

const CINEMATIC_FINISH_TEXTURE: VisualEffect[] = [
  {
    type: 'gpu-effect',
    gpuEffectType: 'gpu-sharpen',
    params: { amount: 0.68, radius: 0.85 },
  },
  {
    type: 'gpu-effect',
    gpuEffectType: 'gpu-grain',
    params: { amount: 0.018, size: 1.45, speed: 0.45 },
  },
]

const DOCUMENTARY_FINISH_GRADE: VisualEffect[] = [
  {
    type: 'gpu-effect',
    gpuEffectType: 'gpu-color-wheels',
    params: {
      exposure: 0.04,
      contrast: 1.025,
      pivot: 0.5,
      lift: 0.018,
      gamma: 1.025,
      gain: 1.025,
      blackPoint: 0,
      whitePoint: 1,
      temperature: -1,
      saturation: -2,
      shadows: 7,
      highlights: -1,
      midDetail: 8,
      colorBoost: 2,
      hue: 50,
      lumMix: 100,
    },
  },
]

const DOCUMENTARY_FINISH_TEXTURE: VisualEffect[] = [
  {
    type: 'gpu-effect',
    gpuEffectType: 'gpu-sharpen',
    params: { amount: 0.5, radius: 0.8 },
  },
  {
    type: 'gpu-effect',
    gpuEffectType: 'gpu-grain',
    params: { amount: 0.012, size: 1.25, speed: 0.32 },
  },
]

const MAGNATES_FINISH_GRADE: VisualEffect[] = [
  {
    type: 'gpu-effect',
    gpuEffectType: 'gpu-color-wheels',
    params: {
      exposure: 0.075,
      contrast: 1.055,
      pivot: 0.49,
      lift: 0.065,
      gamma: 1.055,
      gain: 1.06,
      blackPoint: 0,
      whitePoint: 1.015,
      temperature: -1,
      saturation: 3,
      shadows: 14,
      highlights: 1,
      midDetail: 14,
      colorBoost: 5,
      hue: 50,
      lumMix: 100,
    },
  },
]

const MAGNATES_FINISH_TEXTURE: VisualEffect[] = [
  {
    type: 'gpu-effect',
    gpuEffectType: 'gpu-sharpen',
    params: { amount: 0.78, radius: 0.82 },
  },
  {
    type: 'gpu-effect',
    gpuEffectType: 'gpu-grain',
    params: { amount: 0.014, size: 1.25, speed: 0.38 },
  },
  {
    type: 'gpu-effect',
    gpuEffectType: 'gpu-vignette',
    params: { amount: 0.14, size: 0.72, softness: 0.54, roundness: 1.18 },
  },
]

const MAGNATES_BACKGROUND_DEPTH: VisualEffect = {
  type: 'gpu-effect',
  gpuEffectType: 'gpu-gaussian-blur',
  params: { radius: 1.25, samples: 5 },
}

const MAGNATES_SUBJECT_LIGHT_WRAP: VisualEffect = {
  type: 'gpu-effect',
  gpuEffectType: 'gpu-glow',
  params: { amount: 0.12, threshold: 0.78, radius: 9, softness: 0.6, rings: 2, samplesPerRing: 8 },
}

function cloneVisualEffect(effect: VisualEffect): VisualEffect {
  return {
    ...effect,
    params: { ...effect.params },
  }
}

function isAutomatedFinishingEntry(effect: ItemEffect): boolean {
  return effect.id.startsWith(`${CINEMATIC_FINISH_ID_PREFIX}:`)
}

function createFinishingEntry(effect: VisualEffect, slot: string, createId: CreateId): ItemEffect {
  return {
    id: `${CINEMATIC_FINISH_ID_PREFIX}:${slot}:${createId()}`,
    enabled: true,
    effect: cloneVisualEffect(effect),
  }
}

function hasManualGrade(effects: readonly ItemEffect[]): boolean {
  return effects.some(
    (entry) => !isAutomatedFinishingEntry(entry) && isGradePresetEffect(entry.effect),
  )
}

function hasEffectType(effects: readonly ItemEffect[], gpuEffectType: string): boolean {
  return effects.some(
    (entry) => entry.effect.type === 'gpu-effect' && entry.effect.gpuEffectType === gpuEffectType,
  )
}

export function shouldApplyCinematicFinishing(item: TimelineItem): boolean {
  if (item.type !== 'image' && item.type !== 'video') return false
  return item.cinematicDepthRole !== 'depth-map'
}

export function buildCinematicFinishingEffectStack(
  currentEffects: readonly ItemEffect[] | undefined,
  createId: CreateId = () => crypto.randomUUID(),
  profile: CinematicEditingProfile = 'story',
): ItemEffect[] {
  const preservedEffects = (currentEffects ?? []).filter(
    (entry) => !isAutomatedFinishingEntry(entry),
  )
  const nextEffects = [...preservedEffects]

  const grade =
    profile === 'documentary'
      ? DOCUMENTARY_FINISH_GRADE
      : profile === 'magnates-3d'
        ? MAGNATES_FINISH_GRADE
        : CINEMATIC_FINISH_GRADE
  const texture =
    profile === 'documentary'
      ? DOCUMENTARY_FINISH_TEXTURE
      : profile === 'magnates-3d'
        ? MAGNATES_FINISH_TEXTURE
        : CINEMATIC_FINISH_TEXTURE

  if (!hasManualGrade(preservedEffects)) {
    for (const [index, effect] of grade.entries()) {
      nextEffects.push(createFinishingEntry(effect, `grade-${index + 1}`, createId))
    }
  }

  for (const effect of texture) {
    if (hasEffectType(nextEffects, effect.gpuEffectType)) continue
    nextEffects.push(createFinishingEntry(effect, effect.gpuEffectType, createId))
  }

  return nextEffects
}

export function buildCinematicFinishingUpdates(
  items: readonly TimelineItem[],
  targetItemIds: Iterable<string>,
  createId?: CreateId,
  profile: CinematicEditingProfile = 'story',
): Array<{ itemId: string; effects: ItemEffect[] }> {
  const targetIds = new Set(targetItemIds)
  if (targetIds.size === 0) return []

  return items
    .filter((item) => targetIds.has(item.id) && shouldApplyCinematicFinishing(item))
    .map((item) => {
      const nextId = createId ?? (() => crypto.randomUUID())
      const effects = buildCinematicFinishingEffectStack(item.effects, nextId, profile)
      if (profile === 'magnates-3d' && item.cinematicDepthRole === 'background') {
        effects.push(createFinishingEntry(MAGNATES_BACKGROUND_DEPTH, 'depth-background', nextId))
      }
      if (profile === 'magnates-3d' && item.cinematicDepthRole === 'subject') {
        effects.push(
          createFinishingEntry(MAGNATES_SUBJECT_LIGHT_WRAP, 'subject-light-wrap', nextId),
        )
      }
      return { itemId: item.id, effects }
    })
}
