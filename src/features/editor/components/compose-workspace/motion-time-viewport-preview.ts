import { getKeyframeNavigatorThumbMetrics, getNiceTickStep } from '@/features/editor/deps/timeline-motion'
import {
  RULER_DIVISIONS,
  type MotionViewportPreviewElement,
  type MotionViewportPreviewGrid,
  type MotionViewportPreviewNavigator,
  type MotionViewportPreviewPlayhead,
  type MotionViewportPreviewRulerLabel,
} from './motion-timeline-primitives'
import { formatFrameTime, type MotionTimeViewport } from './motion-time-viewport-controller'

/**
 * The imperative time-viewport preview: what it captures off the DOM, and what
 * it paints back between animation frames.
 *
 * The preview exists so a wheel, zoom or scrub can move the axis without a
 * React render. Everything here is called from the one place that owns the
 * preview ref and the playback store, so each step stays a plain sequence of
 * reads or writes in the order that caller already used: the geometry is
 * resolved as numbers and strings first, and each paint step writes straight
 * through, allocating nothing per target.
 */

/** Divisions and border width of a lane that shares one absolute frame grid. */
interface MotionSharedGridDivision {
  divisionCount: number
  borderWidth: number
}

/** The frame/inset fields any positioned preview target exposes. */
interface MotionViewportTargetGeometry {
  frame: number
  frameSpan: number | null
  edgeInset: number
  usableWidth: number
  clampToSurface: boolean
}

/** What one grid element paints for the current viewport. */
interface MotionViewportGridPaint {
  frames: number[]
  cssText: string
}

/** Where the shared playhead sits, and whether the axis should show it. */
interface MotionViewportPlayheadPaint {
  hidden: boolean
  translateX: number
}

/**
 * Read the shared-division override off a grid's lane, if it has one.
 *
 * Divided lanes paint one tick per division instead of derived nice-ticks, so
 * the override wins whenever the division count is a real positive number.
 */
function readMotionSharedGridDivision(element: HTMLElement): MotionSharedGridDivision | null {
  const sharedGridRoot = element.closest<HTMLElement>('[data-motion-shared-grid-divisions]')
  const divisionCount = Number(sharedGridRoot?.dataset.motionSharedGridDivisions)
  if (!Number.isFinite(divisionCount) || divisionCount <= 0) return null
  return {
    divisionCount,
    borderWidth: Math.max(0, Number(sharedGridRoot?.dataset.motionSharedGridBorderWidth) || 0),
  }
}

/**
 * Frames and inline style for one grid at the current viewport.
 *
 * `null` means the grid has nothing to draw, which the caller skips rather than
 * clearing the element's existing ticks.
 */
function resolveMotionViewportGridPaint(input: {
  viewport: MotionTimeViewport
  nextRange: number
  edgeInset: number
  usableWidth: number
  shared: MotionSharedGridDivision | null
}): MotionViewportGridPaint | null {
  const { viewport, nextRange, edgeInset, usableWidth, shared } = input
  const frames: number[] = []
  if (shared) {
    for (let index = 0; index <= shared.divisionCount; index += 1) {
      frames.push(viewport.startFrame + (index / shared.divisionCount) * nextRange)
    }
  } else {
    const tickStep = getNiceTickStep(nextRange)
    const firstTick = Math.floor(viewport.startFrame / tickStep) * tickStep
    for (let frame = firstTick; frame <= viewport.endFrame; frame += tickStep) {
      frames.push(frame)
    }
  }
  if (frames.length === 0) return null

  // A divided lane draws from the lane's own edge, so its first tick sits a
  // border width outside the inset axis the non-shared grid uses.
  const origin = shared ? -shared.borderWidth : edgeInset
  const width = shared ? usableWidth + edgeInset * 2 + shared.borderWidth : usableWidth
  const firstFrame = frames[0]!
  const firstX = Math.round(origin + ((firstFrame - viewport.startFrame) / nextRange) * width)
  const shadows: string[] = []
  for (let index = 1; index < frames.length; index += 1) {
    const x = Math.round(origin + ((frames[index]! - viewport.startFrame) / nextRange) * width)
    shadows.push(`${x - firstX}px 0 currentColor`)
  }
  return {
    frames,
    cssText: `left: ${firstX}px; box-shadow: ${shadows.join(', ')}; will-change: left, box-shadow;`,
  }
}

/** Left edge of a preview target, clamped to its surface when it asks for it. */
function resolveMotionViewportTargetLeft(
  target: MotionViewportTargetGeometry,
  viewport: MotionTimeViewport,
  nextRange: number,
): number {
  const rawLeft =
    target.edgeInset + ((target.frame - viewport.startFrame) / nextRange) * target.usableWidth
  if (!target.clampToSurface) return rawLeft
  return Math.max(target.edgeInset, Math.min(target.edgeInset + target.usableWidth, rawLeft))
}

