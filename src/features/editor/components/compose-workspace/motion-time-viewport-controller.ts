import {
  KEYFRAME_DIAMOND_RENDERED_WIDTH_PX,
  KEYFRAME_EDGE_INSET,
} from '@/features/editor/deps/timeline-motion'

export interface MotionTimeViewport {
  startFrame: number
  endFrame: number
}

type MotionViewportUpdate = (viewport: MotionTimeViewport) => MotionTimeViewport

/** Distance from the pane edge where a scrubbed playhead starts auto-panning. */
const PLAYHEAD_EDGE_SCROLL_ZONE_PX = 48
const PLAYHEAD_EDGE_SCROLL_MAX_PX_PER_SECOND = 720

/** Idle time after the last wheel notch before the viewport commits. */
const WHEEL_VIEWPORT_SETTLE_MS = 100

export function normalizeMotionTimeViewport(
  viewport: MotionTimeViewport,
  totalFrames: number,
  roundToFrames = true,
): MotionTimeViewport {
  const contentEnd = Math.max(1, Math.round(totalFrames))
  const requestedVisibleFrames = viewport.endFrame - viewport.startFrame
  const visibleFrames = Math.max(
    Math.min(1, contentEnd),
    Math.min(
      contentEnd,
      roundToFrames ? Math.round(requestedVisibleFrames) : requestedVisibleFrames,
    ),
  )
  const maxStart = Math.max(0, contentEnd - visibleFrames)
  const requestedStartFrame = roundToFrames ? Math.round(viewport.startFrame) : viewport.startFrame
  const startFrame = Math.max(0, Math.min(maxStart, requestedStartFrame))
  return { startFrame, endFrame: startFrame + visibleFrames }
}

function getMotionTimelinePanGesture(
  event: WheelEvent,
  lockedAxis: 'x' | 'y' | null,
): { axis: 'x' | 'y'; delta: number } | null {
  if (event.ctrlKey || event.metaKey || event.altKey) return null
  if (event.deltaX === 0 && event.deltaY === 0) return null
  const axis = lockedAxis ?? (Math.abs(event.deltaX) > Math.abs(event.deltaY) ? 'x' : 'y')
  return { axis, delta: axis === 'x' ? event.deltaX : event.deltaY }
}

export function getMotionPlayheadEdgeScrollVelocity(
  clientX: number,
  bounds: Pick<DOMRect, 'left' | 'right'>,
): number {
  const leftDepth = PLAYHEAD_EDGE_SCROLL_ZONE_PX - (clientX - bounds.left)
  if (leftDepth > 0) {
    return (
      -PLAYHEAD_EDGE_SCROLL_MAX_PX_PER_SECOND *
      Math.min(1, leftDepth / PLAYHEAD_EDGE_SCROLL_ZONE_PX)
    )
  }
  const rightDepth = PLAYHEAD_EDGE_SCROLL_ZONE_PX - (bounds.right - clientX)
  if (rightDepth > 0) {
    return (
      PLAYHEAD_EDGE_SCROLL_MAX_PX_PER_SECOND *
      Math.min(1, rightDepth / PLAYHEAD_EDGE_SCROLL_ZONE_PX)
    )
  }
  return 0
}

export function panMotionTimeViewport(
  viewport: MotionTimeViewport,
  panPixels: number,
  timelineWidth: number,
  totalFrames: number,
): MotionTimeViewport {
  const currentRange = Math.max(1, viewport.endFrame - viewport.startFrame)
  const deltaFrames = (panPixels / Math.max(1, timelineWidth)) * currentRange
  return normalizeMotionTimeViewport(
    {
      startFrame: viewport.startFrame + deltaFrames,
      endFrame: viewport.endFrame + deltaFrames,
    },
    totalFrames,
    false,
  )
}

/**
 * One animation frame of viewport motion while the playhead is scrubbed.
 *
 * `null` means the pointer is not held deep enough into a pane edge to pan (or
 * the pane has no measurable width), which is also the caller's signal that the
 * scrub clock has stalled. The caller owns the clock: it hands over the reading
 * it stored on the previous frame so this stays a pure function of the pointer
 * position and the elapsed frame time.
 */
