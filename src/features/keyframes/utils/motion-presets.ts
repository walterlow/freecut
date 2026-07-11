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

export type MotionPresetCategory = 'entrance' | 'exit' | 'emphasis' | 'camera'

export type MotionPresetId =
  // camera — full-clip cinematic moves for stills (Ken Burns family)
  | 'push-in-slow'
  | 'push-in'
  | 'push-in-fast'
  | 'pull-back-slow'
  | 'pull-back'
  | 'pull-back-fast'
  | 'pan-left'
  | 'pan-right'
  | 'pan-left-slow'
  | 'pan-right-slow'
  | 'tilt-up'
  | 'tilt-down'
  | 'tilt-up-slow'
  | 'tilt-down-slow'
  | 'kb-in-up-left'
  | 'kb-in-up-right'
  | 'kb-in-down-left'
  | 'kb-in-down-right'
  | 'kb-out-up-left'
  | 'kb-out-up-right'
  | 'kb-out-down-left'
  | 'kb-out-down-right'
  | 'push-pan-left'
  | 'push-pan-right'
  | 'stage-push-pan-left'
  | 'stage-push-pan-right'
  | 'stage-push-tilt-up'
  | 'stage-push-tilt-down'
  | 'surge-down-right'
  | 'surge-down-left'
  | 'surge-up-right'
  | 'surge-up-left'
  | 'surge-dutch-right'
  | 'surge-dutch-left'
  | 'compound-push-pan-left'
  | 'compound-push-pan-right'
  | 'compound-push-tilt-up'
  | 'compound-push-tilt-down'
  | 'compound-pull-pan-left'
  | 'compound-pull-pan-right'
  | 'compound-pull-tilt-up'
  | 'compound-pull-tilt-down'
  | 'magnates-orbit-left'
  | 'magnates-orbit-right'
  | 'magnates-rise-left'
  | 'magnates-dive-right'
  | 'magnates-establishing'
  | 'magnates-medium-push'
  | 'magnates-detail-left'
  | 'magnates-macro-right'
  | 'magnates-pull-reveal'
  | 'magnates-foreground-sweep'
  | 'pull-pan-left'
  | 'pull-pan-right'
  | 'push-tilt-up'
  | 'push-tilt-down'
  | 'pull-tilt-up'
  | 'pull-tilt-down'
  | 'roll-cw'
  | 'roll-ccw'
  | 'dutch-push-cw'
  | 'dutch-push-ccw'
  | 'arc-left'
  | 'arc-right'
  | 'crash-in'
  | 'crash-out'
  | 'creep-in'
  | 'creep-out'
  | 'float'
  | 'handheld'
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

/**
 * Visual descriptor the sidebar uses to render an animated thumbnail. Kept
 * separate from `MotionPresetId` so several presets can share one motion glyph
 * (e.g. all four slide directions reuse the `slide` thumbnail with an angle).
 */
export interface MotionThumbnail {
  kind:
    | 'fade'
    | 'slide'
    | 'scale'
    | 'spin'
    | 'bounce'
    | 'pulse'
    | 'shake'
    | 'wobble'
    | 'wiggle'
    | 'drift'
    | 'micro-shake'
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

// Camera-move curves. A camera operator never snaps a move — these are tuned
// so the start/stop of a full-clip move is imperceptible ("seamless").
/** Sinusoidal S-curve — the default glide for dolly/pan/tilt moves. */
const CAMERA_GLIDE: EasingConfig = {
  type: 'cubic-bezier',
  bezier: { x1: 0.37, y1: 0, x2: 0.63, y2: 1 },
}
/** Long decelerating settle — crash-out / whip-settle moves. */
const CAMERA_SETTLE: EasingConfig = {
  type: 'cubic-bezier',
  bezier: { x1: 0.22, y1: 1, x2: 0.36, y2: 1 },
}
/** Accelerating ramp — dramatic crash-in push. */
const CAMERA_RAMP: EasingConfig = {
  type: 'cubic-bezier',
  bezier: { x1: 0.64, y1: 0, x2: 0.78, y2: 0.2 },
}
/** Decisive high-end move: quick intent followed by a controlled cinematic settle. */
const CAMERA_COMPOUND_DRIVE: EasingConfig = {
  type: 'cubic-bezier',
  bezier: { x1: 0.28, y1: 0.05, x2: 0.22, y2: 1 },
}

// --- Geometry / timing constants --------------------------------------------

const ENTRANCE_SECONDS = 0.5
const EMPHASIS_SECONDS = 0.6

/**
 * The frame at which the clip sits at its resting transform for `category`.
 * Entrance settles at the end of its window; exit starts settled; emphasis
 * rests at the clip's first frame.
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
    case 'camera':
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

// --- Camera moves (Ken Burns engine) -----------------------------------------
// Full-clip virtual-camera moves designed for still images. Scale amplitudes
// stay in the 3–35% range so pixels never visibly soften; pans/tilts carry a
// locked "cover" zoom so the image edge is never revealed mid-move. All moves
// run frame 0 → last frame, so a cut lands mid-motion — the classic seamless
// documentary feel.

interface CameraMoveSpec {
  /** Scale multiplier on the resting size at the first frame (default 1). */
  scaleFrom?: number
  /** Scale multiplier at the last frame (defaults to `scaleFrom` = locked). */
  scaleTo?: number
  /** Total horizontal travel as a fraction of frame width (+ drifts right). */
  panX?: number
  /** Total vertical travel as a fraction of frame height (+ drifts down). */
  panY?: number
  /** Rotation offset in degrees at the first frame. */
  rollFrom?: number
  /** Rotation offset in degrees at the last frame (defaults to `rollFrom`). */
  rollTo?: number
  /** Segment curve; camera glide unless overridden. */
  easing?: EasingConfig | 'linear'
}

