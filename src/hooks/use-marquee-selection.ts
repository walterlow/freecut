import { useState, useCallback, useEffect, useRef, useEffectEvent } from 'react';

/**
 * Marquee selection state
 */
export interface MarqueeState {
  active: boolean;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
}

/**
 * Rectangle for collision detection
 */
export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

/**
 * Item that can be selected with marquee
 */
export interface MarqueeItem {
  id: string;
  getBoundingRect: () => Rect;
}

/**
 * Options for marquee selection
 */
export interface UseMarqueeSelectionOptions {
  /** The container element that marquee selection is scoped to */
  containerRef: React.RefObject<HTMLElement>;

  /** Optional separate hit area for bounds checking (defaults to containerRef) */
  hitAreaRef?: React.RefObject<HTMLElement>;

  /** Items that can be selected */
  items: MarqueeItem[];

  /** Callback when selection changes */
  onSelectionChange?: (selectedIds: string[]) => void;

  /** Whether marquee selection is enabled */
  enabled?: boolean;

  /** Whether to append to existing selection (default: false, replaces selection) */
  appendMode?: boolean;

  /** Minimum drag distance before marquee activates (pixels) */
  threshold?: number;
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
  );
}

/**
 * Convert marquee start/current points to a rectangle
 */
export function getMarqueeRect(
  startX: number,
  startY: number,
  currentX: number,
  currentY: number
): Rect {
  const left = Math.min(startX, currentX);
  const top = Math.min(startY, currentY);
  const right = Math.max(startX, currentX);
  const bottom = Math.max(startY, currentY);

  return {
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: bottom - top,
  };
}

/**
 * Reusable marquee selection hook
 *
 * Provides mouse-based marquee (drag rectangle) selection for any grid/canvas of items.
 * Can be used for media library, timeline clips, preview gizmos, etc.
 *
 * @example
 * ```tsx
 * const { marqueeState, selectedIds } = useMarqueeSelection({
 *   containerRef,
 *   items: mediaItems.map(item => ({
 *     id: item.id,
 *     getBoundingRect: () => {
 *       const el = document.getElementById(item.id);
 *       return el?.getBoundingClientRect() || defaultRect;
 *     }
 *   })),
 *   onSelectionChange: (ids) => updateSelection(ids)
 * });
 * ```
 */
// Global flag to track when marquee selection just finished
// Used to prevent background click handlers from clearing selection
let marqueeJustFinished = false;

export function isMarqueeJustFinished(): boolean {
  return marqueeJustFinished;
}

