/**
 * Derives a non-keyframe visual representation of procedural motion modifiers so
 * the dopesheet and graph can show that a clip is animated by a generator (and
 * how) before it is baked into diamonds. Pure functions over `motionModifiers`.
 *
 * - Bands (dopesheet): the frame range a modifier occupies per property, plus a
 *   kind ('wave' | 'noise' | 'beats') for the glyph and beat ticks for audio.
 * - Sampling (graph): evaluate the modifier contribution into absolute property
 *   values across a frame range for a dashed ghost curve.
 */

import type { ResolvedTransform } from '@/types/transform'
import type { AnimatableProperty, TransformAnimatableProperty } from '@/types/keyframe'
import type { ItemKeyframes } from '@/types/keyframe'
import type { MotionModifier } from '@/types/motion'
import { applyMotionModifiers } from './motion-modifier-eval'
import { resolveAnimatedTransform } from './animated-transform-resolver'

/**
 * Inputs needed to sample procedural ghost curves in the graph. Threaded from
 * the panel (which owns the canvas + resolved base transform) into the graph.
 */
export interface ProceduralPreviewInput {
  base: ResolvedTransform
  modifiers: MotionModifier[]
  frameWidth: number
  frameHeight: number
}

export type ProceduralBandKind = 'wave' | 'noise' | 'beats'

export interface ProceduralBand {
  property: TransformAnimatableProperty
  kind: ProceduralBandKind
  /** Inclusive clip-relative frame range the band spans. */
  fromFrame: number
  toFrame: number
  /** Beat frames (clip-relative) for 'beats' bands; drawn as ticks. */
  beats?: number[]
}

/** Transform properties a modifier drives, mirrored from the evaluators. */
function modifierProperties(modifier: MotionModifier): TransformAnimatableProperty[] {
  switch (modifier.type) {
    case 'float-drift':
    case 'micro-shake':
      return ['x', 'y', 'rotation']
    case 'breath-pulse':
      return ['width', 'height', 'opacity']
    case 'audio-reactive':
      switch (modifier.target ?? 'scale') {
        case 'scale':
          return ['width', 'height']
        case 'bounce':
          return ['y']
        case 'rotation':
          return ['rotation']
      }
  }
}

function modifierKind(modifier: MotionModifier): ProceduralBandKind {
  switch (modifier.type) {
    case 'micro-shake':
      return 'noise'
    case 'audio-reactive':
      return 'beats'
    default:
      return 'wave'
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

/**
 * One band per property a modifier drives. When several modifiers target the
 * same property the bands are merged into the widest span (a 'beats' band wins
 * the kind so its ticks stay meaningful).
 */
export function getProceduralBands(
  modifiers: readonly MotionModifier[] | undefined,
  durationInFrames: number,
): Map<AnimatableProperty, ProceduralBand> {
  const bands = new Map<AnimatableProperty, ProceduralBand>()
  if (!modifiers || modifiers.length === 0 || durationInFrames <= 0) return bands
  const last = Math.max(0, durationInFrames - 1)

  for (const modifier of modifiers) {
    if (!modifier.enabled || modifier.amplitude <= 0) continue
    const kind = modifierKind(modifier)

    let fromFrame = 0
    let toFrame = last
    let beats: number[] | undefined
    if (kind === 'beats') {
      const frames = (modifier.beats ?? [])
        .map((beat) => clamp(beat.frame, 0, last))
        .sort((a, b) => a - b)
      if (frames.length === 0) continue
      beats = frames
      const pulse = Math.max(1, modifier.pulseFrames ?? 0)
      fromFrame = frames[0]!
      toFrame = clamp(frames[frames.length - 1]! + pulse, 0, last)
    }

    for (const property of modifierProperties(modifier)) {
      const existing = bands.get(property)
      if (!existing) {
        bands.set(property, { property, kind, fromFrame, toFrame, beats })
        continue
      }
      // Merge: widen the span, prefer the 'beats' kind, union beat ticks.
      existing.fromFrame = Math.min(existing.fromFrame, fromFrame)
      existing.toFrame = Math.max(existing.toFrame, toFrame)
      if (kind === 'beats') {
        existing.kind = 'beats'
        existing.beats = [...(existing.beats ?? []), ...(beats ?? [])].sort((a, b) => a - b)
      } else if (existing.kind !== 'beats' && kind === 'noise') {
        existing.kind = 'noise'
      }
    }
  }

  return bands
}

export interface ProceduralSamplePoint {
  frame: number
  value: number
}

/**
 * Sample the fully-resolved value (base + keyframes + modifiers) of one property
 * across [fromFrame, toFrame] at `step` frames for a dashed ghost curve. Returns
 * an empty array when no enabled modifier drives the property.
 */
export function sampleProceduralCurve(params: {
  property: TransformAnimatableProperty
  base: ResolvedTransform
  keyframes: ItemKeyframes | undefined
  modifiers: readonly MotionModifier[] | undefined
  fromFrame: number
  toFrame: number
  step: number
  fps: number
  frameWidth: number
  frameHeight: number
}): ProceduralSamplePoint[] {
  const { property, base, keyframes, modifiers, fromFrame, toFrame, fps, frameWidth, frameHeight } =
    params
  if (!modifiers || modifiers.length === 0 || toFrame <= fromFrame) return []
  const drivesProperty = modifiers.some(
    (modifier) =>
      modifier.enabled &&
      modifier.amplitude > 0 &&
      modifierProperties(modifier).includes(property),
  )
  if (!drivesProperty) return []

  const step = Math.max(1, Math.floor(params.step))
  const points: ProceduralSamplePoint[] = []
  for (let frame = fromFrame; frame <= toFrame; frame += step) {
    const animated = resolveAnimatedTransform(base, keyframes, frame)
    const resolved = applyMotionModifiers(animated, modifiers, {
      frame,
      fps,
      frameWidth,
      frameHeight,
    })
    points.push({ frame, value: resolved[property] })
  }
  // Ensure the final frame is represented for a clean curve end.
  if (points.length > 0 && points[points.length - 1]!.frame !== toFrame) {
    const animated = resolveAnimatedTransform(base, keyframes, toFrame)
    const resolved = applyMotionModifiers(animated, modifiers, {
      frame: toFrame,
      fps,
      frameWidth,
      frameHeight,
    })
    points.push({ frame: toFrame, value: resolved[property] })
  }
  return points
}