interface StagedCameraMoveSpec {
  /** Tiny cover zoom at the first frame so the later move never exposes edges. */
  scaleFrom?: number
  /** End of the fast push-in beat. */
  scaleMid?: number
  /** Final scale after the secondary camera direction finishes. */
  scaleTo?: number
  /** Final horizontal travel as a fraction of frame width (+ drifts right). */
  panX?: number
  /** Final vertical travel as a fraction of frame height (+ drifts down). */
  panY?: number
  /** Optional final roll in degrees. */
  rollTo?: number
  /** Fraction of the clip used by the first push-in beat. */
  split?: number
}

function cameraPair(
  property: AnimatableProperty,
  lastFrame: number,
  from: number,
  to: number,
  easing: EasingConfig | 'linear',
): MotionPresetKeyframePayload[] {
  return easing === 'linear'
    ? [kf(property, 0, from, LINEAR), kf(property, lastFrame, to, LINEAR)]
    : [kf(property, 0, from, 'cubic-bezier', easing), kf(property, lastFrame, to, LINEAR)]
}

function buildCameraScaleKeyframes(
  ctx: MotionPresetBuildContext,
  spec: CameraMoveSpec,
  lastFrame: number,
  easing: EasingConfig | 'linear',
): MotionPresetKeyframePayload[] {
  const scaleFrom = spec.scaleFrom ?? 1
  const scaleTo = spec.scaleTo ?? scaleFrom
  if (scaleFrom === 1 && scaleTo === 1) return []

  return [
    ...cameraPair(
      'width',
      lastFrame,
      ctx.anchor.width * scaleFrom,
      ctx.anchor.width * scaleTo,
      easing,
    ),
    ...cameraPair(
      'height',
      lastFrame,
      ctx.anchor.height * scaleFrom,
      ctx.anchor.height * scaleTo,
      easing,
    ),
  ]
}

function buildCameraPanKeyframes(
  property: 'x' | 'y',
  anchorValue: number,
  frameSize: number,
  travelRatio: number,
  lastFrame: number,
  easing: EasingConfig | 'linear',
): MotionPresetKeyframePayload[] {
  if (travelRatio === 0) return []
  const travel = frameSize * travelRatio
  return cameraPair(property, lastFrame, anchorValue - travel / 2, anchorValue + travel / 2, easing)
}

function buildCameraRollKeyframes(
  ctx: MotionPresetBuildContext,
  spec: CameraMoveSpec,
  lastFrame: number,
  easing: EasingConfig | 'linear',
): MotionPresetKeyframePayload[] {
  const rollFrom = spec.rollFrom ?? 0
  const rollTo = spec.rollTo ?? rollFrom
  if (rollFrom === 0 && rollTo === 0) return []

  return cameraPair(
    'rotation',
    lastFrame,
    ctx.anchor.rotation + rollFrom,
    ctx.anchor.rotation + rollTo,
    easing,
  )
}

function buildCameraMove(
  ctx: MotionPresetBuildContext,
  spec: CameraMoveSpec,
): MotionPresetKeyframePayload[] {
  const last = ctx.durationInFrames - 1
  if (last <= 0) return []
  const easing = spec.easing ?? CAMERA_GLIDE

  return [
    ...buildCameraScaleKeyframes(ctx, spec, last, easing),
    ...buildCameraPanKeyframes('x', ctx.anchor.x, ctx.frameWidth, spec.panX ?? 0, last, easing),
    ...buildCameraPanKeyframes('y', ctx.anchor.y, ctx.frameHeight, spec.panY ?? 0, last, easing),
    ...buildCameraRollKeyframes(ctx, spec, last, easing),
  ]
}

function stagedFrame(lastFrame: number, split: number): number {
  return clamp(Math.round(lastFrame * split), 1, Math.max(1, lastFrame - 1))
}

function stagedScaleKeyframes(
  ctx: MotionPresetBuildContext,
  spec: StagedCameraMoveSpec,
  midFrame: number,
  lastFrame: number,
): MotionPresetKeyframePayload[] {
  const scaleFrom = spec.scaleFrom ?? 1.03
  const scaleMid = spec.scaleMid ?? 1.15
  const scaleTo = spec.scaleTo ?? 1.2
  return [
    kf('width', 0, ctx.anchor.width * scaleFrom, 'cubic-bezier', CAMERA_RAMP),
    kf('width', midFrame, ctx.anchor.width * scaleMid, 'cubic-bezier', CAMERA_GLIDE),
    kf('width', lastFrame, ctx.anchor.width * scaleTo, LINEAR),
    kf('height', 0, ctx.anchor.height * scaleFrom, 'cubic-bezier', CAMERA_RAMP),
    kf('height', midFrame, ctx.anchor.height * scaleMid, 'cubic-bezier', CAMERA_GLIDE),
    kf('height', lastFrame, ctx.anchor.height * scaleTo, LINEAR),
  ]
}

