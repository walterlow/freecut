import { useState, useCallback, useEffect, useMemo, useRef, useEffectEvent } from 'react'

/**
 * Marquee selection state
 */
export interface MarqueeState {
  active: boolean
  startX: number
  startY: number
  currentX: number
  currentY: number
}

/**
 * Rectangle for collision detection
 */
export interface Rect {
  left: number
  top: number
  right: number
  bottom: number
  width: number
  height: number
}

/**
 * Item that can be selected with marquee
 */
export interface MarqueeItem {
  id: string
  getBoundingRect: () => Rect | null
}

interface ResolvedMarqueeItem {
  id: string
  rect: Rect | null
}

/**
 * Subscription-based marquee controller. The snapshot updates on every RAF
 * tick during a drag without causing the hook's consumer to re-render —
 * only the overlay component (via `useSyncExternalStore`) re-renders.
 */
export interface MarqueeController {
  subscribe: (listener: () => void) => () => void
  getSnapshot: () => MarqueeState
}

/**
 * Options for marquee selection
 */
interface UseMarqueeSelectionOptions {
  /** The container element that marquee selection is scoped to */
  containerRef: React.RefObject<HTMLElement>

  /** Optional separate hit area for bounds checking (defaults to containerRef) */
  hitAreaRef?: React.RefObject<HTMLElement>

  /** Items that can be selected */
  items: MarqueeItem[]

  /** Callback when selection changes */
  onSelectionChange?: (selectedIds: string[]) => void

  /** Optional callback for lightweight live preview updates during drag */
  onPreviewSelectionChange?: (selectedIds: string[]) => void

  /** Whether marquee selection is enabled */
  enabled?: boolean

  /** Whether to append to existing selection (default: false, replaces selection) */
  appendMode?: boolean

  /** Minimum drag distance before marquee activates (pixels) */
  threshold?: number

  /** Defer onSelectionChange until mouseup; useful when live commits are too expensive */
  commitSelectionOnMouseUp?: boolean

  /** When deferring selection, still publish throttled live commits at this cadence */
  liveCommitThrottleMs?: number
}

/**
 * Check if two rectangles intersect (partial or full overlap)
 *
 * Returns true if the rectangles have ANY overlap at all, even if just touching edges.
 * Does NOT require one rectangle to be fully contained within the other.
 */
function rectIntersects(rect1: Rect, rect2: Rect): boolean {
  return !(
    rect1.right < rect2.left ||
    rect1.left > rect2.right ||
    rect1.bottom < rect2.top ||
    rect1.top > rect2.bottom
  )
}

/**
 * Convert marquee start/current points to a rectangle
 */
export function getMarqueeRect(
  startX: number,
  startY: number,
  currentX: number,
  currentY: number,
): Rect {
  const left = Math.min(startX, currentX)
  const top = Math.min(startY, currentY)
  const right = Math.max(startX, currentX)
  const bottom = Math.max(startY, currentY)

  return {
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: bottom - top,
  }
}

function areStringListsEqual(previous: readonly string[], next: readonly string[]): boolean {
  if (previous.length !== next.length) {
    return false
  }

  for (let index = 0; index < previous.length; index += 1) {
    if (previous[index] !== next[index]) {
      return false
    }
  }

  return true
}

const INACTIVE_SNAPSHOT: MarqueeState = Object.freeze({
  active: false,
  startX: 0,
  startY: 0,
  currentX: 0,
  currentY: 0,
})

/**
 * Reusable marquee selection hook
 *
 * Provides mouse-based marquee (drag rectangle) selection for any grid/canvas of items.
 * Can be used for media library, timeline clips, preview gizmos, etc.
 *
 * The rect state is exposed via an external-store subscription (`marquee.subscribe`
 * / `marquee.getSnapshot`) rather than React state, so only `<MarqueeOverlay />`
 * re-renders on each pointer move — the rest of the consuming tree stays quiet.
 * Use `isActive` for effects that only need to fire on drag start/end.
 */
// Global flag to track when marquee selection just finished
// Used to prevent background click handlers from clearing selection
let marqueeJustFinished = false

export function isMarqueeJustFinished(): boolean {
  return marqueeJustFinished
}