export function resolveMotionScrubViewport(input: {
  viewport: MotionTimeViewport
  clientX: number
  bounds: Pick<DOMRect, 'left' | 'right' | 'width'>
  totalFrames: number
  previousTimestamp: number | null
  timestamp: number
}): MotionTimeViewport | null {
  const { viewport, clientX, bounds, totalFrames, previousTimestamp, timestamp } = input
  const visibleRange = Math.max(1, viewport.endFrame - viewport.startFrame)
  const velocity =
    visibleRange < totalFrames ? getMotionPlayheadEdgeScrollVelocity(clientX, bounds) : 0
  if (velocity === 0 || bounds.width <= 0) return null

  const elapsedSeconds =
    Math.min(32, Math.max(0, timestamp - (previousTimestamp ?? timestamp - 1000 / 60))) / 1000
  const pannedViewport = panMotionTimeViewport(
    viewport,
    velocity * elapsedSeconds,
    bounds.width,
    totalFrames,
  )
  const boundaryVisibleRange =
    Math.abs(visibleRange - Math.round(visibleRange)) < 1e-9
      ? Math.round(visibleRange)
      : visibleRange
  // Preserve fractional motion inside the range, but canonicalize the terminal
  // edge. Floating-point residue at 0/comp-end otherwise leaves the imperative
  // preview a fraction away from the settled boundary.
  if (velocity < 0 && pannedViewport.startFrame <= Number.EPSILON * totalFrames * 4) {
    return { startFrame: 0, endFrame: boundaryVisibleRange }
  }
  if (velocity > 0 && totalFrames - pannedViewport.endFrame <= Number.EPSILON * totalFrames * 4) {
    return { startFrame: Math.max(0, totalFrames - boundaryVisibleRange), endFrame: totalFrames }
  }
  return pannedViewport
}

function zoomMotionTimeViewport(
  viewport: MotionTimeViewport,
  pivotRatio: number,
  zoomFactor: number,
  totalFrames: number,
  minVisibleFrames = 1,
): MotionTimeViewport {
  const currentRange = Math.max(1, viewport.endFrame - viewport.startFrame)
  const pivotFrame = viewport.startFrame + pivotRatio * currentRange
  const nextRange = Math.max(
    Math.min(totalFrames, Math.max(1, Math.round(minVisibleFrames))),
    Math.min(totalFrames, Math.round(currentRange * zoomFactor)),
  )
  return normalizeMotionTimeViewport(
    {
      startFrame: pivotFrame - pivotRatio * nextRange,
      endFrame: pivotFrame + (1 - pivotRatio) * nextRange,
    },
    totalFrames,
  )
}

export function formatFrameTime(frame: number, fps: number): string {
  const seconds = frame / Math.max(1, fps)
  if (seconds < 10) return `${seconds.toFixed(1)}s`
  return `${Math.round(seconds)}s`
}

export interface MotionTimeViewportControllerDeps {
  /** Width of the sticky layer column; the time pane starts after it. */
  layerColumnWidth: number
  getDurationInFrames: () => number
  getTimeViewport: () => MotionTimeViewport
  preparePreview: () => void
  previewViewport: (viewport: MotionTimeViewport) => void
  commitViewport: (viewport: MotionTimeViewport, roundToFrames?: boolean) => void
  getScrollArea: () => HTMLElement | null
}

/** What a wheel event means for the time viewport, decided before any action. */
type WheelNavigation =
  | { kind: 'ignore' }
  | { kind: 'consume' }
  | { kind: 'vertical'; scrollDelta: number }
  | { kind: 'pan'; axis: 'x' | 'y'; delta: number; timelineWidth: number }
  | { kind: 'zoom'; pivotRatio: number; zoomFactor: number; timelineWidth: number; minVisibleFrames: number }