function stagedTravelKeyframes(
  property: 'x' | 'y',
  anchorValue: number,
  frameSize: number,
  travelRatio: number,
  midFrame: number,
  lastFrame: number,
): MotionPresetKeyframePayload[] {
  if (travelRatio === 0) return []
  return [
    kf(property, 0, anchorValue, 'cubic-bezier', CAMERA_RAMP),
    kf(property, midFrame, anchorValue, 'cubic-bezier', CAMERA_GLIDE),
    kf(property, lastFrame, anchorValue + frameSize * travelRatio, LINEAR),
  ]
}

function stagedRollKeyframes(
  ctx: MotionPresetBuildContext,
  spec: StagedCameraMoveSpec,
  midFrame: number,
  lastFrame: number,
): MotionPresetKeyframePayload[] {
  if (!spec.rollTo) return []
  return [
    kf('rotation', 0, ctx.anchor.rotation, 'cubic-bezier', CAMERA_RAMP),
    kf('rotation', midFrame, ctx.anchor.rotation, 'cubic-bezier', CAMERA_GLIDE),
    kf('rotation', lastFrame, ctx.anchor.rotation + spec.rollTo, LINEAR),
  ]
}

function buildStagedCameraMove(
  ctx: MotionPresetBuildContext,
  spec: StagedCameraMoveSpec,
): MotionPresetKeyframePayload[] {
  const last = ctx.durationInFrames - 1
  if (last <= 0) return []
  if (last < 2) {
    return buildCameraMove(ctx, {
      scaleFrom: spec.scaleFrom ?? 1.03,
      scaleTo: spec.scaleTo ?? 1.2,
      panX: spec.panX,
      panY: spec.panY,
      rollTo: spec.rollTo,
      easing: CAMERA_GLIDE,
    })
  }

  const mid = stagedFrame(last, spec.split ?? 0.45)
  return [
    ...stagedScaleKeyframes(ctx, spec, mid, last),
    ...stagedTravelKeyframes('x', ctx.anchor.x, ctx.frameWidth, spec.panX ?? 0, mid, last),
    ...stagedTravelKeyframes('y', ctx.anchor.y, ctx.frameHeight, spec.panY ?? 0, mid, last),
    ...stagedRollKeyframes(ctx, spec, mid, last),
  ]
}

function surgeTravelKeyframes(
  property: 'x' | 'y',
  anchorValue: number,
  frameSize: number,
  travelRatio: number,
  midFrame: number,
  lastFrame: number,
): MotionPresetKeyframePayload[] {
  if (travelRatio === 0) return []
  const travel = frameSize * travelRatio
  return [
    kf(property, 0, anchorValue - travel * 0.18, 'cubic-bezier', CAMERA_RAMP),
    kf(property, midFrame, anchorValue + travel * 0.42, 'cubic-bezier', CAMERA_GLIDE),
    kf(property, lastFrame, anchorValue + travel, LINEAR),
  ]
}

function surgeRollKeyframes(
  ctx: MotionPresetBuildContext,
  spec: StagedCameraMoveSpec,
  midFrame: number,
  lastFrame: number,
): MotionPresetKeyframePayload[] {
  if (!spec.rollTo) return []
  return [
    kf('rotation', 0, ctx.anchor.rotation - spec.rollTo * 0.3, 'cubic-bezier', CAMERA_RAMP),
    kf(
      'rotation',
      midFrame,
      ctx.anchor.rotation + spec.rollTo * 0.45,
      'cubic-bezier',
      CAMERA_GLIDE,
    ),
    kf('rotation', lastFrame, ctx.anchor.rotation + spec.rollTo, LINEAR),
  ]
}

function buildSurgeCameraMove(
  ctx: MotionPresetBuildContext,
  spec: StagedCameraMoveSpec,
): MotionPresetKeyframePayload[] {
  const last = ctx.durationInFrames - 1
  if (last <= 0) return []
  if (last < 2) {
    return buildCameraMove(ctx, {
      scaleFrom: spec.scaleFrom ?? 1.04,
      scaleTo: spec.scaleTo ?? 1.26,
      panX: spec.panX,
      panY: spec.panY,
      rollTo: spec.rollTo,
      easing: CAMERA_GLIDE,
    })
  }

  const mid = stagedFrame(last, spec.split ?? 0.38)
  return [
    ...stagedScaleKeyframes(ctx, spec, mid, last),
    ...surgeTravelKeyframes('x', ctx.anchor.x, ctx.frameWidth, spec.panX ?? 0, mid, last),
    ...surgeTravelKeyframes('y', ctx.anchor.y, ctx.frameHeight, spec.panY ?? 0, mid, last),
    ...surgeRollKeyframes(ctx, spec, mid, last),
  ]
}

function cameraSpecProperties(spec: CameraMoveSpec): AnimatableProperty[] {
  const properties: AnimatableProperty[] = []
  const scaleFrom = spec.scaleFrom ?? 1
  const scaleTo = spec.scaleTo ?? scaleFrom
  if (scaleFrom !== 1 || scaleTo !== 1) properties.push('width', 'height')
  if (spec.panX) properties.push('x')
  if (spec.panY) properties.push('y')
  if (spec.rollFrom || spec.rollTo) properties.push('rotation')
  return properties
}

function stagedCameraProperties(spec: StagedCameraMoveSpec): AnimatableProperty[] {
  const properties: AnimatableProperty[] = ['width', 'height']
  if (spec.panX) properties.push('x')
  if (spec.panY) properties.push('y')
  if (spec.rollTo) properties.push('rotation')
  return properties
}