export function useMarqueeSelection({
  containerRef,
  hitAreaRef,
  items,
  onSelectionChange,
  enabled = true,
  appendMode = false,
  threshold = 5,
}: UseMarqueeSelectionOptions) {
  // Use hitAreaRef for bounds checking if provided, otherwise fall back to containerRef
  const boundsRef = hitAreaRef ?? containerRef;

  // Use refs for high-frequency updates during drag to avoid React re-renders
  const marqueeRef = useRef({ startX: 0, startY: 0, currentX: 0, currentY: 0 });

  // React state for rendering - only updates on RAF (batched) or active state changes
  const [marqueeState, setMarqueeState] = useState<MarqueeState>({
    active: false,
    startX: 0,
    startY: 0,
    currentX: 0,
    currentY: 0,
  });

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const isDraggingRef = useRef(false);
  const hasMovedRef = useRef(false);
  const onSelectionChangeRef = useRef(onSelectionChange);
  const prevSelectedIdsRef = useRef<string[]>([]);
  const rafIdRef = useRef<number | null>(null);
  const itemsRef = useRef(items);
  const enabledRef = useRef(enabled);

  // Keep refs up to date
  useEffect(() => {
    onSelectionChangeRef.current = onSelectionChange;
  }, [onSelectionChange]);

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  // Update selection based on current marquee intersection (uses refs for performance)
  const updateSelectionFromRefs = useCallback(() => {
    if (!containerRef.current) return;

    const container = containerRef.current;
    const containerRect = container.getBoundingClientRect();
    const m = marqueeRef.current;

    // Convert marquee from content space to viewport space for comparison
    const marqueeRect = getMarqueeRect(
      m.startX - container.scrollLeft + containerRect.left,
      m.startY - container.scrollTop + containerRect.top,
      m.currentX - container.scrollLeft + containerRect.left,
      m.currentY - container.scrollTop + containerRect.top
    );

    // Find all items that currently intersect with marquee
    const currentItems = itemsRef.current;
    const intersectingIds = currentItems
      .filter((item) => {
        const itemRect = item.getBoundingRect();
        return rectIntersects(marqueeRect, itemRect);
      })
      .map((item) => item.id);

    // Only update if selection changed
    const prevIds = prevSelectedIdsRef.current;
    const hasChanged =
      intersectingIds.length !== prevIds.length ||
      intersectingIds.some((id) => !prevIds.includes(id)) ||
      prevIds.some((id) => !intersectingIds.includes(id));

    if (hasChanged) {
      setSelectedIds(intersectingIds);
      prevSelectedIdsRef.current = intersectingIds;
      onSelectionChangeRef.current?.(intersectingIds);
    }
  }, [containerRef]);

  // Handle mouse down - start marquee
  // Using useEffectEvent so changes to enabled, appendMode don't re-register listeners
  const onMouseDown = useEffectEvent((e: MouseEvent) => {
    if (!enabledRef.current || !containerRef.current || !boundsRef.current) return;

    // Only trigger on left click
    if (e.button !== 0) return;

    // Check if click is inside hit area bounds
    const boundsEl = boundsRef.current;
    const rect = boundsEl.getBoundingClientRect();

    if (
      e.clientX < rect.left ||
      e.clientX > rect.right ||
      e.clientY < rect.top ||
      e.clientY > rect.bottom
    ) {
      return;
    }

    // Don't start marquee if clicking on an interactive element
    const target = e.target as HTMLElement;
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
      // Don't start marquee if clicking in the timeline ruler
      target.closest('.timeline-ruler') ||
      // Don't start marquee if clicking on the playhead handle
      target.closest('[data-playhead-handle]') ||
      // Don't start marquee if clicking on gizmo elements (handles, borders)
      target.closest('[data-gizmo]')
    ) {
      return;
    }
    isDraggingRef.current = true;
    hasMovedRef.current = false;
    prevSelectedIdsRef.current = []; // Reset accumulated selection for new marquee

    // Calculate position relative to the container (for marquee display)
    const container = containerRef.current;
    const containerRect = container.getBoundingClientRect();
    const startX = e.clientX - containerRect.left + container.scrollLeft;
    const startY = e.clientY - containerRect.top + container.scrollTop;

    // Store in ref (no re-render)
    marqueeRef.current = { startX, startY, currentX: startX, currentY: startY };

    // Clear selection if not in append mode
    if (!appendMode) {
      setSelectedIds([]);
      prevSelectedIdsRef.current = [];
    }
  });

  // Handle mouse move - update marquee using RAF for performance
  // Using useEffectEvent so changes to threshold don't re-register listeners
  const onMouseMove = useEffectEvent((e: MouseEvent) => {
    if (!isDraggingRef.current || !containerRef.current) return;

    const container = containerRef.current;
    const rect = container.getBoundingClientRect();

    // Account for scroll offset to get position in content space
    const currentX = e.clientX - rect.left + container.scrollLeft;
    const currentY = e.clientY - rect.top + container.scrollTop;

    // Check if we've moved past threshold
    if (!hasMovedRef.current) {
      const m = marqueeRef.current;
      const deltaX = Math.abs(currentX - m.startX);
      const deltaY = Math.abs(currentY - m.startY);

      if (deltaX > threshold || deltaY > threshold) {
        hasMovedRef.current = true;
        // Activate marquee (triggers one re-render)
        setMarqueeState({
          active: true,
          startX: m.startX,
          startY: m.startY,
          currentX,
          currentY,
        });
      } else {
        return; // Don't activate yet
      }
    }

    // Update ref (no re-render)
    marqueeRef.current.currentX = currentX;
    marqueeRef.current.currentY = currentY;

    // Batch updates with RAF
    if (rafIdRef.current === null) {
      rafIdRef.current = requestAnimationFrame(() => {
        rafIdRef.current = null;
        const m = marqueeRef.current;

        // Update React state for rendering
        setMarqueeState((prev) => ({
          ...prev,
          currentX: m.currentX,
          currentY: m.currentY,
        }));

        // Update selection
        updateSelectionFromRefs();
      });
    }
  });

  // Handle mouse up - end marquee
  // Using useEffectEvent for consistency with other handlers
  const onMouseUp = useEffectEvent((e: MouseEvent) => {
    // Only process if we were dragging
    if (!isDraggingRef.current) return;

    const wasActualDrag = hasMovedRef.current;

    // Cancel any pending RAF
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }

    // Clean up
    isDraggingRef.current = false;
    hasMovedRef.current = false;
    marqueeRef.current = { startX: 0, startY: 0, currentX: 0, currentY: 0 };

    setMarqueeState({
      active: false,
      startX: 0,
      startY: 0,
      currentX: 0,
      currentY: 0,
    });

    // Only prevent background click if an actual marquee drag happened
    if (wasActualDrag) {
      e.stopPropagation();
      e.preventDefault();

      marqueeJustFinished = true;
      requestAnimationFrame(() => {
        marqueeJustFinished = false;
      });
    }
  });

  // Cleanup RAF on unmount
  useEffect(() => {
    return () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
      }
    };
  }, []);

  // Register global mouse event listeners
  // Listen at document level to support containers with pointer-events: none
  // Always register listeners - the handler checks `enabled` via useEffectEvent
  // This ensures marquee works even when items load after mount
  useEffect(() => {
    // Use capture phase to intercept before other handlers
    document.addEventListener('mousedown', onMouseDown, true);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp, true);

    return () => {
      document.removeEventListener('mousedown', onMouseDown, true);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp, true);
    };
  }, []);

  return {
    marqueeState,
    selectedIds,
  };
}
