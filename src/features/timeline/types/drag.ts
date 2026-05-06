/**
 * Drag-related type definitions for timeline drag-and-drop functionality
 */

/**
 * Drag state tracked during an active drag operation
 */
export interface DragState {
  /** ID of the item being dragged (anchor item for multi-select) */
  itemId: string
  /** Initial frame position when drag started */
  startFrame: number
  /** Initial track ID when drag started */
  startTrackId: string
  /** Initial mouse X position */
  startMouseX: number
  /** Initial mouse Y position */
  startMouseY: number
  /** Current mouse X position (updated during drag) */
  currentMouseX: number
  /** Current mouse Y position (updated during drag) */
  currentMouseY: number
  /** All items being dragged (for multi-select) */
  draggedItems: Array<{
    id: string
    initialFrame: number
    initialTrackId: string
  }>
  /** Whether Alt key is held (triggers duplication instead of move) */
  isAltDrag?: boolean
}

/**
 * Snap target point on the timeline
 */
export interface SnapTarget {
  /** Frame position of the snap point */
  frame: number
  /** Type of snap target */
  type: 'grid' | 'item-start' | 'item-end' | 'playhead'
  /** Item ID if this is an item edge snap */
  itemId?: string
}

/**
 * Return type for use-timeline-drag hook
 * NOTE: activeSnapTarget is now read directly in timeline-content.tsx via store subscription
 */
export interface UseTimelineDragReturn {
  /** Whether an item is currently being dragged */
  isDragging: boolean
  /** Pixel offset for visual drag preview (CSS transform) */
  dragOffset: { x: number; y: number }
  /** Handler to start dragging */
  handleDragStart: (e: React.MouseEvent) => void
}