function cameraPreset(
  id: MotionPresetId,
  labelKey: string,
  thumbnail: MotionThumbnail,
  spec: CameraMoveSpec,
): MotionPreset {
  return {
    id,
    category: 'camera',
    labelKey,
    thumbnail,
    properties: cameraSpecProperties(spec),
    build: (ctx) => buildCameraMove(ctx, spec),
  }
}

function stagedCameraPreset(
  id: MotionPresetId,
  labelKey: string,
  thumbnail: MotionThumbnail,
  spec: StagedCameraMoveSpec,
): MotionPreset {
  return {
    id,
    category: 'camera',
    labelKey,
    thumbnail,
    properties: stagedCameraProperties(spec),
    build: (ctx) => buildStagedCameraMove(ctx, spec),
  }
}

function surgeCameraPreset(
  id: MotionPresetId,
  labelKey: string,
  thumbnail: MotionThumbnail,
  spec: StagedCameraMoveSpec,
): MotionPreset {
  return {
    id,
    category: 'camera',
    labelKey,
    thumbnail,
    properties: stagedCameraProperties(spec),
    build: (ctx) => buildSurgeCameraMove(ctx, spec),
  }
}

/** Locked cover-zoom keyframes so organic moves never reveal the image edge. */
function cameraLockScale(
  ctx: MotionPresetBuildContext,
  scale: number,
  lastFrame: number,
): MotionPresetKeyframePayload[] {
  return [
    kf('width', 0, ctx.anchor.width * scale, LINEAR),
    kf('width', lastFrame, ctx.anchor.width * scale, LINEAR),
    kf('height', 0, ctx.anchor.height * scale, LINEAR),
    kf('height', lastFrame, ctx.anchor.height * scale, LINEAR),
  ]
}

/** Slow organic float — a gentle S-shaped wander, like a camera on a soft jib. */
function buildFloat(ctx: MotionPresetBuildContext): MotionPresetKeyframePayload[] {
  const last = ctx.durationInFrames - 1
  if (last <= 0) return []
  const ax = ctx.frameWidth * 0.008
  const ay = ctx.frameHeight * 0.01
  const at = (p: number) => Math.round(last * p)
  return [
    ...cameraLockScale(ctx, 1.08, last),
    kf('x', 0, ctx.anchor.x, EASE_IN_OUT),
    kf('x', at(1 / 3), ctx.anchor.x + ax, EASE_IN_OUT),
    kf('x', at(2 / 3), ctx.anchor.x - ax, EASE_IN_OUT),
    kf('x', last, ctx.anchor.x, LINEAR),
    kf('y', 0, ctx.anchor.y, EASE_IN_OUT),
    kf('y', at(0.25), ctx.anchor.y - ay * 0.6, EASE_IN_OUT),
    kf('y', at(0.75), ctx.anchor.y + ay * 0.6, EASE_IN_OUT),
    kf('y', last, ctx.anchor.y, LINEAR),
  ]
}

/** Deterministic hash noise in [-0.5, 0.5) — same clip always bakes the same. */
function cameraHashNoise(seed: number): number {
  const s = Math.sin(seed * 127.1) * 43758.5453
  return s - Math.floor(s) - 0.5
}

/** Baked micro-jitter — documentary handheld energy at a locked cover zoom. */
function buildHandheld(ctx: MotionPresetBuildContext): MotionPresetKeyframePayload[] {
  const last = ctx.durationInFrames - 1
  if (last <= 0) return []
  const step = Math.max(2, Math.round(ctx.fps / 2))
  const ax = ctx.frameWidth * 0.004
  const ay = ctx.frameHeight * 0.005
  const payloads = cameraLockScale(ctx, 1.06, last)
  for (let frame = 0, i = 0; frame < last; frame += step, i++) {
    // Taper toward zero at both ends so the clip cuts in and out at rest.
    const taper = Math.min(1, Math.min(frame, last - frame) / (step * 2))
    payloads.push(
      kf('x', frame, ctx.anchor.x + cameraHashNoise(i * 2 + 1) * 2 * ax * taper, EASE_IN_OUT),
      kf('y', frame, ctx.anchor.y + cameraHashNoise(i * 2 + 2) * 2 * ay * taper, EASE_IN_OUT),
    )
  }
  payloads.push(kf('x', last, ctx.anchor.x, LINEAR), kf('y', last, ctx.anchor.y, LINEAR))
  return payloads
}

