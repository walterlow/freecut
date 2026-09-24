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
 * preview ref and the playback store. Capture rebuilds the same descriptor list
 * the preview has always held, so it runs once per gesture; paint runs once per
 * animation frame, resolves its geometry as numbers and strings first, and
 * writes straight through without allocating per target.
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

/**
 * Inline length as pixels.
 *
 * A percentage is relative to the axis it sits on rather than to the element's
 * own box, and a length that does not parse falls back to the box edge the
 * element was already laid out at.
 */
function resolveMotionInlinePixels(value: string, referenceWidth: number, fallback: number): number {
  const parsed = Number.parseFloat(value)
  if (!Number.isFinite(parsed)) return fallback
  return value.trim().endsWith('%') ? (parsed / 100) * referenceWidth : parsed
}

/**
 * One grid lane's captured geometry, or `null` when it has no measurable axis.
 *
 * The frame list is read back so the preview can restore it once the gesture
 * settles, instead of recomputing what the last committed range drew.
 */
function resolveMotionViewportPreviewGrid(element: HTMLElement): MotionViewportPreviewGrid | null {
  const surface = element.closest<HTMLElement>('[data-motion-viewport-surface]')
  const surfaceWidth = Math.max(
    0,
    Number(surface?.dataset.motionViewportAxisWidth) || surface?.clientWidth || 0,
  )
  if (surfaceWidth <= 0) return null
  const edgeInset = Math.max(0, Number(surface?.dataset.motionViewportEdgeInset ?? 0))
  const framesAttribute = element.dataset.motionGridFrames ?? ''
  const frames = framesAttribute.split(',').map(Number).filter(Number.isFinite)
  if (frames.length === 0) return null
  return {
    element,
    edgeInset,
    usableWidth: Math.max(1, surfaceWidth - edgeInset * 2),
    frames,
    framesAttribute,
    cssText: element.style.cssText,
    willChange: element.style.willChange,
  }
}

/**
 * The frame and span a positioned preview target stands for.
 *
 * A target that carries semantic frames — a keyframe, a dope-sheet point — is
 * followed through them, so the preview tracks the item rather than the pixels
 * it happened to be painted at. Anything else falls back to the frame its own
 * edge lands on.
 */
function resolveMotionViewportPreviewElementFrames(input: {
  element: HTMLElement
  edgeInset: number
  usableWidth: number
  leftPx: number
  widthPx: number
  hasInlineWidth: boolean
  baseStartFrame: number
  baseRange: number
}): { frame: number; frameSpan: number | null } {
  const semanticRangeFromFrame = Number(input.element.dataset.fromFrame)
  const semanticPointFrame = Number(input.element.dataset.dopesheetFrame)
  const semanticFromFrame = Number.isFinite(semanticRangeFromFrame)
    ? semanticRangeFromFrame
    : semanticPointFrame
  const semanticToFrame = Number(input.element.dataset.toFrame)
  const hasSemanticFromFrame = Number.isFinite(semanticFromFrame)
  const hasSemanticToFrame = Number.isFinite(semanticToFrame)
  return {
    frame: hasSemanticFromFrame
      ? semanticFromFrame
      : input.baseStartFrame +
        ((input.leftPx - input.edgeInset) / input.usableWidth) * input.baseRange,
    frameSpan: input.hasInlineWidth
      ? hasSemanticFromFrame && hasSemanticToFrame
        ? semanticToFrame - semanticFromFrame
        : (input.widthPx / input.usableWidth) * input.baseRange
      : null,
  }
}

/**
 * Capture one positioned target of a viewport surface.
 *
 * `null` for anything the preview leaves alone: another surface's element, a
 * static division, a grid, or an element with no left edge to move.
 */
function resolveMotionViewportPreviewElement(input: {
  element: HTMLElement
  surface: HTMLElement
  surfaceWidth: number
  edgeInset: number
  usableWidth: number
  baseViewport: MotionTimeViewport
  baseRange: number
}): MotionViewportPreviewElement | null {
  const { element, surfaceWidth, edgeInset, usableWidth } = input
  if (
    element.closest<HTMLElement>('[data-motion-viewport-surface]') !== input.surface ||
    element.hasAttribute('data-motion-static-x') ||
    element.hasAttribute('data-motion-grid-frames') ||
    element.style.left === ''
  ) {
    return null
  }
  const hasInlineWidth = element.style.width !== ''
  const leftPx = resolveMotionInlinePixels(element.style.left, surfaceWidth, element.offsetLeft)
  const widthPx = hasInlineWidth
    ? resolveMotionInlinePixels(element.style.width, surfaceWidth, element.offsetWidth)
    : 0
  const { frame, frameSpan } = resolveMotionViewportPreviewElementFrames({
    element,
    edgeInset,
    usableWidth,
    leftPx,
    widthPx,
    hasInlineWidth,
    baseStartFrame: input.baseViewport.startFrame,
    baseRange: input.baseRange,
  })
  return {
    element,
    edgeInset,
    usableWidth,
    frame,
    frameSpan,
    clampToSurface: element.hasAttribute('data-motion-viewport-clamp'),
    left: element.style.left,
    width: element.style.width,
    willChange: element.style.willChange,
  }
}