export function useMarqueeSelection({
  containerRef,
  hitAreaRef,
  items,
  onSelectionChange,
  onPreviewSelectionChange,
  enabled = true,
  appendMode = false,
  threshold = 5,
  commitSelectionOnMouseUp = false,
  liveCommitThrottleMs = commitSelectionOnMouseUp ? 33 : 0,
}: UseMarqueeSelectionOptions) {
  // Use hitAreaRef for bounds checking if provided, otherwise fall back to containerRef
  const boundsRef = hitAreaRef ?? containerRef

  // Use refs for high-frequency updates during drag to avoid React re-renders
  const marqueeRef = useRef({ startX: 0, startY: 0, currentX: 0, currentY: 0 })

  // Subscription-based snapshot: updates on every RAF tick without forcing a
  // re-render in the hook's consumer. Only the overlay subscribes.
  const snapshotRef = useRef<MarqueeState>(INACTIVE_SNAPSHOT)
  const listenersRef = useRef<Set<() => void>>(new Set())

  const subscribe = useCallback((listener: () => void) => {
    const listeners = listenersRef.current
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }, [])

  const getSnapshot = useCallback(() => snapshotRef.current, [])

  const publishSnapshot = useCallback((next: MarqueeState) => {
    snapshotRef.current = next
    listenersRef.current.forEach((listener) => listener())
  }, [])

  // `isActive` is React state — flips only at drag start/end, so effects that
  // gate on active state (e.g. disabling panel shortcuts) re-run only twice
  // per drag instead of 60+ times.
  const [isActive, setIsActive] = useState(false)

  const isDraggingRef = useRef(false)
  const hasMovedRef = useRef(false)
  const onSelectionChangeRef = useRef(onSelectionChange)
  const onPreviewSelectionChangeRef = useRef(onPreviewSelectionChange)
  const prevSelectedIdsRef = useRef<string[]>([])
  const rafIdRef = useRef<number | null>(null)
  const itemsRef = useRef(items)
  const enabledRef = useRef(enabled)
  const resolvedItemsRef = useRef<ResolvedMarqueeItem[] | null>(null)
  const liveCommitTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingLiveCommitIdsRef = useRef<string[] | null>(null)
  const lastLiveCommitTimeRef = useRef(0)

  // Keep refs up to date
  useEffect(() => {
    onSelectionChangeRef.current = onSelectionChange
  }, [onSelectionChange])

  useEffect(() => {
    onPreviewSelectionChangeRef.current = onPreviewSelectionChange
  }, [onPreviewSelectionChange])

  useEffect(() => {
    itemsRef.current = items
  }, [items])

  useEffect(() => {
    enabledRef.current = enabled
  }, [enabled])

  const captureResolvedItems = useCallback(() => {
    resolvedItemsRef.current = itemsRef.current.map((item) => ({
      id: item.id,
      rect: item.getBoundingRect(),
    }))
  }, [])

  const flushLiveCommit = useCallback((ids: string[]) => {
    if (liveCommitTimeoutRef.current !== null) {
      clearTimeout(liveCommitTimeoutRef.current)
      liveCommitTimeoutRef.current = null
    }
    pendingLiveCommitIdsRef.current = null
    lastLiveCommitTimeRef.current = performance.now()
    onSelectionChangeRef.current?.(ids)
  }, [])

  const scheduleLiveCommit = useCallback(
    (ids: string[]) => {
      if (!commitSelectionOnMouseUp || liveCommitThrottleMs <= 0) {
        return false
      }

      const now = performance.now()
      const elapsed = now - lastLiveCommitTimeRef.current

      if (elapsed >= liveCommitThrottleMs) {
        flushLiveCommit(ids)
        return true
      }

      pendingLiveCommitIdsRef.current = ids
      if (liveCommitTimeoutRef.current === null) {
        liveCommitTimeoutRef.current = setTimeout(
          () => {
            const pendingIds = pendingLiveCommitIdsRef.current
            if (!pendingIds) {
              liveCommitTimeoutRef.current = null
              return
            }
            flushLiveCommit(pendingIds)
          },
          Math.max(0, liveCommitThrottleMs - elapsed),
        )
      }

      return true
    },
    [commitSelectionOnMouseUp, flushLiveCommit, liveCommitThrottleMs],
  )

  // Update selection based on current marquee intersection (uses refs for performance)
  const updateSelectionFromRefs = useCallback(() => {
    if (!containerRef.current) return

    const container = containerRef.current
    const containerRect = container.getBoundingClientRect()
    const m = marqueeRef.current

    // Convert marquee from content space to viewport space for comparison
    const marqueeRect = getMarqueeRect(
      m.startX - container.scrollLeft + containerRect.left,
      m.startY - container.scrollTop + containerRect.top,
      m.currentX - container.scrollLeft + containerRect.left,
      m.currentY - container.scrollTop + containerRect.top,
    )

    // Find all items that currently intersect with marquee
    const currentItems =
      resolvedItemsRef.current ??
      itemsRef.current.map((item) => ({
        id: item.id,
        rect: item.getBoundingRect(),
      }))
    const intersectingIds = currentItems
      .filter((item) => {
        if (!item.rect) return false
        return rectIntersects(marqueeRect, item.rect)
      })
      .map((item) => item.id)

    // Only update if selection changed
    const prevIds = prevSelectedIdsRef.current
    if (!areStringListsEqual(prevIds, intersectingIds)) {
      prevSelectedIdsRef.current = intersectingIds
      if (commitSelectionOnMouseUp) {
        onPreviewSelectionChangeRef.current?.(intersectingIds)
        scheduleLiveCommit(intersectingIds)
      } else {
        onSelectionChangeRef.current?.(intersectingIds)
      }
    }
  }, [commitSelectionOnMouseUp, containerRef, scheduleLiveCommit])

  // Handle mouse down - start marquee
  // Using useEffectEvent so changes to enabled, appendMode don't re-register listeners
  const onMouseDown = useEffectEvent((e: MouseEvent) => {
    if (!enabledRef.current || !containerRef.current || !boundsRef.current) return

    // Only trigger on left click
    if (e.button !== 0) return

    // Check if click is inside hit area bounds
    const boundsEl = boundsRef.current
    const rect = boundsEl.getBoundingClientRect()

    if (
      e.clientX < rect.left ||
      e.clientX > rect.right ||
      e.clientY < rect.top ||
      e.clientY > rect.bottom
    ) {
      return
    }

    // Don't start marquee if clicking on an interactive element
    const target = e.target as HTMLElement
    if (
      target.tagName === 'BUTTON' ||
      target.tagName === 'INPUT' ||
      target.tagName === 'A' ||
      target.closest('button') ||
      target.closest('input') ||
      target.closest('a') ||
      target.closest('[role="button"]') ||
      // Don't start marquee if clicking on a draggable timeline item
      target.closest('[data-item-id]') ||
      // Don't start marquee if clicking on a draggable media card
      target.closest('[data-media-id]') ||
      // Don't start marquee if clicking on a draggable composition card
      target.closest('[data-composition-id]') ||
      // Don't start marquee if clicking in the timeline ruler
      target.closest('.timeline-ruler') ||
      // Don't start marquee if clicking on the playhead handle
      target.closest('[data-playhead-handle]') ||
      // Don't start marquee if clicking on gizmo elements (handles, borders)
      target.closest('[data-gizmo]') ||
      // Don't start marquee if clicking on a resize handle
      target.closest('[data-resize-handle]') ||
      // Don't start marquee if clicking on a track-push handle
      target.closest('[data-track-push]') ||
      target.style.cursor === 'col-resize' ||
      target.style.cursor === 'ns-resize'
    ) {
      return
    }
    isDraggingRef.current = true
    hasMovedRef.current = false
    prevSelectedIdsRef.current = [] // Reset accumulated selection for new marquee
    resolvedItemsRef.current = null
    pendingLiveCommitIdsRef.current = null
    if (liveCommitTimeoutRef.current !== null) {
      clearTimeout(liveCommitTimeoutRef.current)
      liveCommitTimeoutRef.current = null
    }
    lastLiveCommitTimeRef.current = 0

    // Calculate position relative to the container (for marquee display)
    const container = containerRef.current
    const containerRect = container.getBoundingClientRect()
    const startX = e.clientX - containerRect.left + container.scrollLeft
    const startY = e.clientY - containerRect.top + container.scrollTop

    // Store in ref (no re-render)
    marqueeRef.current = { startX, startY, currentX: startX, currentY: startY }

    // Clear selection if not in append mode
    if (!appendMode) {
      prevSelectedIdsRef.current = []
      if (commitSelectionOnMouseUp) {
        onPreviewSelectionChangeRef.current?.([])
      }
    }
  })

  // Handle mouse move - update marquee using RAF for performance
  // Using useEffectEvent so changes to threshold don't re-register listeners
  const onMouseMove = useEffectEvent((e: MouseEvent) => {
    if (!isDraggingRef.current || !containerRef.current) return

    const container = containerRef.current
    const rect = container.getBoundingClientRect()

    // Account for scroll offset to get position in content space,
    // clamped to container bounds so the marquee never extends outside
    const rawX = e.clientX - rect.left + container.scrollLeft
    const rawY = e.clientY - rect.top + container.scrollTop
    const currentX = Math.max(
      container.scrollLeft,
      Math.min(container.scrollLeft + container.clientWidth, rawX),
    )
    const currentY = Math.max(
      container.scrollTop,
      Math.min(container.scrollTop + container.clientHeight, rawY),
    )

    // Check if we've moved past threshold
    if (!hasMovedRef.current) {
      const m = marqueeRef.current
      const deltaX = Math.abs(currentX - m.startX)
      const deltaY = Math.abs(currentY - m.startY)

      if (deltaX > threshold || deltaY > threshold) {
        hasMovedRef.current = true
        captureResolvedItems()
        // Flip isActive — one re-render, not one per frame.
        setIsActive(true)
        publishSnapshot({
          active: true,
          startX: m.startX,
          startY: m.startY,
          currentX,
          currentY,
        })
      } else {
        return // Don't activate yet
      }
    }

    // Update ref (no re-render)
    marqueeRef.current.currentX = currentX
    marqueeRef.current.currentY = currentY

    // Batch updates with RAF
    if (rafIdRef.current === null) {
      rafIdRef.current = requestAnimationFrame(() => {
        rafIdRef.current = null
        const m = marqueeRef.current

        // Publish via subscription — only the overlay re-renders.
        publishSnapshot({
          active: true,
          startX: m.startX,
          startY: m.startY,
          currentX: m.currentX,
          currentY: m.currentY,
        })

        // Update selection
        updateSelectionFromRefs()
      })
    }
  })

  // Handle mouse up - end marquee
  // Using useEffectEvent for consistency with other handlers
  const onMouseUp = useEffectEvent((e: MouseEvent) => {
    // Only process if we were dragging
    if (!isDraggingRef.current) return

    const wasActualDrag = hasMovedRef.current

    // Cancel any pending RAF
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current)
      rafIdRef.current = null
    }

    // Clean up
    isDraggingRef.current = false
    hasMovedRef.current = false
    marqueeRef.current = { startX: 0, startY: 0, currentX: 0, currentY: 0 }
    resolvedItemsRef.current = null

    setIsActive(false)
    publishSnapshot(INACTIVE_SNAPSHOT)

    // Only prevent background click if an actual marquee drag happened
    if (wasActualDrag) {
      if (commitSelectionOnMouseUp) {
        onPreviewSelectionChangeRef.current?.([])
        if (liveCommitThrottleMs > 0) {
          flushLiveCommit(prevSelectedIdsRef.current)
        } else {
          onSelectionChangeRef.current?.(prevSelectedIdsRef.current)
        }
      }
      e.stopPropagation()
      e.preventDefault()

      marqueeJustFinished = true
      requestAnimationFrame(() => {
        marqueeJustFinished = false
      })
    } else if (commitSelectionOnMouseUp) {
      if (liveCommitThrottleMs > 0) {
        if (liveCommitTimeoutRef.current !== null) {
          clearTimeout(liveCommitTimeoutRef.current)
          liveCommitTimeoutRef.current = null
        }
        pendingLiveCommitIdsRef.current = null
      }
      onPreviewSelectionChangeRef.current?.([])
    }
  })

  // Cleanup RAF on unmount
  useEffect(() => {
    return () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current)
      }
      if (liveCommitTimeoutRef.current !== null) {
        clearTimeout(liveCommitTimeoutRef.current)
      }
    }
  }, [])

  // Register global mouse event listeners
  // Listen at document level to support containers with pointer-events: none
  // Always register listeners - the handler checks `enabled` via useEffectEvent
  // This ensures marquee works even when items load after mount
  useEffect(() => {
    // Use capture phase to intercept before other handlers
    document.addEventListener('mousedown', onMouseDown, true)
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp, true)

    return () => {
      document.removeEventListener('mousedown', onMouseDown, true)
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp, true)
    }
  }, [])

  const marquee = useMemo<MarqueeController>(
    () => ({ subscribe, getSnapshot }),
    [subscribe, getSnapshot],
  )

  return {
    isActive,
    marquee,
    selectedIds: prevSelectedIdsRef.current,
  }
}