const CAMERA_PRESETS: MotionPreset[] = [
  // Push / pull (dolly)
  cameraPreset('push-in-slow', 'pushInSlow', { kind: 'scale', direction: 1 }, { scaleTo: 1.05 }),
  cameraPreset('push-in', 'pushIn', { kind: 'scale', direction: 1 }, { scaleTo: 1.12 }),
  cameraPreset('push-in-fast', 'pushInFast', { kind: 'scale', direction: 1 }, { scaleTo: 1.25 }),
  cameraPreset(
    'pull-back-slow',
    'pullBackSlow',
    { kind: 'scale', direction: -1 },
    { scaleFrom: 1.05, scaleTo: 1 },
  ),
  cameraPreset(
    'pull-back',
    'pullBack',
    { kind: 'scale', direction: -1 },
    { scaleFrom: 1.12, scaleTo: 1 },
  ),
  cameraPreset(
    'pull-back-fast',
    'pullBackFast',
    { kind: 'scale', direction: -1 },
    { scaleFrom: 1.25, scaleTo: 1 },
  ),
  // Pans (locked cover zoom)
  cameraPreset(
    'pan-left',
    'panLeft',
    { kind: 'slide', angle: 180 },
    { scaleFrom: 1.12, panX: -0.06 },
  ),
  cameraPreset(
    'pan-right',
    'panRight',
    { kind: 'slide', angle: 0 },
    { scaleFrom: 1.12, panX: 0.06 },
  ),
  cameraPreset(
    'pan-left-slow',
    'panLeftSlow',
    { kind: 'slide', angle: 180 },
    { scaleFrom: 1.08, panX: -0.03, easing: 'linear' },
  ),
  cameraPreset(
    'pan-right-slow',
    'panRightSlow',
    { kind: 'slide', angle: 0 },
    { scaleFrom: 1.08, panX: 0.03, easing: 'linear' },
  ),
  // Tilts
  cameraPreset(
    'tilt-up',
    'tiltUp',
    { kind: 'slide', angle: 270 },
    { scaleFrom: 1.12, panY: -0.06 },
  ),
  cameraPreset(
    'tilt-down',
    'tiltDown',
    { kind: 'slide', angle: 90 },
    { scaleFrom: 1.12, panY: 0.06 },
  ),
  cameraPreset(
    'tilt-up-slow',
    'tiltUpSlow',
    { kind: 'slide', angle: 270 },
    { scaleFrom: 1.08, panY: -0.03, easing: 'linear' },
  ),
  cameraPreset(
    'tilt-down-slow',
    'tiltDownSlow',
    { kind: 'slide', angle: 90 },
    { scaleFrom: 1.08, panY: 0.03, easing: 'linear' },
  ),
  // Ken Burns diagonals (push/pull + drift)
  cameraPreset(
    'kb-in-up-left',
    'kenBurnsInUpLeft',
    { kind: 'slide', angle: 225 },
    { scaleTo: 1.14, panX: -0.04, panY: -0.04 },
  ),
  cameraPreset(
    'kb-in-up-right',
    'kenBurnsInUpRight',
    { kind: 'slide', angle: 315 },
    { scaleTo: 1.14, panX: 0.04, panY: -0.04 },
  ),
  cameraPreset(
    'kb-in-down-left',
    'kenBurnsInDownLeft',
    { kind: 'slide', angle: 135 },
    { scaleTo: 1.14, panX: -0.04, panY: 0.04 },
  ),
  cameraPreset(
    'kb-in-down-right',
    'kenBurnsInDownRight',
    { kind: 'slide', angle: 45 },
    { scaleTo: 1.14, panX: 0.04, panY: 0.04 },
  ),
  cameraPreset(
    'kb-out-up-left',
    'kenBurnsOutUpLeft',
    { kind: 'slide', angle: 225 },
    { scaleFrom: 1.14, scaleTo: 1, panX: -0.04, panY: -0.04 },
  ),
  cameraPreset(
    'kb-out-up-right',
    'kenBurnsOutUpRight',
    { kind: 'slide', angle: 315 },
    { scaleFrom: 1.14, scaleTo: 1, panX: 0.04, panY: -0.04 },
  ),
  cameraPreset(
    'kb-out-down-left',
    'kenBurnsOutDownLeft',
    { kind: 'slide', angle: 135 },
    { scaleFrom: 1.14, scaleTo: 1, panX: -0.04, panY: 0.04 },
  ),
  cameraPreset(
    'kb-out-down-right',
    'kenBurnsOutDownRight',
    { kind: 'slide', angle: 45 },
    { scaleFrom: 1.14, scaleTo: 1, panX: 0.04, panY: 0.04 },
  ),
  // Push/pull + pan
  cameraPreset(
    'push-pan-left',
    'pushPanLeft',
    { kind: 'slide', angle: 180 },
    { scaleTo: 1.15, panX: -0.05 },
  ),
  cameraPreset(
    'push-pan-right',
    'pushPanRight',
    { kind: 'slide', angle: 0 },
    { scaleTo: 1.15, panX: 0.05 },
  ),
  stagedCameraPreset(
    'stage-push-pan-left',
    'stagePushPanLeft',
    { kind: 'slide', angle: 180 },
    { panX: -0.075 },
  ),
  stagedCameraPreset(
    'stage-push-pan-right',
    'stagePushPanRight',
    { kind: 'slide', angle: 0 },
    { panX: 0.075 },
  ),
  stagedCameraPreset(
    'stage-push-tilt-up',
    'stagePushTiltUp',
    { kind: 'slide', angle: 270 },
    { panY: -0.075 },
  ),
  stagedCameraPreset(
    'stage-push-tilt-down',
    'stagePushTiltDown',
    { kind: 'slide', angle: 90 },
    { panY: 0.075 },
  ),
  surgeCameraPreset(
    'surge-down-right',
    'surgeDownRight',
    { kind: 'slide', angle: 45 },
    { scaleFrom: 1.06, scaleMid: 1.24, scaleTo: 1.36, panX: 0.095, panY: 0.085, split: 0.3 },
  ),
  surgeCameraPreset(
    'surge-down-left',
    'surgeDownLeft',
    { kind: 'slide', angle: 135 },
    { scaleFrom: 1.06, scaleMid: 1.24, scaleTo: 1.36, panX: -0.095, panY: 0.085, split: 0.3 },
  ),
  surgeCameraPreset(
    'surge-up-right',
    'surgeUpRight',
    { kind: 'slide', angle: 315 },
    { scaleFrom: 1.06, scaleMid: 1.23, scaleTo: 1.34, panX: 0.09, panY: -0.08, split: 0.32 },
  ),
  surgeCameraPreset(
    'surge-up-left',
    'surgeUpLeft',
    { kind: 'slide', angle: 225 },
    { scaleFrom: 1.06, scaleMid: 1.23, scaleTo: 1.34, panX: -0.09, panY: -0.08, split: 0.32 },
  ),
  surgeCameraPreset(
    'surge-dutch-right',
    'surgeDutchRight',
    { kind: 'wobble' },
    {
      scaleFrom: 1.07,
      scaleMid: 1.25,
      scaleTo: 1.38,
      panX: 0.085,
      panY: -0.065,
      rollTo: -1.8,
      split: 0.28,
    },
  ),
  surgeCameraPreset(
    'surge-dutch-left',
    'surgeDutchLeft',
    { kind: 'wobble' },
    {
      scaleFrom: 1.07,
      scaleMid: 1.25,
      scaleTo: 1.38,
      panX: -0.085,
      panY: -0.065,
      rollTo: 1.8,
      split: 0.28,
    },
  ),
  // High-end compound moves. Scale and one directional axis travel together
  // for the entire shot, keeping two camera actions active on every frame.
  cameraPreset(
    'compound-push-pan-left',
    'compoundPushPanLeft',
    { kind: 'slide', angle: 180 },
    { scaleFrom: 1.12, scaleTo: 1.28, panX: -0.075, easing: CAMERA_COMPOUND_DRIVE },
  ),
  cameraPreset(
    'compound-push-pan-right',
    'compoundPushPanRight',
    { kind: 'slide', angle: 0 },
    { scaleFrom: 1.12, scaleTo: 1.28, panX: 0.075, easing: CAMERA_COMPOUND_DRIVE },
  ),
  cameraPreset(
    'compound-push-tilt-up',
    'compoundPushTiltUp',
    { kind: 'slide', angle: 270 },
    { scaleFrom: 1.12, scaleTo: 1.28, panY: -0.075, easing: CAMERA_COMPOUND_DRIVE },
  ),
  cameraPreset(
    'compound-push-tilt-down',
    'compoundPushTiltDown',
    { kind: 'slide', angle: 90 },
    { scaleFrom: 1.12, scaleTo: 1.28, panY: 0.075, easing: CAMERA_COMPOUND_DRIVE },
  ),
  cameraPreset(
    'compound-pull-pan-left',
    'compoundPullPanLeft',
    { kind: 'slide', angle: 180 },
    { scaleFrom: 1.28, scaleTo: 1.12, panX: -0.075, easing: CAMERA_COMPOUND_DRIVE },
  ),
  cameraPreset(
    'compound-pull-pan-right',
    'compoundPullPanRight',
    { kind: 'slide', angle: 0 },
    { scaleFrom: 1.28, scaleTo: 1.12, panX: 0.075, easing: CAMERA_COMPOUND_DRIVE },
  ),
  cameraPreset(
    'compound-pull-tilt-up',
    'compoundPullTiltUp',
    { kind: 'slide', angle: 270 },
    { scaleFrom: 1.28, scaleTo: 1.12, panY: -0.075, easing: CAMERA_COMPOUND_DRIVE },
  ),
  cameraPreset(
    'compound-pull-tilt-down',
    'compoundPullTiltDown',
    { kind: 'slide', angle: 90 },
    { scaleFrom: 1.28, scaleTo: 1.12, panY: 0.075, easing: CAMERA_COMPOUND_DRIVE },
  ),
  // Magnates-style 3D documentary moves. Four camera channels travel together
  // so separated foreground/background layers read as a directed virtual set.
  cameraPreset(
    'magnates-orbit-left',
    'magnatesOrbitLeft',
    { kind: 'wobble' },
    {
      scaleFrom: 1.1,
      scaleTo: 1.34,
      panX: -0.09,
      panY: -0.038,
      rollFrom: 0.45,
      rollTo: -1.35,
      easing: CAMERA_COMPOUND_DRIVE,
    },
  ),
  cameraPreset(
    'magnates-orbit-right',
    'magnatesOrbitRight',
    { kind: 'wobble' },
    {
      scaleFrom: 1.1,
      scaleTo: 1.34,
      panX: 0.09,
      panY: -0.038,
      rollFrom: -0.45,
      rollTo: 1.35,
      easing: CAMERA_COMPOUND_DRIVE,
    },
  ),
  cameraPreset(
    'magnates-rise-left',
    'magnatesRiseLeft',
    { kind: 'slide', angle: 225 },
    {
      scaleFrom: 1.32,
      scaleTo: 1.12,
      panX: -0.075,
      panY: -0.07,
      rollFrom: -1.1,
      rollTo: 0.35,
      easing: CAMERA_COMPOUND_DRIVE,
    },
  ),
  cameraPreset(
    'magnates-dive-right',
    'magnatesDiveRight',
    { kind: 'slide', angle: 45 },
    {
      scaleFrom: 1.12,
      scaleTo: 1.31,
      panX: 0.078,
      panY: 0.068,
      rollFrom: 0.9,
      rollTo: -0.4,
      easing: CAMERA_COMPOUND_DRIVE,
    },
  ),
  cameraPreset(
    'magnates-establishing',
    'magnatesEstablishing',
    { kind: 'slide', angle: 315 },
    {
      scaleFrom: 1.035,
      scaleTo: 1.13,
      panX: 0.034,
      panY: -0.024,
      rollFrom: 0.18,
      rollTo: -0.18,
      easing: CAMERA_GLIDE,
    },
  ),
  cameraPreset(
    'magnates-medium-push',
    'magnatesMediumPush',
    { kind: 'slide', angle: 0 },
    {
      scaleFrom: 1.16,
      scaleTo: 1.38,
      panX: 0.064,
      panY: -0.032,
      rollFrom: -0.35,
      rollTo: 0.28,
      easing: CAMERA_COMPOUND_DRIVE,
    },
  ),
  cameraPreset(
    'magnates-detail-left',
    'magnatesDetailLeft',
    { kind: 'slide', angle: 180 },
    {
      scaleFrom: 1.42,
      scaleTo: 1.64,
      panX: -0.095,
      panY: 0.052,
      rollFrom: 0.48,
      rollTo: -0.52,
      easing: CAMERA_COMPOUND_DRIVE,
    },
  ),
  cameraPreset(
    'magnates-macro-right',
    'magnatesMacroRight',
    { kind: 'slide', angle: 45 },
    {
      scaleFrom: 1.72,
      scaleTo: 2.02,
      panX: 0.082,
      panY: 0.062,
      rollFrom: -0.44,
      rollTo: 0.6,
      easing: CAMERA_COMPOUND_DRIVE,
    },
  ),
  cameraPreset(
    'magnates-pull-reveal',
    'magnatesPullReveal',
    { kind: 'slide', angle: 225 },
    {
      scaleFrom: 1.52,
      scaleTo: 1.13,
      panX: -0.058,
      panY: -0.055,
      rollFrom: -0.72,
      rollTo: 0.18,
      easing: CAMERA_COMPOUND_DRIVE,
    },
  ),
  cameraPreset(
    'magnates-foreground-sweep',
    'magnatesForegroundSweep',
    { kind: 'slide', angle: 0 },
    {
      scaleFrom: 1.24,
      scaleTo: 1.5,
      panX: 0.14,
      panY: 0.028,
      rollFrom: 0.75,
      rollTo: -0.65,
      easing: CAMERA_COMPOUND_DRIVE,
    },
  ),
  cameraPreset(
    'pull-pan-left',
    'pullPanLeft',
    { kind: 'slide', angle: 180 },
    { scaleFrom: 1.15, scaleTo: 1, panX: -0.05 },
  ),
  cameraPreset(
    'pull-pan-right',
    'pullPanRight',
    { kind: 'slide', angle: 0 },
    { scaleFrom: 1.15, scaleTo: 1, panX: 0.05 },
  ),
  // Push/pull + tilt
  cameraPreset(
    'push-tilt-up',
    'pushTiltUp',
    { kind: 'slide', angle: 270 },
    { scaleTo: 1.15, panY: -0.05 },
  ),
  cameraPreset(
    'push-tilt-down',
    'pushTiltDown',
    { kind: 'slide', angle: 90 },
    { scaleTo: 1.15, panY: 0.05 },
  ),
  cameraPreset(
    'pull-tilt-up',
    'pullTiltUp',
    { kind: 'slide', angle: 270 },
    { scaleFrom: 1.15, scaleTo: 1, panY: -0.05 },
  ),
  cameraPreset(
    'pull-tilt-down',
    'pullTiltDown',
    { kind: 'slide', angle: 90 },
    { scaleFrom: 1.15, scaleTo: 1, panY: 0.05 },
  ),
  // Roll / dutch
  cameraPreset(
    'roll-cw',
    'rollClockwise',
    { kind: 'spin' },
    { scaleFrom: 1.16, rollFrom: -1.2, rollTo: 1.2 },
  ),
  cameraPreset(
    'roll-ccw',
    'rollCounterClockwise',
    { kind: 'spin' },
    { scaleFrom: 1.16, rollFrom: 1.2, rollTo: -1.2 },
  ),
  cameraPreset(
    'dutch-push-cw',
    'dutchPushClockwise',
    { kind: 'spin' },
    { scaleTo: 1.18, rollTo: 2 },
  ),
  cameraPreset(
    'dutch-push-ccw',
    'dutchPushCounterClockwise',
    { kind: 'spin' },
    { scaleTo: 1.18, rollTo: -2 },
  ),
  // Simulated arcs (pan + counter-tilt + subtle roll)
  cameraPreset(
    'arc-left',
    'arcLeft',
    { kind: 'wobble' },
    { scaleFrom: 1.14, panX: -0.05, panY: -0.015, rollTo: 1.2 },
  ),
  cameraPreset(
    'arc-right',
    'arcRight',
    { kind: 'wobble' },
    { scaleFrom: 1.14, panX: 0.05, panY: -0.015, rollTo: -1.2 },
  ),
  // Specialty
  cameraPreset(
    'crash-in',
    'crashIn',
    { kind: 'scale', direction: 1 },
    { scaleTo: 1.35, easing: CAMERA_RAMP },
  ),
  cameraPreset(
    'crash-out',
    'crashOut',
    { kind: 'scale', direction: -1 },
    { scaleFrom: 1.3, scaleTo: 1, easing: CAMERA_SETTLE },
  ),
  cameraPreset(
    'creep-in',
    'creepIn',
    { kind: 'scale', direction: 1 },
    { scaleTo: 1.03, easing: 'linear' },
  ),
  cameraPreset(
    'creep-out',
    'creepOut',
    { kind: 'scale', direction: -1 },
    { scaleFrom: 1.03, scaleTo: 1, easing: 'linear' },
  ),
  {
    id: 'float',
    category: 'camera',
    labelKey: 'floatDrift',
    thumbnail: { kind: 'drift' },
    properties: ['x', 'y', 'width', 'height'],
    build: buildFloat,
  },
  {
    id: 'handheld',
    category: 'camera',
    labelKey: 'handheld',
    thumbnail: { kind: 'micro-shake' },
    properties: ['x', 'y', 'width', 'height'],
    build: buildHandheld,
  },
]

