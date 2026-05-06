import { KEYFRAME_EDGE_INSET } from './layout'

export interface KeyframeNavigatorViewport {
  startFrame: number
  endFrame: number
}

export type KeyframeNavigatorDragTarget = 'left' | 'right'

export interface KeyframeNavigatorThumbMetricsInput {
  viewport: KeyframeNavigatorViewport
  contentFrameMax: number
  trackWidth: number
  minThumbWidth?: number
}

export interface KeyframeNavigatorThumbMetrics {
  contentFrameMax: number
  visibleFrameRange: number
  maxStartFrame: number
  edgeInset: number
  usableTrackWidth: number
  thumbWidth: number
  thumbTravel: number
  thumbLeft: number
}

export interface KeyframeNavigatorResizeDragInput {
  dragTarget: KeyframeNavigatorDragTarget
  deltaX: number
  dragStartThumbWidth: number
  trackWidth: number
  viewport: KeyframeNavigatorViewport
  contentFrameMax: number
  minVisibleFrames: number
  minThumbWidth?: number
}

const DEFAULT_MIN_THUMB_WIDTH = 28
const DEFAULT_TRACK_EDGE_INSET = KEYFRAME_EDGE_INSET

function normalizeContentFrameMax(contentFrameMax: number): number {
  return Math.max(1, Math.round(contentFrameMax))
}

function getUsableTrackWidth(trackWidth: number, edgeInset: number): number {
  return Math.max(0, trackWidth - edgeInset * 2)
}

function normalizeVisibleFrameRange(
  viewport: KeyframeNavigatorViewport,
  contentFrameMax: number,
  minVisibleFrames = 1,
): number {
  return Math.max(
    Math.min(minVisibleFrames, contentFrameMax),
    Math.min(contentFrameMax, Math.round(viewport.endFrame - viewport.startFrame)),
  )
}

export function normalizeKeyframeNavigatorViewport(
  viewport: KeyframeNavigatorViewport,
  rawContentFrameMax: number,
  minVisibleFrames = 1,
): KeyframeNavigatorViewport {
  const contentFrameMax = normalizeContentFrameMax(rawContentFrameMax)
  const visibleFrameRange = normalizeVisibleFrameRange(viewport, contentFrameMax, minVisibleFrames)
  const maxStartFrame = Math.max(0, contentFrameMax - visibleFrameRange)
  const nextStartFrame = Math.max(0, Math.min(maxStartFrame, Math.round(viewport.startFrame)))

  return {
    startFrame: nextStartFrame,
    endFrame: nextStartFrame + visibleFrameRange,
  }
}

export function getKeyframeNavigatorThumbMetrics({
  viewport,
  contentFrameMax: rawContentFrameMax,
  trackWidth,
  minThumbWidth = DEFAULT_MIN_THUMB_WIDTH,
}: KeyframeNavigatorThumbMetricsInput): KeyframeNavigatorThumbMetrics {
  const contentFrameMax = normalizeContentFrameMax(rawContentFrameMax)
  const normalizedViewport = normalizeKeyframeNavigatorViewport(viewport, contentFrameMax)
  const visibleFrameRange = normalizedViewport.endFrame - normalizedViewport.startFrame
  const maxStartFrame = Math.max(0, contentFrameMax - visibleFrameRange)
  const edgeInset =
    trackWidth > 0 ? Math.min(DEFAULT_TRACK_EDGE_INSET, Math.floor(trackWidth / 4)) : 0
  const usableTrackWidth = getUsableTrackWidth(trackWidth, edgeInset)
  const thumbWidthRatio = visibleFrameRange / contentFrameMax
  const thumbWidth =
    usableTrackWidth > 0
      ? thumbWidthRatio >= 1
        ? usableTrackWidth
        : Math.min(usableTrackWidth, Math.max(minThumbWidth, thumbWidthRatio * usableTrackWidth))
      : 0
  const thumbTravel = Math.max(0, usableTrackWidth - thumbWidth)
  const thumbLeft =
    maxStartFrame > 0 && thumbTravel > 0
      ? edgeInset + (normalizedViewport.startFrame / maxStartFrame) * thumbTravel
      : edgeInset

  return {
    contentFrameMax,
    visibleFrameRange,
    maxStartFrame,
    edgeInset,
    usableTrackWidth,
    thumbWidth,
    thumbTravel,
    thumbLeft,
  }
}

export function getStartFrameFromNavigatorThumbLeft(
  thumbLeft: number,
  metrics: Pick<KeyframeNavigatorThumbMetrics, 'edgeInset' | 'thumbTravel' | 'maxStartFrame'>,
): number {
  if (metrics.thumbTravel <= 0 || metrics.maxStartFrame <= 0) {
    return 0
  }

  const clampedThumbLeft = Math.max(
    metrics.edgeInset,
    Math.min(metrics.edgeInset + metrics.thumbTravel, thumbLeft),
  )
  return Math.round(
    ((clampedThumbLeft - metrics.edgeInset) / metrics.thumbTravel) * metrics.maxStartFrame,
  )
}

export function getKeyframeNavigatorResizeDragResult({
  dragTarget,
  deltaX,
  dragStartThumbWidth,
  trackWidth,
  viewport,
  contentFrameMax: rawContentFrameMax,
  minVisibleFrames,
  minThumbWidth = DEFAULT_MIN_THUMB_WIDTH,
}: KeyframeNavigatorResizeDragInput): KeyframeNavigatorViewport {
  const contentFrameMax = normalizeContentFrameMax(rawContentFrameMax)
  if (trackWidth <= 0) {
    return viewport
  }

  const edgeInset = Math.min(DEFAULT_TRACK_EDGE_INSET, Math.floor(trackWidth / 4))
  const usableTrackWidth = getUsableTrackWidth(trackWidth, edgeInset)
  if (usableTrackWidth <= 0) {
    return normalizeKeyframeNavigatorViewport(viewport, contentFrameMax, minVisibleFrames)
  }

  const targetThumbWidth =
    dragTarget === 'left'
      ? Math.max(minThumbWidth, Math.min(usableTrackWidth, dragStartThumbWidth - deltaX))
      : Math.max(minThumbWidth, Math.min(usableTrackWidth, dragStartThumbWidth + deltaX))

  const nextVisibleFrameRange = Math.max(
    Math.min(minVisibleFrames, contentFrameMax),
    Math.min(contentFrameMax, Math.round((targetThumbWidth / usableTrackWidth) * contentFrameMax)),
  )
  const maxStartFrame = Math.max(0, contentFrameMax - nextVisibleFrameRange)

  if (dragTarget === 'left') {
    const nextStartFrame = Math.max(
      0,
      Math.min(maxStartFrame, Math.round(viewport.endFrame) - nextVisibleFrameRange),
    )
    return {
      startFrame: nextStartFrame,
      endFrame: nextStartFrame + nextVisibleFrameRange,
    }
  }

  const nextStartFrame = Math.max(0, Math.min(maxStartFrame, Math.round(viewport.startFrame)))
  return {
    startFrame: nextStartFrame,
    endFrame: nextStartFrame + nextVisibleFrameRange,
  }
}
