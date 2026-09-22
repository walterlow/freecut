import { DRAG_THRESHOLD } from './dopesheet-constants'
import type { DragState } from './dopesheet-types'
import { clampFrame } from './frame-utils'
// Pure drag math for the dopesheet: which drag a pointer continues, the frame
// delta a pointer position implies, and the pixels-per-frame scale the preview and
// the commit must agree on.

export function getMatchingDragState(
  dragState: DragState | null,
  event: PointerEvent,
  disabled: boolean,
): DragState | null {
  if (disabled || !dragState || dragState.pointerId !== event.pointerId) return null
  return dragState
}

export function startDopesheetDrag(
  dragState: DragState,
  deltaX: number,
  onDragStart: (() => void) | undefined,
): boolean {
  if (dragState.started) return true
  if (Math.abs(deltaX) <= DRAG_THRESHOLD) return false
  dragState.started = true
  if (!dragState.duplicateOnCommit) onDragStart?.()
  return true
}

export function getDopesheetDragDelta(
  dragState: DragState,
  event: PointerEvent,
  pixelsPerFrame: number,
  totalFrames: number,
  snapEnabled: boolean,
  snapFrame: (frame: number) => number,
): number {
  const deltaX = event.clientX - dragState.startClientX
  let deltaFrames = Math.round(deltaX / pixelsPerFrame)
  if (!snapEnabled || event.ctrlKey || event.metaKey) return deltaFrames
  const anchorInitialFrame = dragState.initialFrames.get(dragState.anchorKeyframeId)
  if (anchorInitialFrame === undefined) return deltaFrames
  const anchorCandidate = clampFrame(anchorInitialFrame + deltaFrames, totalFrames)
  deltaFrames += snapFrame(anchorCandidate) - anchorCandidate
  return deltaFrames
}

export function getDopesheetDragPixelsPerFrame(
  getLivePixelsPerSecond: (() => number) | undefined,
  fallbackPixelsPerSecond: number,
  fps: number,
): number {
  const livePixelsPerSecond = getLivePixelsPerSecond?.()
  const pixelsPerSecond =
    livePixelsPerSecond !== undefined &&
    Number.isFinite(livePixelsPerSecond) &&
    livePixelsPerSecond > 0
      ? livePixelsPerSecond
      : fallbackPixelsPerSecond
  return pixelsPerSecond / Math.max(fps, 1)
}