export const MOTION_PRESETS: MotionPreset[] = [
  ...CAMERA_PRESETS,
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
]

export const MOTION_PRESETS_BY_ID: Record<MotionPresetId, MotionPreset> = Object.fromEntries(
  MOTION_PRESETS.map((preset) => [preset.id, preset]),
) as Record<MotionPresetId, MotionPreset>

export const MOTION_PRESET_CATEGORIES: MotionPresetCategory[] = [
  'camera',
  'entrance',
  'exit',
  'emphasis',
]

export const CAMERA_MOTION_PRESETS: MotionPreset[] = CAMERA_PRESETS

/**
 * Curated rotation used when auto-animating a batch of stills. Ordered like a
 * cinematographer covers a scene: zoom direction flips on every cut and pan
 * direction never repeats back-to-back, so consecutive images always read as
 * fresh coverage rather than a repeated gimmick.
 */
export const AUTO_CAMERA_SEQUENCE: MotionPresetId[] = [
  'push-in-slow',
  'pan-right-slow',
  'pull-back-slow',
  'pan-left-slow',
  'kb-in-up-right',
  'tilt-up-slow',
  'kb-out-down-left',
  'push-in',
  'tilt-down-slow',
  'kb-in-down-right',
  'pull-back',
  'kb-out-up-left',
]

