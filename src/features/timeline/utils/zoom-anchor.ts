import { ZOOM_MAX, ZOOM_MIN } from '../constants'

const PIXELS_PER_SECOND_AT_100_PERCENT = 100

function zoomLevelToPixelsPerSecond(zoomLevel: number): number {
  return zoomLevel * PIXELS_PER_SECOND_AT_100_PERCENT
}

function clampTimeSeconds(timeSeconds: number, maxDurationSeconds: number): number {
  return Math.max(0, Math.min(timeSeconds, maxDurationSeconds))
}

export interface TimelineZoomAnchor {
  anchorScreenX: number
  anchorTimeSeconds: number
}

export function getCursorZoomAnchor(params: {
  currentZoomLevel: number
  cursorScreenX: number
  maxDurationSeconds: number
  scrollLeft: number
}): TimelineZoomAnchor {
  const currentPixelsPerSecond = zoomLevelToPixelsPerSecond(params.currentZoomLevel)
  const anchorContentX = params.scrollLeft + params.cursorScreenX

  return {
    anchorScreenX: params.cursorScreenX,
    anchorTimeSeconds: clampTimeSeconds(
      anchorContentX / currentPixelsPerSecond,
      params.maxDurationSeconds,
    ),
  }
}

export function getPlayheadZoomAnchor(params: {
  currentFrame: number
  currentZoomLevel: number
  fps: number
  maxDurationSeconds: number
  scrollLeft: number
}): TimelineZoomAnchor {
  const safeFps = params.fps > 0 ? params.fps : 1
  const anchorTimeSeconds = clampTimeSeconds(
    params.currentFrame / safeFps,
    params.maxDurationSeconds,
  )
  const anchorContentX = anchorTimeSeconds * zoomLevelToPixelsPerSecond(params.currentZoomLevel)

  return {
    anchorScreenX: anchorContentX - params.scrollLeft,
    anchorTimeSeconds,
  }
}

export function getAnchoredZoomScrollLeft(params: {
  anchor: TimelineZoomAnchor
  maxDurationSeconds: number
  nextZoomLevel: number
}): number {
  const clampedZoomLevel = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, params.nextZoomLevel))
  const anchorTimeSeconds = clampTimeSeconds(
    params.anchor.anchorTimeSeconds,
    params.maxDurationSeconds,
  )
  const nextAnchorContentX = anchorTimeSeconds * zoomLevelToPixelsPerSecond(clampedZoomLevel)

  return Math.max(0, nextAnchorContentX - params.anchor.anchorScreenX)
}
