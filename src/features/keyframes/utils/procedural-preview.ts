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
import type { MotionAnimationLayer, MotionModifier } from '@/types/motion'
import { applyMotionModifiers, getActiveMotionModifierChannels } from './motion-modifier-eval'
import { applyMotionAnimationLayers, getActiveMotionLayerChannels } from './motion-layer-eval'
import { resolveAnimatedTransform } from './animated-transform-resolver'

/**
 * Inputs needed to sample procedural ghost curves in the graph. Threaded from
 * the panel (which owns the canvas + resolved base transform) into the graph.
 */
export interface ProceduralPreviewInput {
  base: ResolvedTransform
  keyframes?: ItemKeyframes
  modifiers: MotionModifier[]
  layers?: MotionAnimationLayer[]
  frameWidth: number
  frameHeight: number
}

export type ProceduralBandKind = 'wave' | 'noise'

export interface ProceduralBand {
  property: TransformAnimatableProperty
  kind: ProceduralBandKind
  /** Inclusive clip-relative frame range the band spans. */
  fromFrame: number
  toFrame: number
}

function modifierKind(modifier: MotionModifier): ProceduralBandKind {
  return modifier.type === 'micro-shake' ? 'noise' : 'wave'
}

/**
 * One band per property a modifier drives. When several modifiers target the
 * same property the bands are merged into the widest span ('noise' wins the
 * kind so its glyph stays meaningful).
 */
export function getProceduralBands(
  modifiers: readonly MotionModifier[] | undefined,
  durationInFrames: number,
  frameOffset = 0,
): Map<AnimatableProperty, ProceduralBand> {
  const bands = new Map<AnimatableProperty, ProceduralBand>()
  if (!modifiers || modifiers.length === 0 || durationInFrames <= 0) return bands
  const first = Math.max(0, frameOffset)
  const last = first + Math.max(0, durationInFrames - 1)

  for (const modifier of modifiers) {
    if (!modifier.enabled || modifier.amplitude <= 0) continue
    const kind = modifierKind(modifier)

    for (const property of getActiveMotionModifierChannels(modifier)) {
      const existing = bands.get(property)
      if (!existing) {
        bands.set(property, { property, kind, fromFrame: first, toFrame: last })
        continue
      }
      if (kind === 'noise') existing.kind = 'noise'
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
  layers?: readonly MotionAnimationLayer[]
  fromFrame: number
  toFrame: number
  step: number
  fps: number
  frameWidth: number
  frameHeight: number
}): ProceduralSamplePoint[] {
  const {
    property,
    base,
    keyframes,
    modifiers,
    layers,
    fromFrame,
    toFrame,
    fps,
    frameWidth,
    frameHeight,
  } = params
  if (toFrame <= fromFrame) return []
  const modifierDrivesProperty = (modifiers ?? []).some(
    (modifier) =>
      modifier.enabled &&
      modifier.amplitude > 0 &&
      getActiveMotionModifierChannels(modifier).some((channel) => channel === property),
  )
  const layerDrivesProperty = getActiveMotionLayerChannels(layers).includes(property)
  const drivesProperty = modifierDrivesProperty || layerDrivesProperty
  if (!drivesProperty) return []

  const step = Math.max(1, Math.floor(params.step))
  const points: ProceduralSamplePoint[] = []
  for (let frame = fromFrame; frame <= toFrame; frame += step) {
    const animated = resolveAnimatedTransform(base, keyframes, frame)
    const layered = applyMotionAnimationLayers(animated, layers, frame)
    const resolved = applyMotionModifiers(layered, modifiers, {
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
    const layered = applyMotionAnimationLayers(animated, layers, toFrame)
    const resolved = applyMotionModifiers(layered, modifiers, {
      frame: toFrame,
      fps,
      frameWidth,
      frameHeight,
    })
    points.push({ frame: toFrame, value: resolved[property] })
  }
  return points
}