/**
 * More dramatic sequence for story/audiobook stills. Every move combines at
 * least two camera axes (zoom + pan/tilt/roll) so a generated scene never reads
 * as a plain one-direction slideshow move.
 */
export const CINEMATIC_STORY_CAMERA_SEQUENCE: MotionPresetId[] = [
  'surge-down-right',
  'surge-up-left',
  'surge-down-left',
  'surge-up-right',
  'surge-dutch-right',
  'surge-dutch-left',
  'stage-push-pan-right',
  'stage-push-tilt-down',
  'stage-push-pan-left',
  'stage-push-tilt-up',
  'arc-right',
  'push-pan-right',
  'dutch-push-cw',
  'kb-in-down-right',
  'arc-left',
  'dutch-push-ccw',
  'pull-pan-right',
  'kb-out-down-left',
]

/**
 * Premium compound rotation. Each preset continuously combines a dolly move
 * with exactly one pan or tilt axis, while alternating direction and zoom
 * polarity between cuts for varied coverage.
 */
export const COMPOUND_PARALLAX_CAMERA_SEQUENCE: MotionPresetId[] = [
  'compound-push-pan-right',
  'compound-push-tilt-down',
  'compound-pull-pan-left',
  'compound-push-tilt-up',
  'compound-pull-pan-right',
  'compound-push-pan-left',
  'compound-pull-tilt-down',
  'compound-pull-tilt-up',
]

