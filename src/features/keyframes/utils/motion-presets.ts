/**
 * Built-in motion presets for the Animate workspace.
 *
 * Pure, store-free catalog of After-Effects-style quick-apply animations. Each
 * preset's `build()` emits frame-relative keyframe payloads against a clip's
 * *resting* transform (the value the clip holds without this animation), so the
 * same preset adapts to any clip's position/size. The Animate sidebar resolves
 * the resting transform (via `resolveTransform` + `resolveAnimatedTransform`)
 * and commits the payloads through the same undo-integrated `addKeyframes` path
 * the text-animation presets use.
 *
 * Conventions:
 * - "Scale" is animated through `width`/`height` (there is no scale property);
 *   it reads as a zoom when the clip's anchor is centered. On text clips this
 *   can reflow, so the scale-based presets are best on video/image/shape.
 * - Loops and wiggle are *baked* as discrete keyframes (this is a keyframe
 *   model, not an expression engine). Cycle counts derive from clip duration;
 *   wiggle uses deterministic hash noise so a given clip always bakes the same.
 */

import type { ResolvedTransform } from '@/types/transform'
import type { AnimatableProperty, EasingConfig, EasingType } from '@/types/keyframe'
import {
  animationWindowFrames as windowFrames,
  clamp,
  EASE_IN_SOFT,
  EASE_OUT_SOFT,
  SPRING_SETTLE,
} from './animation-easing'

export type MotionPresetCategory = 'entrance' | 'exit' | 'emphasis' | 'loop'

export type MotionPresetId =
  // entrance
  | 'fade-in'
  | 'slide-in-left'
  | 'slide-in-right'
  | 'slide-in-up'
  | 'slide-in-down'
  | 'pop-in'
  | 'zoom-in'
  | 'spin-in'
  | 'bounce-in'
  // exit
  | 'fade-out'
  | 'slide-out-left'
  | 'slide-out-right'
  | 'slide-out-up'
  | 'slide-out-down'
  | 'pop-out'
  | 'zoom-out'
  // emphasis
  | 'pulse'
  | 'shake'
  | 'wobble'
  | 'flash'
  // loop
  | 'float'
  | 'sway'
  | 'breathe'
  | 'spin'
  | 'wiggle'

/**
 * Visual descriptor the sidebar uses to render an animated thumbnail. Kept
 * separate from `MotionPresetId` so several presets can share one motion glyph
 * (e.g. all four slide directions reuse the `slide` thumbnail with an angle).
 */
export interface MotionThumbnail {
  kind: 'fade' | 'slide' | 'scale' | 'spin' | 'bounce' | 'pulse' | 'shake' | 'wobble' | 'wiggle'
  /** Direction in degrees for `slide` (0 = →, 90 = ↓, 180 = ←, 270 = ↑). */
  angle?: number
  /** `1` grows, `-1` shrinks — for `scale`. */
  direction?: 1 | -1
  /** Continuous (loop) vs one-shot motion — drives thumbnail timing. */
  loop?: boolean
}

export interface MotionPresetKeyframePayload {
  property: AnimatableProperty
  frame: number
  value: number
  easing: EasingType
  easingConfig?: EasingConfig
}

export interface MotionPresetBuildContext {
  /** Resting transform — the value the clip holds without this animation. */
  anchor: ResolvedTransform
  /** Clip duration in project frames. */
  durationInFrames: number
  /** Project frames per second. */
  fps: number
  /** Composition width in px — scales slide travel to the canvas. */
  frameWidth: number
  /** Composition height in px. */
  frameHeight: number
}

export interface MotionPreset {
  id: MotionPresetId
  category: MotionPresetCategory
  /** i18n key suffix under `editor.motionPresets.items.*`. */
  labelKey: string
  thumbnail: MotionThumbnail
  /** Animatable properties the preset writes — drives compatibility gating. */
  properties: AnimatableProperty[]
  build: (ctx: MotionPresetBuildContext) => MotionPresetKeyframePayload[]
}

// --- Easing -----------------------------------------------------------------
// Shared curves (EASE_OUT_SOFT / EASE_IN_SOFT / SPRING_SETTLE) come from
// `animation-easing`; these two overshoot curves are motion-preset specific.