/** Capture every positioned target of one viewport surface. */
function collectMotionViewportSurfaceElements(input: {
  surface: HTMLElement
  surfaceWidth: number
  edgeInset: number
  usableWidth: number
  baseViewport: MotionTimeViewport
  baseRange: number
}): MotionViewportPreviewElement[] {
  const elements: MotionViewportPreviewElement[] = []
  for (const element of input.surface.querySelectorAll<HTMLElement>('*')) {
    const descriptor = resolveMotionViewportPreviewElement({ element, ...input })
    if (!descriptor) continue
    elements.push(descriptor)
    // Targets that already carry a width keep it in step with the preview.
    element.style.willChange = element.style.width === '' ? 'left' : 'left, width'
  }
  return elements
}

/** Capture the grids the preview reticks while it moves the viewport. */
export function collectMotionViewportPreviewGrids(root: HTMLElement): MotionViewportPreviewGrid[] {
  const grids: MotionViewportPreviewGrid[] = []
  for (const element of root.querySelectorAll<HTMLElement>('[data-motion-grid-frames]')) {
    const grid = resolveMotionViewportPreviewGrid(element)
    if (grid) grids.push(grid)
  }
  return grids
}

/** Capture every positioned target the preview slides while it moves the viewport. */
export function collectMotionViewportPreviewElements(input: {
  root: HTMLElement
  baseViewport: MotionTimeViewport
  baseRange: number
}): MotionViewportPreviewElement[] {
  const elements: MotionViewportPreviewElement[] = []
  for (const surface of input.root.querySelectorAll<HTMLElement>('[data-motion-viewport-surface]')) {
    const surfaceWidth = Math.max(
      0,
      Number(surface.dataset.motionViewportAxisWidth) || surface.clientWidth,
    )
    if (surfaceWidth <= 0 || surface.hasAttribute('data-motion-ruler-surface')) continue
    const edgeInset = Math.max(0, Number(surface.dataset.motionViewportEdgeInset ?? 0))
    elements.push(
      ...collectMotionViewportSurfaceElements({
        surface,
        surfaceWidth,
        edgeInset,
        usableWidth: Math.max(1, surfaceWidth - edgeInset * 2),
        baseViewport: input.baseViewport,
        baseRange: input.baseRange,
      }),
    )
  }
  return elements
}

/** Capture the shared playhead, unless its axis is too narrow to place it. */
export function collectMotionViewportPreviewPlayhead(
  element: HTMLElement | null,
): MotionViewportPreviewPlayhead | null {
  const width = element?.parentElement?.clientWidth ?? 0
  if (!element || width <= 0) return null
  return {
    element,
    width,
    transform: element.style.transform,
    hidden: element.hidden,
  }
}

/** Capture the ruler's tick labels, which the preview refills with frame times. */
export function collectMotionViewportPreviewRulerLabels(
  root: HTMLElement,
): MotionViewportPreviewRulerLabel[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>('[data-motion-ruler-label-index]'),
    (element) => ({
      element,
      index: Number(element.dataset.motionRulerLabelIndex ?? 0),
      text: element.textContent ?? '',
    }),
  )
}

/** Capture the navigator's range and thumb, while it has one to move. */
export function collectMotionViewportPreviewNavigator(
  element: HTMLElement | null,
): MotionViewportPreviewNavigator | null {
  const thumb = element?.querySelector<HTMLElement>('[data-testid="keyframe-navigator-thumb"]')
  if (!element || !thumb) return null
  return {
    element,
    startFrame: element.dataset.startFrame ?? '',
    endFrame: element.dataset.endFrame ?? '',
    thumb,
    thumbLeft: thumb.style.left,
    thumbWidth: thumb.style.width,
    trackWidth: thumb.parentElement?.clientWidth ?? 0,
  }
}