export const MAGNATES_3D_CAMERA_SEQUENCE: MotionPresetId[] = [
  'magnates-establishing',
  'magnates-medium-push',
  'magnates-detail-left',
  'magnates-macro-right',
  'magnates-pull-reveal',
  'magnates-foreground-sweep',
  'magnates-orbit-right',
  'magnates-rise-left',
  'magnates-orbit-left',
  'magnates-dive-right',
]

/** Deterministic pick from the auto-camera rotation for the nth still added. */
export function pickAutoCameraPresetId(index: number): MotionPresetId {
  const length = AUTO_CAMERA_SEQUENCE.length
  return AUTO_CAMERA_SEQUENCE[((index % length) + length) % length]!
}

/** Deterministic pick from the dramatic story-camera rotation. */
export function pickCinematicStoryCameraPresetId(index: number): MotionPresetId {
  const length = CINEMATIC_STORY_CAMERA_SEQUENCE.length
  return CINEMATIC_STORY_CAMERA_SEQUENCE[((index % length) + length) % length]!
}

/** Deterministic pick from the high-end compound parallax rotation. */
export function pickCompoundParallaxCameraPresetId(index: number): MotionPresetId {
  const length = COMPOUND_PARALLAX_CAMERA_SEQUENCE.length
  return COMPOUND_PARALLAX_CAMERA_SEQUENCE[((index % length) + length) % length]!
}

export function pickMagnates3dCameraPresetId(index: number): MotionPresetId {
  const length = MAGNATES_3D_CAMERA_SEQUENCE.length
  return MAGNATES_3D_CAMERA_SEQUENCE[((index % length) + length) % length]!
}

/**
 * Whether a preset animates the clip box (`width`/`height`). On text clips this
 * reflows the type rather than scaling it, so the Animate grid gates these out
 * for text — text has its own reflow-safe presets in the properties sidebar.
 */
export function motionPresetScalesBox(preset: MotionPreset): boolean {
  return preset.properties.includes('width') || preset.properties.includes('height')
}