const OVERSHOOT: EasingConfig = {
  type: 'cubic-bezier',
  bezier: { x1: 0.34, y1: 1.56, x2: 0.64, y2: 1 },
}
const BOUNCE: EasingConfig = {
  type: 'cubic-bezier',
  bezier: { x1: 0.2, y1: 1.5, x2: 0.4, y2: 1 },
}

const LINEAR: EasingType = 'linear'
const EASE_IN_OUT: EasingType = 'ease-in-out'

// --- Geometry / timing constants --------------------------------------------

const ENTRANCE_SECONDS = 0.5
const EMPHASIS_SECONDS = 0.6

/**
 * The frame at which the clip sits at its resting transform for `category`.
 * Entrance settles at the end of its window; exit starts settled; emphasis and
 * loops rest at the clip's first frame.
 */
export function getMotionPresetAnchorFrame(
  category: MotionPresetCategory,
  durationInFrames: number,
  fps: number,
): number {
  const maxFrame = Math.max(0, durationInFrames - 1)
  switch (category) {
    case 'entrance':
      return Math.min(maxFrame, windowFrames(ENTRANCE_SECONDS, durationInFrames, fps))
    case 'exit':
      return Math.max(0, maxFrame - windowFrames(ENTRANCE_SECONDS, durationInFrames, fps))
    case 'emphasis':
    case 'loop':
      return 0
  }
}

function kf(
  property: AnimatableProperty,
  frame: number,
  value: number,
  easing: EasingType,
  easingConfig?: EasingConfig,
): MotionPresetKeyframePayload {
  return { property, frame, value, easing, easingConfig }
}

/** Two-keyframe move from `offset` into the resting `rest` over an entrance window. */
function entrancePair(
  property: AnimatableProperty,
  startFrame: number,
  endFrame: number,
  offset: number,
  rest: number,
  config: EasingConfig,
): MotionPresetKeyframePayload[] {
  return [
    kf(property, startFrame, offset, 'cubic-bezier', config),
    kf(property, endFrame, rest, LINEAR),
  ]
}

/** Two-keyframe move from the resting `rest` out to `offset` over an exit window. */
function exitPair(
  property: AnimatableProperty,
  startFrame: number,
  endFrame: number,
  rest: number,
  offset: number,
): MotionPresetKeyframePayload[] {
  return [
    kf(property, startFrame, rest, 'cubic-bezier', EASE_IN_SOFT),
    kf(property, endFrame, offset, LINEAR),
  ]
}

function slideTravel(frameSize: number): number {
  return clamp(frameSize * 0.25, 80, 600)
}

/** Deterministic [-1, 1] noise from an integer seed — for baked wiggle. */
function hashNoise(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453
  return (x - Math.floor(x)) * 2 - 1
}

// --- Builders ---------------------------------------------------------------

function buildEntrance(
  ctx: MotionPresetBuildContext,
  make: (start: number, end: number) => MotionPresetKeyframePayload[],
): MotionPresetKeyframePayload[] {
  const end = windowFrames(ENTRANCE_SECONDS, ctx.durationInFrames, ctx.fps)
  if (end <= 0) return []
  return make(0, end)
}

function buildExit(
  ctx: MotionPresetBuildContext,
  make: (start: number, end: number) => MotionPresetKeyframePayload[],
): MotionPresetKeyframePayload[] {
  const len = windowFrames(ENTRANCE_SECONDS, ctx.durationInFrames, ctx.fps)
  if (len <= 0) return []
  const last = ctx.durationInFrames - 1
  return make(last - len, last)
}

/** Symmetric rest→peak→rest beat across an emphasis window. */
function buildEmphasis(
  ctx: MotionPresetBuildContext,
  frames: (start: number, mid: number, end: number) => MotionPresetKeyframePayload[],
): MotionPresetKeyframePayload[] {
  const len = windowFrames(EMPHASIS_SECONDS, ctx.durationInFrames, ctx.fps)
  if (len <= 0) return []
  const mid = Math.max(1, Math.round(len / 2))
  return frames(0, mid, len)
}

/** Number of full oscillation cycles to bake for a loop preset. */
function loopCycles(ctx: MotionPresetBuildContext): number {
  const seconds = ctx.durationInFrames / ctx.fps
  return clamp(Math.round(seconds / 2), 1, 8)
}