/**
 * Painted width of a spanned preview target, measured from its unclamped right
 * edge — both edges clamp independently, so `left` is only the floor.
 *
 * `null` for a target that draws a point rather than a span; the caller leaves
 * its width untouched.
 */
function resolveMotionViewportTargetWidth(
  target: MotionViewportTargetGeometry,
  viewport: MotionTimeViewport,
  nextRange: number,
  left: number,
): number | null {
  if (target.frameSpan === null) return null
  const rawRight =
    target.edgeInset +
    ((target.frame - viewport.startFrame) / nextRange) * target.usableWidth +
    (target.frameSpan / nextRange) * target.usableWidth
  const right = target.clampToSurface
    ? Math.max(target.edgeInset, Math.min(target.edgeInset + target.usableWidth, rawRight))
    : rawRight
  return Math.max(0, right - left)
}

/**
 * Where the shared playhead sits, and whether the axis should show it at all.
 *
 * While the pointer scrubs, the playhead follows the pointer even when that
 * puts it outside the drawn frame range, so visibility is only derived from the
 * playback frame when there is no scrub progress to follow.
 */
function resolveMotionViewportPlayheadPaint(input: {
  width: number
  frame: number
  viewport: MotionTimeViewport
  nextRange: number
  scrubProgress: number | undefined
}): MotionViewportPlayheadPaint {
  const { width, frame, viewport, nextRange, scrubProgress } = input
  if (scrubProgress === undefined) {
    return {
      hidden: frame < viewport.startFrame || frame > viewport.endFrame,
      translateX: ((frame - viewport.startFrame) / nextRange) * width,
    }
  }
  const progress = Math.max(0, Math.min(1, scrubProgress))
  return {
    hidden: false,
    translateX: Math.max(0, Math.min(Math.max(0, width - 1), progress * width)),
  }
}

/** Retick every grid lane for the viewport the preview is following. */
export function paintMotionViewportGrids(
  grids: MotionViewportPreviewGrid[],
  viewport: MotionTimeViewport,
  nextRange: number,
): void {
  for (const grid of grids) {
    const paint = resolveMotionViewportGridPaint({
      viewport,
      nextRange,
      edgeInset: grid.edgeInset,
      usableWidth: grid.usableWidth,
      shared: readMotionSharedGridDivision(grid.element),
    })
    if (!paint) continue
    grid.element.dataset.motionGridFrames = paint.frames.join(',')
    grid.element.style.cssText = paint.cssText
  }
}

/** Slide every keyframe, span and segment the preview captured. */
export function paintMotionViewportTargets(
  elements: MotionViewportPreviewElement[],
  viewport: MotionTimeViewport,
  nextRange: number,
): void {
  for (const target of elements) {
    const left = resolveMotionViewportTargetLeft(target, viewport, nextRange)
    target.element.style.left = `${left}px`
    const width = resolveMotionViewportTargetWidth(target, viewport, nextRange, left)
    if (width !== null) target.element.style.width = `${width}px`
  }
}

/** Point the shared playhead at the playback frame, or at the scrub pointer. */
export function paintMotionViewportPlayhead(
  playhead: MotionViewportPreviewPlayhead,
  input: {
    frame: number
    viewport: MotionTimeViewport
    nextRange: number
    scrubProgress: number | undefined
  },
): void {
  const paint = resolveMotionViewportPlayheadPaint({
    width: playhead.width,
    frame: input.frame,
    viewport: input.viewport,
    nextRange: input.nextRange,
    scrubProgress: input.scrubProgress,
  })
  playhead.element.hidden = paint.hidden
  playhead.element.style.transform = `translate3d(${paint.translateX}px, 0, 0)`
}

/** Refill the ruler's tick labels with the viewport's frame times. */
export function paintMotionViewportRulerLabels(
  labels: MotionViewportPreviewRulerLabel[],
  viewport: MotionTimeViewport,
  nextRange: number,
  fps: number,
): void {
  for (const label of labels) {
    const frame = Math.round(viewport.startFrame + (label.index / RULER_DIVISIONS) * nextRange)
    label.element.textContent = formatFrameTime(frame, fps)
  }
}

/** Move the navigator's frame range and thumb onto the previewed viewport. */
export function paintMotionViewportNavigator(
  navigator: MotionViewportPreviewNavigator,
  viewport: MotionTimeViewport,
  contentFrameMax: number,
): void {
  navigator.element.dataset.startFrame = String(viewport.startFrame)
  navigator.element.dataset.endFrame = String(viewport.endFrame)
  if (navigator.trackWidth <= 0) return
  const metrics = getKeyframeNavigatorThumbMetrics({
    viewport,
    contentFrameMax,
    trackWidth: navigator.trackWidth,
  })
  navigator.thumb.style.left = `${metrics.thumbLeft}px`
  navigator.thumb.style.width = `${metrics.thumbWidth}px`
}
