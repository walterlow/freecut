import type { CSSProperties } from 'react'
import { DRAG_OPACITY } from '../../constants'
import { dragOffsetRef, dragPreviewOffsetByItemRef } from '../../hooks/use-timeline-drag'

interface ShellStyleSignals {
  itemId: string
  isBeingDragged: boolean
  isAltDrag: boolean
  isDragging: boolean
  dragOffset: { x: number; y: number }
  shouldDimForDrag: boolean
  trackHidden: boolean
  trackLocked: boolean
  isCompactShell: boolean
}

/**
 * Shell style properties for this render. The drag translate reads the module
 * drag refs directly: a dragged clip that is not the anchor follows the cohort
 * offset, which lands after the anchor's own state updates.
 */
export function getTimelineItemShellStyle({
  itemId,
  isBeingDragged,
  isAltDrag,
  isDragging,
  dragOffset,
  shouldDimForDrag,
  trackHidden,
  trackLocked,
  isCompactShell,
}: ShellStyleSignals): CSSProperties {
  const followOffset =
    isBeingDragged && !isAltDrag
      ? isDragging
        ? dragOffset
        : (dragPreviewOffsetByItemRef.current[itemId] ?? dragOffsetRef.current)
      : null

  return {
    transform: followOffset
      ? `translate(${followOffset.x}px, ${followOffset.y}px)`
      : undefined,
    opacity: shouldDimForDrag ? DRAG_OPACITY : trackHidden ? 0.3 : trackLocked ? 0.6 : 1,
    pointerEvents: isBeingDragged ? 'none' : 'auto',
    zIndex: isBeingDragged ? 50 : undefined,
    transition: isBeingDragged ? 'none' : undefined,
    // Compact shells already suppress rich content, and almost all of them are
    // onscreen in a dense track. Avoid giving each one a paint-containment
    // boundary that Layerize must revisit on every real-width zoom step.
    // Full-detail buffered clips keep browser layout/paint skipping while
    // offscreen.
    contain: isCompactShell ? 'layout style' : 'layout style paint',
    contentVisibility: isCompactShell ? 'visible' : 'auto',
  }
}