/**
 * Bake a sine-driven loop on one property: `samples` keyframes per cycle across
 * the whole clip, oscillating `rest ± amplitude`.
 */
function buildSineLoop(
  ctx: MotionPresetBuildContext,
  property: AnimatableProperty,
  rest: number,
  amplitude: number,
  samplesPerCycle = 4,
): MotionPresetKeyframePayload[] {
  const last = ctx.durationInFrames - 1
  if (last <= 1) return []
  const cycles = loopCycles(ctx)
  const total = cycles * samplesPerCycle
  const payloads: MotionPresetKeyframePayload[] = []
  for (let i = 0; i <= total; i++) {
    const frame = Math.round((i / total) * last)
    const value = rest + amplitude * Math.sin((i / samplesPerCycle) * Math.PI * 2)
    payloads.push(kf(property, frame, value, EASE_IN_OUT))
  }
  return payloads
}

export const MOTION_PRESETS: MotionPreset[] = [
  // --- Entrance ---
  {
    id: 'fade-in',
    category: 'entrance',
    labelKey: 'fadeIn',
    thumbnail: { kind: 'fade' },
    properties: ['opacity'],
    build: (ctx) =>
      buildEntrance(ctx, (s, e) =>
        entrancePair('opacity', s, e, 0, ctx.anchor.opacity, EASE_OUT_SOFT),
      ),
  },
  {
    id: 'slide-in-left',
    category: 'entrance',
    labelKey: 'slideInLeft',
    thumbnail: { kind: 'slide', angle: 0 },
    properties: ['x', 'opacity'],
    build: (ctx) =>
      buildEntrance(ctx, (s, e) => [
        ...entrancePair(
          'x',
          s,
          e,
          ctx.anchor.x - slideTravel(ctx.frameWidth),
          ctx.anchor.x,
          SPRING_SETTLE,
        ),
        ...entrancePair('opacity', s, e, 0, ctx.anchor.opacity, EASE_OUT_SOFT),
      ]),
  },
  {
    id: 'slide-in-right',
    category: 'entrance',
    labelKey: 'slideInRight',
    thumbnail: { kind: 'slide', angle: 180 },
    properties: ['x', 'opacity'],
    build: (ctx) =>
      buildEntrance(ctx, (s, e) => [
        ...entrancePair(
          'x',
          s,
          e,
          ctx.anchor.x + slideTravel(ctx.frameWidth),
          ctx.anchor.x,
          SPRING_SETTLE,
        ),
        ...entrancePair('opacity', s, e, 0, ctx.anchor.opacity, EASE_OUT_SOFT),
      ]),
  },
  {
    id: 'slide-in-up',
    category: 'entrance',
    labelKey: 'slideInUp',
    thumbnail: { kind: 'slide', angle: 270 },
    properties: ['y', 'opacity'],
    build: (ctx) =>
      buildEntrance(ctx, (s, e) => [
        ...entrancePair(
          'y',
          s,
          e,
          ctx.anchor.y + slideTravel(ctx.frameHeight),
          ctx.anchor.y,
          SPRING_SETTLE,
        ),
        ...entrancePair('opacity', s, e, 0, ctx.anchor.opacity, EASE_OUT_SOFT),
      ]),
  },
  {
    id: 'slide-in-down',
    category: 'entrance',
    labelKey: 'slideInDown',
    thumbnail: { kind: 'slide', angle: 90 },
    properties: ['y', 'opacity'],
    build: (ctx) =>
      buildEntrance(ctx, (s, e) => [
        ...entrancePair(
          'y',
          s,
          e,
          ctx.anchor.y - slideTravel(ctx.frameHeight),
          ctx.anchor.y,
          SPRING_SETTLE,
        ),
        ...entrancePair('opacity', s, e, 0, ctx.anchor.opacity, EASE_OUT_SOFT),
      ]),
  },
  {
    id: 'pop-in',
    category: 'entrance',
    labelKey: 'popIn',
    thumbnail: { kind: 'scale', direction: 1 },
    properties: ['width', 'height', 'opacity'],
    build: (ctx) =>
      buildEntrance(ctx, (s, e) => [
        ...entrancePair('width', s, e, ctx.anchor.width * 0.6, ctx.anchor.width, OVERSHOOT),
        ...entrancePair('height', s, e, ctx.anchor.height * 0.6, ctx.anchor.height, OVERSHOOT),
        ...entrancePair('opacity', s, e, 0, ctx.anchor.opacity, EASE_OUT_SOFT),
      ]),
  },
  {
    id: 'zoom-in',
    category: 'entrance',
    labelKey: 'zoomIn',
    thumbnail: { kind: 'scale', direction: -1 },
    properties: ['width', 'height', 'opacity'],
    build: (ctx) =>
      buildEntrance(ctx, (s, e) => [
        ...entrancePair('width', s, e, ctx.anchor.width * 1.4, ctx.anchor.width, EASE_OUT_SOFT),
        ...entrancePair('height', s, e, ctx.anchor.height * 1.4, ctx.anchor.height, EASE_OUT_SOFT),
        ...entrancePair('opacity', s, e, 0, ctx.anchor.opacity, EASE_OUT_SOFT),
      ]),
  },
  {
    id: 'spin-in',
    category: 'entrance',
    labelKey: 'spinIn',
    thumbnail: { kind: 'spin' },
    properties: ['rotation', 'width', 'height', 'opacity'],
    build: (ctx) =>
      buildEntrance(ctx, (s, e) => [
        ...entrancePair(
          'rotation',
          s,
          e,
          ctx.anchor.rotation - 180,
          ctx.anchor.rotation,
          SPRING_SETTLE,
        ),
        ...entrancePair('width', s, e, ctx.anchor.width * 0.8, ctx.anchor.width, SPRING_SETTLE),
        ...entrancePair('height', s, e, ctx.anchor.height * 0.8, ctx.anchor.height, SPRING_SETTLE),
        ...entrancePair('opacity', s, e, 0, ctx.anchor.opacity, EASE_OUT_SOFT),
      ]),
  },
  {
    id: 'bounce-in',
    category: 'entrance',
    labelKey: 'bounceIn',
    thumbnail: { kind: 'bounce' },
    properties: ['y', 'opacity'],
    build: (ctx) =>
      buildEntrance(ctx, (s, e) => [
        ...entrancePair(
          'y',
          s,
          e,
          ctx.anchor.y - slideTravel(ctx.frameHeight) * 0.6,
          ctx.anchor.y,
          BOUNCE,
        ),
        ...entrancePair('opacity', s, e, 0, ctx.anchor.opacity, EASE_OUT_SOFT),
      ]),
  },

  // --- Exit ---
  {
    id: 'fade-out',
    category: 'exit',
    labelKey: 'fadeOut',
    thumbnail: { kind: 'fade' },
    properties: ['opacity'],
    build: (ctx) => buildExit(ctx, (s, e) => exitPair('opacity', s, e, ctx.anchor.opacity, 0)),
  },
  {
    id: 'slide-out-left',
    category: 'exit',
    labelKey: 'slideOutLeft',
    thumbnail: { kind: 'slide', angle: 180 },
    properties: ['x', 'opacity'],
    build: (ctx) =>
      buildExit(ctx, (s, e) => [
        ...exitPair('x', s, e, ctx.anchor.x, ctx.anchor.x - slideTravel(ctx.frameWidth)),
        ...exitPair('opacity', s, e, ctx.anchor.opacity, 0),
      ]),
  },
  {
    id: 'slide-out-right',
    category: 'exit',
    labelKey: 'slideOutRight',
    thumbnail: { kind: 'slide', angle: 0 },
    properties: ['x', 'opacity'],
    build: (ctx) =>
      buildExit(ctx, (s, e) => [
        ...exitPair('x', s, e, ctx.anchor.x, ctx.anchor.x + slideTravel(ctx.frameWidth)),
        ...exitPair('opacity', s, e, ctx.anchor.opacity, 0),
      ]),
  },
  {
    id: 'slide-out-up',
    category: 'exit',
    labelKey: 'slideOutUp',
    thumbnail: { kind: 'slide', angle: 270 },
    properties: ['y', 'opacity'],
    build: (ctx) =>
      buildExit(ctx, (s, e) => [
        ...exitPair('y', s, e, ctx.anchor.y, ctx.anchor.y - slideTravel(ctx.frameHeight)),
        ...exitPair('opacity', s, e, ctx.anchor.opacity, 0),
      ]),
  },
  {
    id: 'slide-out-down',
    category: 'exit',
    labelKey: 'slideOutDown',
    thumbnail: { kind: 'slide', angle: 90 },
    properties: ['y', 'opacity'],
    build: (ctx) =>
      buildExit(ctx, (s, e) => [
        ...exitPair('y', s, e, ctx.anchor.y, ctx.anchor.y + slideTravel(ctx.frameHeight)),
        ...exitPair('opacity', s, e, ctx.anchor.opacity, 0),
      ]),
  },
  {
    id: 'pop-out',
    category: 'exit',
    labelKey: 'popOut',
    thumbnail: { kind: 'scale', direction: -1 },
    properties: ['width', 'height', 'opacity'],
    build: (ctx) =>
      buildExit(ctx, (s, e) => [
        ...exitPair('width', s, e, ctx.anchor.width, ctx.anchor.width * 0.6),
        ...exitPair('height', s, e, ctx.anchor.height, ctx.anchor.height * 0.6),
        ...exitPair('opacity', s, e, ctx.anchor.opacity, 0),
      ]),
  },
  {
    id: 'zoom-out',
    category: 'exit',
    labelKey: 'zoomOut',
    thumbnail: { kind: 'scale', direction: 1 },
    properties: ['width', 'height', 'opacity'],
    build: (ctx) =>
      buildExit(ctx, (s, e) => [
        ...exitPair('width', s, e, ctx.anchor.width, ctx.anchor.width * 1.4),
        ...exitPair('height', s, e, ctx.anchor.height, ctx.anchor.height * 1.4),
        ...exitPair('opacity', s, e, ctx.anchor.opacity, 0),
      ]),
  },

  // --- Emphasis ---
  {
    id: 'pulse',
    category: 'emphasis',
    labelKey: 'pulse',
    thumbnail: { kind: 'pulse' },
    properties: ['width', 'height'],
    build: (ctx) =>
      buildEmphasis(ctx, (s, m, e) => [
        kf('width', s, ctx.anchor.width, 'ease-out'),
        kf('width', m, ctx.anchor.width * 1.15, EASE_IN_OUT),
        kf('width', e, ctx.anchor.width, 'ease-in'),
        kf('height', s, ctx.anchor.height, 'ease-out'),
        kf('height', m, ctx.anchor.height * 1.15, EASE_IN_OUT),
        kf('height', e, ctx.anchor.height, 'ease-in'),
      ]),
  },
  {
    id: 'shake',
    category: 'emphasis',
    labelKey: 'shake',
    thumbnail: { kind: 'shake' },
    properties: ['x'],
    build: (ctx) => {
      const len = windowFrames(EMPHASIS_SECONDS, ctx.durationInFrames, ctx.fps)
      if (len <= 0) return []
      const amp = clamp(ctx.frameWidth * 0.02, 6, 40)
      const steps = 6
      const payloads: MotionPresetKeyframePayload[] = []
      for (let i = 0; i <= steps; i++) {
        const frame = Math.round((i / steps) * len)
        const decay = 1 - i / steps
        const value = ctx.anchor.x + (i % 2 === 0 ? 0 : amp) * decay * (i % 4 < 2 ? 1 : -1)
        payloads.push(kf('x', frame, value, EASE_IN_OUT))
      }
      payloads.push(kf('x', len, ctx.anchor.x, LINEAR))
      return payloads
    },
  },
  {
    id: 'wobble',
    category: 'emphasis',
    labelKey: 'wobble',
    thumbnail: { kind: 'wobble' },
    properties: ['rotation'],
    build: (ctx) =>
      buildEmphasis(ctx, (s, m, e) => [
        kf('rotation', s, ctx.anchor.rotation, 'ease-out'),
        kf('rotation', Math.round(m / 2), ctx.anchor.rotation + 8, EASE_IN_OUT),
        kf('rotation', m, ctx.anchor.rotation - 8, EASE_IN_OUT),
        kf('rotation', Math.round((m + e) / 2), ctx.anchor.rotation + 4, EASE_IN_OUT),
        kf('rotation', e, ctx.anchor.rotation, 'ease-in'),
      ]),
  },
  {
    id: 'flash',
    category: 'emphasis',
    labelKey: 'flash',
    thumbnail: { kind: 'fade' },
    properties: ['opacity'],
    build: (ctx) =>
      buildEmphasis(ctx, (s, m, e) => [
        kf('opacity', s, ctx.anchor.opacity, 'ease-out'),
        kf('opacity', m, ctx.anchor.opacity * 0.15, EASE_IN_OUT),
        kf('opacity', e, ctx.anchor.opacity, 'ease-in'),
      ]),
  },

  // --- Loop ---
  {
    id: 'float',
    category: 'loop',
    labelKey: 'float',
    thumbnail: { kind: 'slide', angle: 90, loop: true },
    properties: ['y'],
    build: (ctx) => buildSineLoop(ctx, 'y', ctx.anchor.y, clamp(ctx.frameHeight * 0.015, 6, 24)),
  },
  {
    id: 'sway',
    category: 'loop',
    labelKey: 'sway',
    thumbnail: { kind: 'wobble', loop: true },
    properties: ['rotation'],
    build: (ctx) => buildSineLoop(ctx, 'rotation', ctx.anchor.rotation, 4),
  },
  {
    id: 'breathe',
    category: 'loop',
    labelKey: 'breathe',
    thumbnail: { kind: 'pulse', loop: true },
    properties: ['width', 'height'],
    build: (ctx) => {
      const w = buildSineLoop(ctx, 'width', ctx.anchor.width, ctx.anchor.width * 0.04)
      const h = buildSineLoop(ctx, 'height', ctx.anchor.height, ctx.anchor.height * 0.04)
      return [...w, ...h]
    },
  },
  {
    id: 'spin',
    category: 'loop',
    labelKey: 'spin',
    thumbnail: { kind: 'spin', loop: true },
    properties: ['rotation'],
    build: (ctx) => {
      const last = ctx.durationInFrames - 1
      if (last <= 1) return []
      const cycles = loopCycles(ctx)
      const steps = cycles * 4
      const payloads: MotionPresetKeyframePayload[] = []
      for (let i = 0; i <= steps; i++) {
        const frame = Math.round((i / steps) * last)
        const value = ctx.anchor.rotation + (i / steps) * 360 * cycles
        payloads.push(kf('rotation', frame, value, LINEAR))
      }
      return payloads
    },
  },
  {
    id: 'wiggle',
    category: 'loop',
    labelKey: 'wiggle',
    thumbnail: { kind: 'wiggle', loop: true },
    properties: ['x', 'y'],
    build: (ctx) => {
      const last = ctx.durationInFrames - 1
      if (last <= 1) return []
      const ampX = clamp(ctx.frameWidth * 0.015, 6, 30)
      const ampY = clamp(ctx.frameHeight * 0.015, 6, 30)
      const stepFrames = Math.max(2, Math.round(ctx.fps / 6))
      const payloads: MotionPresetKeyframePayload[] = []
      for (let frame = 0, i = 0; frame <= last; frame += stepFrames, i++) {
        const f = Math.min(frame, last)
        payloads.push(kf('x', f, ctx.anchor.x + hashNoise(i * 2 + 1) * ampX, EASE_IN_OUT))
        payloads.push(kf('y', f, ctx.anchor.y + hashNoise(i * 2 + 2) * ampY, EASE_IN_OUT))
      }
      return payloads
    },
  },
]

export const MOTION_PRESETS_BY_ID: Record<MotionPresetId, MotionPreset> = Object.fromEntries(
  MOTION_PRESETS.map((preset) => [preset.id, preset]),
) as Record<MotionPresetId, MotionPreset>

export const MOTION_PRESET_CATEGORIES: MotionPresetCategory[] = [
  'entrance',
  'exit',
  'emphasis',
  'loop',
]

/**
 * Whether a preset animates the clip box (`width`/`height`). On text clips this
 * reflows the type rather than scaling it, so the Animate grid gates these out
 * for text — text has its own reflow-safe presets in the properties sidebar.
 */
export function motionPresetScalesBox(preset: MotionPreset): boolean {
  return preset.properties.includes('width') || preset.properties.includes('height')
}