/** Time pane geometry for a wheel event, including whether it is over the pane. */
function resolveTimelinePane(
  event: WheelEvent,
  scrollArea: HTMLElement,
  layerColumnWidth: number,
): { timelineLeft: number; timelineWidth: number; isTimelinePane: boolean } {
  const rect = scrollArea.getBoundingClientRect()
  const timelineLeft = rect.left + layerColumnWidth
  const measuredTimelineWidth = scrollArea.clientWidth - layerColumnWidth
  return {
    timelineLeft,
    timelineWidth: Math.max(
      1,
      measuredTimelineWidth > 0 ? measuredTimelineWidth : rect.right - timelineLeft,
    ),
    isTimelinePane: event.clientX >= timelineLeft,
  }
}

/**
 * Zoom around the pointer.
 *
 * The floor keeps at least one keyframe diamond per visible frame slot, so a
 * zoomed-in viewport cannot end up with fewer frames than the axis can draw.
 */
function resolveZoomNavigation(
  event: WheelEvent,
  timelineLeft: number,
  timelineWidth: number,
  durationInFrames: number,
): WheelNavigation {
  if (event.deltaY === 0) return { kind: 'consume' }
  return {
    kind: 'zoom',
    pivotRatio: Math.max(0, Math.min(1, (event.clientX - timelineLeft) / timelineWidth)),
    zoomFactor: event.deltaY > 0 ? 1.25 : 0.8,
    timelineWidth,
    minVisibleFrames: Math.min(
      durationInFrames,
      Math.max(
        1,
        Math.ceil(
          Math.max(1, timelineWidth - KEYFRAME_EDGE_INSET * 2) /
            KEYFRAME_DIAMOND_RENDERED_WIDTH_PX,
        ),
      ),
    ),
  }
}

/**
 * Classify a wheel event. `ignore` means the gesture is not ours and must fall
 * through untouched; `consume` means we swallow it without moving the viewport
 * (the layer column, or a zoom with no vertical delta).
 */
function resolveWheelNavigation(input: {
  event: WheelEvent
  panAxis: 'x' | 'y' | null
  scrollArea: HTMLElement
  layerColumnWidth: number
  durationInFrames: number
}): WheelNavigation {
  const { event, panAxis, scrollArea, layerColumnWidth, durationInFrames } = input
  const isZoomGesture = event.ctrlKey || event.metaKey
  const isVerticalScrollGesture = event.altKey && !isZoomGesture
  const panGesture = getMotionTimelinePanGesture(event, panAxis)
  if (!isZoomGesture && !isVerticalScrollGesture && panGesture === null) return { kind: 'ignore' }
  // Motion reserves Alt/Option+wheel for deliberate vertical layer/property
  // navigation while ordinary wheel owns time.
  if (isVerticalScrollGesture) return { kind: 'vertical', scrollDelta: event.deltaY || event.deltaX }
  const pane = resolveTimelinePane(event, scrollArea, layerColumnWidth)
  // Like Edit's non-scrollable track-header viewport, ordinary wheel over the
  // layer column is safely consumed without creating a second pan.
  if (!pane.isTimelinePane) return { kind: 'consume' }
  if (panGesture !== null) {
    // Match Edit's timeline navigation ownership: a mouse wheel's deltaY and a
    // trackpad's dominant deltaX both move only along the time axis.
    return {
      kind: 'pan',
      axis: panGesture.axis,
      delta: panGesture.delta,
      timelineWidth: pane.timelineWidth,
    }
  }
  return resolveZoomNavigation(event, pane.timelineLeft, pane.timelineWidth, durationInFrames)
}

export interface MotionTimeViewportController {
  /** Drop queued work: pending frame, settle timer and pan axis. */
  cancel: () => void
  /** Cancel queued work so the navigator can own the next preview. */
  prepareNavigatorPreview: () => void
  /** Listen for wheel gestures on the motion viewport; returns the detach. */
  attach: (root: HTMLElement) => () => void
}

/**
 * Owns wheel navigation for the motion time viewport.
 *
 * A wheel gesture is continuous but the viewport is React state, so each notch
 * is previewed imperatively on the next animation frame and only committed once
 * the gesture settles. The pan axis is locked for the length of a gesture so
 * cross-axis trackpad noise cannot make the navigator thumb oscillate, and the
 * commit paints the endpoint before it commits, so the deferred React render
 * inherits exactly the geometry the preview already showed.
 */
export function createMotionTimeViewportController(
  deps: MotionTimeViewportControllerDeps,
): MotionTimeViewportController {
  let queuedViewport: MotionTimeViewport | null = null
  let animationFrame: number | null = null
  let settleTimer: number | null = null
  let panAxis: 'x' | 'y' | null = null

  const cancel = (): void => {
    if (settleTimer !== null) {
      window.clearTimeout(settleTimer)
      settleTimer = null
    }
    if (animationFrame !== null) {
      cancelAnimationFrame(animationFrame)
      animationFrame = null
    }
    queuedViewport = null
    panAxis = null
  }

  const queue = (update: MotionViewportUpdate): void => {
    if (!queuedViewport) deps.preparePreview()
    // Read once per gesture notch: the pre-commit callbacks below must agree
    // with the geometry this notch was computed against.
    const durationInFrames = deps.getDurationInFrames()
    const nextViewport = update(queuedViewport ?? deps.getTimeViewport())
    queuedViewport = nextViewport

    if (animationFrame === null) {
      animationFrame = requestAnimationFrame(() => {
        animationFrame = null
        const pendingViewport = queuedViewport
        if (pendingViewport) {
          deps.previewViewport(normalizeMotionTimeViewport(pendingViewport, durationInFrames, false))
        }
      })
    }
    if (settleTimer !== null) {
      window.clearTimeout(settleTimer)
    }
    settleTimer = window.setTimeout(() => {
      settleTimer = null
      if (animationFrame !== null) {
        cancelAnimationFrame(animationFrame)
        animationFrame = null
      }
      const finalViewport = queuedViewport
      if (finalViewport) {
        const normalizedFinalViewport = normalizeMotionTimeViewport(
          finalViewport,
          durationInFrames,
          false,
        )
        // A saturated main thread can let the settle timer win before the
        // final queued RAF. Paint that exact endpoint synchronously so the
        // deferred React render inherits identical diamond/grid geometry.
        deps.previewViewport(normalizedFinalViewport)
        queuedViewport = null
        deps.commitViewport(normalizedFinalViewport, false)
      } else {
        queuedViewport = null
      }
      panAxis = null
    }, WHEEL_VIEWPORT_SETTLE_MS)
  }

  const prepareNavigatorPreview = (): void => {
    cancel()
    deps.preparePreview()
  }

  const handleWheel = (event: WheelEvent): void => {
    const scrollArea = deps.getScrollArea()
    if (!scrollArea) return
    const durationInFrames = deps.getDurationInFrames()
    const navigation = resolveWheelNavigation({
      event,
      panAxis,
      scrollArea,
      layerColumnWidth: deps.layerColumnWidth,
      durationInFrames,
    })
    if (navigation.kind === 'ignore') return
    // The shared layer scroller must not receive ordinary wheel input from
    // either pane. Consume during capture before nested property editors or
    // native overflow scrolling can react to the same gesture.
    event.preventDefault()
    event.stopPropagation()
    if (navigation.kind === 'consume') return
    if (navigation.kind === 'vertical') {
      panAxis = null
      scrollArea.scrollTop += navigation.scrollDelta
      return
    }
    // Lock the physical axis for the gesture so cross-axis noise cannot make
    // the navigator thumb oscillate between deltas.
    panAxis = navigation.kind === 'pan' ? navigation.axis : null
    queue((current) =>
      navigation.kind === 'pan'
        ? panMotionTimeViewport(current, navigation.delta, navigation.timelineWidth, durationInFrames)
        : zoomMotionTimeViewport(
            current,
            navigation.pivotRatio,
            navigation.zoomFactor,
            durationInFrames,
            navigation.minVisibleFrames,
          ),
    )
  }

  const attach = (root: HTMLElement): (() => void) => {
    root.addEventListener('wheel', handleWheel, { capture: true, passive: false })
    return () => {
      root.removeEventListener('wheel', handleWheel, { capture: true })
    }
  }

  return { cancel, prepareNavigatorPreview, attach }
}
