import type React from 'react';
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import type { TimelineItem } from '@/types/timeline';
import type { DragState, UseTimelineDragReturn, SnapTarget } from '../types/drag';
import { useTimelineStore } from '../stores/timeline-store';
import { useSelectionStore } from '@/shared/state/selection';
import { useTimelineZoom } from './use-timeline-zoom';
import { useSnapCalculator } from './use-snap-calculator';
import { findNearestAvailableSpace } from '../utils/collision-utils';
import { DRAG_THRESHOLD_PIXELS } from '../constants';

// Shared ref for drag offset (avoids re-renders from store updates)
export const dragOffsetRef = { current: { x: 0, y: 0 } };

const DRAG_CURSOR_CLASS_BY_MODE = {
  grabbing: 'timeline-item-drag-cursor-grabbing',
  copy: 'timeline-item-drag-cursor-copy',
  'not-allowed': 'timeline-item-drag-cursor-not-allowed',
} as const;

type DragCursorMode = keyof typeof DRAG_CURSOR_CLASS_BY_MODE;

const DRAG_CURSOR_CLASSES = Object.values(DRAG_CURSOR_CLASS_BY_MODE);

function setGlobalDragCursor(mode: DragCursorMode): void {
  document.body.classList.remove(...DRAG_CURSOR_CLASSES);
  document.body.classList.add(DRAG_CURSOR_CLASS_BY_MODE[mode]);
}

function clearGlobalDragCursor(): void {
  document.body.classList.remove(...DRAG_CURSOR_CLASSES);
}

/**
 * Timeline drag-and-drop hook - Phase 2 Enhanced
 *
 * Features:
 * - Single and multi-select drag
 * - Horizontal (time) and vertical (track) movement
 * - Grid + magnetic snapping (adaptive threshold)
 * - Collision detection with push-forward
 * - Undo/redo support (automatic via Zundo)
 *
 * @param item - The timeline item to make draggable
 * @param timelineDuration - Total timeline duration in seconds
 * @param trackLocked - Whether the track is locked (prevents dragging)
 */
export function useTimelineDrag(
  item: TimelineItem,
  timelineDuration: number,
  trackLocked: boolean = false,
  elementRef?: React.RefObject<HTMLDivElement | null>
): UseTimelineDragReturn {
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const dragStateRef = useRef<DragState | null>(null);

  // Track Alt key state for duplication mode (dynamic toggle during drag)
  const isAltDragRef = useRef(false);

  // Track previous snap target to avoid unnecessary store updates
  const prevSnapTargetRef = useRef<{ frame: number; type: string } | null>(null);

  // Get store actions with granular selectors
  const moveItem = useTimelineStore((s) => s.moveItem);
  const moveItems = useTimelineStore((s) => s.moveItems);
  const duplicateItems = useTimelineStore((s) => s.duplicateItems);
  const tracks = useTimelineStore((s) => s.tracks);
  // NOTE: Don't subscribe to items here! Every TimelineItem has this hook,
  // subscribing to items would cause ALL items to re-render when ANY item changes.
  // Instead, read items on-demand in callbacks using getState().

  // Selection store - use granular selectors to prevent re-renders
  // NOTE: dragState subscription removed - activeSnapTarget is read directly in timeline-content.tsx
  const selectedItemIds = useSelectionStore((s) => s.selectedItemIds);
  const selectItems = useSelectionStore((s) => s.selectItems);
  const setDragState = useSelectionStore((s) => s.setDragState);

  // Get zoom utilities
  const { pixelsToFrame } = useTimelineZoom();

  // Get current alt-drag state from selection store for snap exclusion logic
  const isAltDragActive = useSelectionStore((s) => s.dragState?.isAltDrag ?? false);

  // Snap calculator - only use magnetic snap targets (item edges), not grid lines
  // Pass all selected item IDs to exclude from snap targets (for group selection)
  // During alt-drag (duplicate), DON'T exclude original items - allow snapping to them
  const excludeFromSnap = useMemo(() => {
    // During alt-drag, include original items as snap targets
    if (isAltDragActive) {
      return null; // Don't exclude any items
    }
    // Normal drag: exclude dragging items from snap targets
    if (selectedItemIds.includes(item.id)) {
      return selectedItemIds;
    }
    return item.id;
  }, [selectedItemIds, item.id, isAltDragActive]);

  const { magneticSnapTargets, snapThresholdFrames, snapEnabled } = useSnapCalculator(
    timelineDuration,
    excludeFromSnap
  );

  // Create stable refs to avoid stale closures in event listeners
  const pixelsToFrameRef = useRef(pixelsToFrame);
  const moveItemRef = useRef(moveItem);
  const moveItemsRef = useRef(moveItems);
  const duplicateItemsRef = useRef(duplicateItems);
  const tracksRef = useRef(tracks);
  const selectedItemIdsRef = useRef(selectedItemIds);

  // Helper to get items on-demand (avoids subscription that would cause all items to re-render)
  const getItems = useCallback(() => useTimelineStore.getState().items, []);
  // Update refs synchronously (not in useEffect) so they're always current
  const magneticSnapTargetsRef = useRef(magneticSnapTargets);
  magneticSnapTargetsRef.current = magneticSnapTargets;
  const snapThresholdFramesRef = useRef(snapThresholdFrames);
  snapThresholdFramesRef.current = snapThresholdFrames;
  const snapEnabledRef = useRef(snapEnabled);
  snapEnabledRef.current = snapEnabled;

  // Update refs when dependencies change
  useEffect(() => {
    pixelsToFrameRef.current = pixelsToFrame;
    moveItemRef.current = moveItem;
    moveItemsRef.current = moveItems;
    duplicateItemsRef.current = duplicateItems;
    tracksRef.current = tracks;
    selectedItemIdsRef.current = selectedItemIds;
  }, [pixelsToFrame, moveItem, moveItems, duplicateItems, tracks, selectedItemIds]);

  /**
   * Calculate which track the mouse is over based on Y position
   */
  /**
   * Resolve the track element at the cursor, ignoring dragged items.
   * Dragged items are transformed visually but still live under their original track in the DOM,
   * so we must skip them during hit-testing to get the real row under the pointer.
   */
  const getTrackElementAtPoint = useCallback((mouseX: number, mouseY: number): HTMLElement | null => {
    const draggedItemIds = new Set(
      dragStateRef.current?.draggedItems.map((draggedItem) => draggedItem.id) ?? []
    );

    const getTrackIfNotDraggedItem = (candidate: Element | null): HTMLElement | null => {
      if (!(candidate instanceof HTMLElement)) return null;

      const itemEl = candidate.closest<HTMLElement>('[data-item-id]');
      if (itemEl) {
        const itemId = itemEl.getAttribute('data-item-id');
        if (itemId && draggedItemIds.has(itemId)) return null;
      }

      return candidate.closest<HTMLElement>('[data-track-id]');
    };

    // Fast path: top-most hit target
    const topTrackEl = getTrackIfNotDraggedItem(document.elementFromPoint(mouseX, mouseY));
    if (topTrackEl) return topTrackEl;

    // Fallback: walk hit stack to find first non-dragged track element
    for (const candidate of document.elementsFromPoint(mouseX, mouseY)) {
      const trackEl = getTrackIfNotDraggedItem(candidate);
      if (trackEl) return trackEl;
    }

    return null;
  }, []);

  const isMouseOverGroupTrack = useCallback((mouseX: number, mouseY: number): boolean => {
    const trackEl = getTrackElementAtPoint(mouseX, mouseY);
    if (!trackEl) return false;

    const trackId = trackEl.getAttribute('data-track-id');
    if (!trackId) return false;

    const track = tracksRef.current.find((t) => t.id === trackId);
    return !!track?.isGroup;
  }, [getTrackElementAtPoint]);

  const getTrackIdFromMouseY = useCallback((mouseY: number, startTrackId: string): string => {
    const container = document.querySelector('.timeline-container');
    const trackElements = (container ?? document).querySelectorAll('[data-track-id]');
    const tracks = tracksRef.current;

    // Find track element under cursor (skip group tracks - they don't hold items)
    for (const el of Array.from(trackElements)) {
      const rect = el.getBoundingClientRect();
      if (mouseY >= rect.top && mouseY <= rect.bottom) {
        const trackId = el.getAttribute('data-track-id');
        if (trackId) {
          const track = tracks.find((t) => t.id === trackId);
          if (track?.isGroup) break; // Skip group tracks, fall through to fallback
          return trackId;
        }
      }
    }

    // Fallback to calculating by track height (skipping group tracks)
    const startTrack = tracks.find((t) => t.id === startTrackId);
    if (!startTrack) return startTrackId;

    const startTrackIndex = tracks.findIndex((t) => t.id === startTrackId);
    const trackHeight = startTrack.height || 64;
    const deltaY = mouseY - (dragStateRef.current?.startMouseY || 0);
    const trackOffset = Math.round(deltaY / trackHeight);
    const newTrackIndex = Math.max(0, Math.min(tracks.length - 1, startTrackIndex + trackOffset));

    const candidateTrack = tracks[newTrackIndex];
    if (candidateTrack?.isGroup) {
      // If landed on a group track, find the nearest non-group track
      // Search downward first, then upward
      for (let i = newTrackIndex + 1; i < tracks.length; i++) {
        if (!tracks[i]?.isGroup) return tracks[i]!.id;
      }
      for (let i = newTrackIndex - 1; i >= 0; i--) {
        if (!tracks[i]?.isGroup) return tracks[i]!.id;
      }
      return startTrackId; // No non-group tracks found, stay on original
    }

    return candidateTrack?.id || startTrackId;
  }, []);

  /**
   * Calculate magnetic snap for item position (start and end edges)
   * Only snaps to other item edges, not grid lines
   */
  const calculateMagneticSnap = useCallback((
    targetStartFrame: number,
    itemDurationInFrames: number
  ): { snappedFrame: number; snapTarget: SnapTarget | null } => {
    const targets = magneticSnapTargetsRef.current;
    const threshold = snapThresholdFramesRef.current;
    const enabled = snapEnabledRef.current;

    if (!enabled || targets.length === 0) {
      return { snappedFrame: targetStartFrame, snapTarget: null };
    }

    const targetEndFrame = targetStartFrame + itemDurationInFrames;

    // Find nearest snap for start position
    let nearestStartTarget: SnapTarget | null = null;
    let startDistance = threshold;
    for (const target of targets) {
      const distance = Math.abs(targetStartFrame - target.frame);
      if (distance < startDistance) {
        nearestStartTarget = target;
        startDistance = distance;
      }
    }

    // Find nearest snap for end position
    let nearestEndTarget: SnapTarget | null = null;
    let endDistance = threshold;
    for (const target of targets) {
      const distance = Math.abs(targetEndFrame - target.frame);
      if (distance < endDistance) {
        nearestEndTarget = target;
        endDistance = distance;
      }
    }

    // Use the closer snap
    if (startDistance < endDistance && nearestStartTarget) {
      return { snappedFrame: nearestStartTarget.frame, snapTarget: nearestStartTarget };
    } else if (nearestEndTarget) {
      // Snap end, adjust start position
      return { snappedFrame: nearestEndTarget.frame - itemDurationInFrames, snapTarget: nearestEndTarget };
    }

    return { snappedFrame: targetStartFrame, snapTarget: null };
  }, []);

  /**
   * Handle mouse down - start dragging
   */
  const handleDragStart = useCallback(
    (e: React.MouseEvent) => {
      // Don't allow dragging on locked tracks
      if (trackLocked) {
        return;
      }

      // Prevent if clicking on resize handles
      const target = e.target as HTMLElement;
      if (target.classList.contains('cursor-ew-resize')) {
        return;
      }

      e.stopPropagation();

      // Check if this item is in current selection
      const currentSelectedIds = selectedItemIdsRef.current;
      const isInSelection = currentSelectedIds.includes(item.id);

      // If not in selection, select it (multi-select handled by TimelineItem's onClick)
      if (!isInSelection) {
        selectItems([item.id]);
      }

      // Determine which items to drag
      const itemsToDrag = isInSelection ? currentSelectedIds : [item.id];
      const allItems = getItems();

      // Store initial state for all dragged items
      const draggedItems = itemsToDrag
        .map((id) => {
          const dragItem = allItems.find((i) => i.id === id);
          if (!dragItem) return null;
          return {
            id: dragItem.id,
            initialFrame: dragItem.from,
            initialTrackId: dragItem.trackId,
          };
        })
        .filter((i) => i !== null) as Array<{
        id: string;
        initialFrame: number;
        initialTrackId: string;
      }>;

      // Initialize drag state
      dragStateRef.current = {
        itemId: item.id, // Anchor item
        startFrame: item.from,
        startTrackId: item.trackId,
        startMouseX: e.clientX,
        startMouseY: e.clientY,
        currentMouseX: e.clientX,
        currentMouseY: e.clientY,
        draggedItems,
      };

      // Don't set cursor immediately - wait for drag threshold

      // Attach a temporary mousemove listener to detect drag threshold
      const checkDragThreshold = (e: MouseEvent) => {
        if (!dragStateRef.current) return;

        const deltaX = e.clientX - dragStateRef.current.startMouseX;
        const deltaY = e.clientY - dragStateRef.current.startMouseY;

        // Check if we've moved enough to start dragging
        if (Math.abs(deltaX) > DRAG_THRESHOLD_PIXELS || Math.abs(deltaY) > DRAG_THRESHOLD_PIXELS) {
          // Start the drag - track Alt key state
          isAltDragRef.current = e.altKey;
          setIsDragging(true);
          setGlobalDragCursor(e.altKey ? 'copy' : 'grabbing');
          document.body.style.userSelect = 'none';

          // Broadcast drag state to all selected items
          const draggedIds = dragStateRef.current?.draggedItems.map((item) => item.id) || [];
          setDragState({
            isDragging: true,
            draggedItemIds: draggedIds,
            offset: { x: 0, y: 0 },
            isAltDrag: e.altKey,
          });

          // Remove this listener - the main useEffect will handle it now
          window.removeEventListener('mousemove', checkDragThreshold);
          window.removeEventListener('mouseup', cancelDrag);
        }
      };

      const cancelDrag = () => {
        // Clean up if mouse released before threshold
        dragStateRef.current = null;
        window.removeEventListener('mousemove', checkDragThreshold);
        window.removeEventListener('mouseup', cancelDrag);
      };

      window.addEventListener('mousemove', checkDragThreshold);
      window.addEventListener('mouseup', cancelDrag);
    },
    [item.id, item.from, item.trackId, selectItems, trackLocked, setDragState, getItems]
  );

  /**
   * Handle mouse move - update drag position
   */
  useEffect(() => {
    if (!dragStateRef.current || !isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!dragStateRef.current) return;

      const deltaX = e.clientX - dragStateRef.current.startMouseX;
      const deltaY = e.clientY - dragStateRef.current.startMouseY;

      // Dynamic Alt key toggle - update state and cursor
      const altKeyChanged = isAltDragRef.current !== e.altKey;
      isAltDragRef.current = e.altKey;

      // Show not-allowed cursor when over a group track, otherwise normal drag cursor
      const overGroup = isMouseOverGroupTrack(e.clientX, e.clientY);
      const desiredCursor = overGroup ? 'not-allowed' : e.altKey ? 'copy' : 'grabbing';
      setGlobalDragCursor(desiredCursor);

      // Calculate clamped delta to prevent visual preview from going below frame 0
      const deltaFrames = pixelsToFrameRef.current(deltaX);
      const draggedItems = dragStateRef.current.draggedItems;

      // Find the minimum starting frame among all dragged items
      let minInitialFrame = Infinity;
      for (const draggedItem of draggedItems) {
        if (draggedItem.initialFrame < minInitialFrame) {
          minInitialFrame = draggedItem.initialFrame;
        }
      }

      // Calculate the maximum allowed negative deltaX (in pixels)
      // to prevent the earliest item from going below frame 0
      const maxNegativeDeltaFrames = -minInitialFrame;
      const clampedDeltaFrames = Math.max(maxNegativeDeltaFrames, deltaFrames);

      // Convert back to pixels for the clamped X offset
      // Use the ratio of clamped to original to maintain precision
      const clampedDeltaX = deltaFrames !== 0
        ? deltaX * (clampedDeltaFrames / deltaFrames)
        : deltaX;

      // Immediate visual feedback — apply transform directly to bypass React render lag
      if (elementRef?.current && !isAltDragRef.current) {
        elementRef.current.style.transform = `translate(${clampedDeltaX}px, ${deltaY}px)`;
      }

      // Update shared ref for other items to read (no re-renders)
      dragOffsetRef.current = { x: clampedDeltaX, y: deltaY };

      // Update React state (batched) for ghost positioning and render fallback
      setDragOffset({ x: clampedDeltaX, y: deltaY });

      dragStateRef.current.currentMouseX = e.clientX;
      dragStateRef.current.currentMouseY = e.clientY;

      // For multi-item drag, calculate group bounding box for snap visualization
      // Note: deltaFrames and draggedItems already calculated above for clamping
      let snapStartFrame: number;
      let snapDuration: number;

      if (draggedItems.length > 1) {
        // Calculate group bounds
        let groupStartFrame = Infinity;
        let groupEndFrame = -Infinity;

        for (const draggedItem of draggedItems) {
          const sourceItem = getItems().find((i) => i.id === draggedItem.id);
          if (!sourceItem) continue;

          const proposedStart = draggedItem.initialFrame + deltaFrames;
          const proposedEnd = proposedStart + sourceItem.durationInFrames;

          if (proposedStart < groupStartFrame) groupStartFrame = proposedStart;
          if (proposedEnd > groupEndFrame) groupEndFrame = proposedEnd;
        }

        snapStartFrame = Math.max(0, groupStartFrame);
        snapDuration = groupEndFrame - groupStartFrame;
      } else {
        // Single item drag - use anchor item
        snapStartFrame = Math.max(0, dragStateRef.current.startFrame + deltaFrames);
        const draggedItem = getItems().find((i) => i.id === dragStateRef.current?.itemId);
        snapDuration = draggedItem?.durationInFrames || 0;
      }

      const snapResult = calculateMagneticSnap(snapStartFrame, snapDuration);

      // Only update store when snap target or alt state actually changes to reduce re-renders
      const prevSnap = prevSnapTargetRef.current;
      const newSnap = snapResult.snapTarget;
      const snapChanged =
        (prevSnap === null && newSnap !== null) ||
        (prevSnap !== null && newSnap === null) ||
        (prevSnap !== null && newSnap !== null && (prevSnap.frame !== newSnap.frame || prevSnap.type !== newSnap.type));

      if (snapChanged || altKeyChanged) {
        prevSnapTargetRef.current = newSnap ? { frame: newSnap.frame, type: newSnap.type } : null;
        const draggedIds = dragStateRef.current?.draggedItems.map((item) => item.id) || [];
        setDragState({
          isDragging: true,
          draggedItemIds: draggedIds,
          offset: { x: clampedDeltaX, y: deltaY },
          activeSnapTarget: snapResult.snapTarget,
          isAltDrag: e.altKey,
        });
      }
    };

    const handleMouseUp = () => {
      if (!dragStateRef.current || !isDragging) return;

      const dragState = dragStateRef.current;
      const deltaX = dragState.currentMouseX - dragState.startMouseX;
      const isAltDrag = isAltDragRef.current;

      // Calculate frame delta
      const deltaFrames = pixelsToFrameRef.current(deltaX);

      // Calculate new track for anchor item
      const newTrackId = getTrackIdFromMouseY(dragState.currentMouseY, dragState.startTrackId);

      // Multi-item drag or single?
      if (dragState.draggedItems.length > 1) {
        // Multi-item drag: calculate group bounding box for snapping
        // Snap should only happen at the edges of the entire selection, not individual items
        let groupStartFrame = Infinity;
        let groupEndFrame = -Infinity;

        for (const draggedItem of dragState.draggedItems) {
          const sourceItem = getItems().find((i) => i.id === draggedItem.id);
          if (!sourceItem) continue;

          const proposedStart = draggedItem.initialFrame + deltaFrames;
          const proposedEnd = proposedStart + sourceItem.durationInFrames;

          if (proposedStart < groupStartFrame) groupStartFrame = proposedStart;
          if (proposedEnd > groupEndFrame) groupEndFrame = proposedEnd;
        }

        // Ensure valid bounds
        groupStartFrame = Math.max(0, groupStartFrame);
        const groupDuration = groupEndFrame - groupStartFrame;

        // Calculate snap using the group's bounding box
        let snapDelta = 0;
        if (groupDuration > 0) {
          const snapResult = calculateMagneticSnap(groupStartFrame, groupDuration);
          snapDelta = snapResult.snappedFrame - groupStartFrame;
        }

        // Calculate how much we need to clamp the group to prevent any item going below frame 0
        // Find the minimum proposed start frame across all items
        let minProposedFrame = Infinity;
        for (const draggedItem of dragState.draggedItems) {
          const proposedStart = draggedItem.initialFrame + deltaFrames + snapDelta;
          if (proposedStart < minProposedFrame) {
            minProposedFrame = proposedStart;
          }
        }

        // Calculate group clamp offset - if any item would go below 0, shift the whole group
        const groupClampOffset = minProposedFrame < 0 ? -minProposedFrame : 0;

        // Multi-item drag: calculate new positions for all items
        const movedItems = dragState.draggedItems.map((draggedItem) => {
          const sourceItem = getItems().find((i) => i.id === draggedItem.id);
          if (!sourceItem) return null;

          // Calculate new frame (maintain relative offset from anchor)
          // Apply frame delta, snap adjustment, AND group clamp offset to all items uniformly
          const newFrom = draggedItem.initialFrame + deltaFrames + snapDelta + groupClampOffset;

          // Calculate new track (maintain relative offset, skip group tracks)
          const anchorTrackIndex = tracksRef.current.findIndex(
            (t) => t.id === dragState.startTrackId
          );
          const itemTrackIndex = tracksRef.current.findIndex(
            (t) => t.id === draggedItem.initialTrackId
          );
          const newAnchorTrackIndex = tracksRef.current.findIndex((t) => t.id === newTrackId);
          const trackOffset = itemTrackIndex - anchorTrackIndex;
          let newItemTrackIndex = Math.max(
            0,
            Math.min(tracksRef.current.length - 1, newAnchorTrackIndex + trackOffset)
          );

          // If landed on a group track, find nearest non-group track
          if (tracksRef.current[newItemTrackIndex]?.isGroup) {
            let found = false;
            for (let i = newItemTrackIndex + 1; i < tracksRef.current.length; i++) {
              if (!tracksRef.current[i]?.isGroup) { newItemTrackIndex = i; found = true; break; }
            }
            if (!found) {
              for (let i = newItemTrackIndex - 1; i >= 0; i--) {
                if (!tracksRef.current[i]?.isGroup) { newItemTrackIndex = i; found = true; break; }
              }
            }
          }

          const itemNewTrackId = tracksRef.current[newItemTrackIndex]?.id || draggedItem.initialTrackId;

          return {
            id: draggedItem.id,
            newFrom,
            newTrackId: itemNewTrackId,
            durationInFrames: sourceItem.durationInFrames,
          };
        }).filter((i) => i !== null) as Array<{
          id: string;
          newFrom: number;
          newTrackId: string;
          durationInFrames: number;
        }>;

        // For multi-item drag: check if ANY item would collide, and if so, snap the whole group forward
        // Find the earliest collision among all moved items
        const draggedItemIds = movedItems.map((m) => m.id);
        // For alt-drag (duplicate), include all items in collision check since originals stay in place
        const itemsExcludingDragged = isAltDrag
          ? getItems()
          : getItems().filter((i) => !draggedItemIds.includes(i.id));

        let maxSnapForward = 0; // How many frames we need to move the whole group forward

        for (const movedItem of movedItems) {
          const finalPosition = findNearestAvailableSpace(
            movedItem.newFrom,
            movedItem.durationInFrames,
            movedItem.newTrackId,
            itemsExcludingDragged
          );

          if (finalPosition === null) {
            console.warn(isAltDrag ? 'Cannot duplicate items: no available space' : 'Cannot move items: no available space');
            // Clean up and cancel - defer drag state to avoid render cascade
            if (elementRef?.current) {
              elementRef.current.style.transform = '';
            }
            dragOffsetRef.current = { x: 0, y: 0 };
            prevSnapTargetRef.current = null;
            dragStateRef.current = null;
            isAltDragRef.current = false;
            clearGlobalDragCursor();
            document.body.style.userSelect = '';
            setIsDragging(false);
            setDragOffset({ x: 0, y: 0 });
            queueMicrotask(() => setDragState(null));
            return;
          }

          // Calculate how much this item needs to move forward
          const snapAmount = finalPosition - movedItem.newFrom;
          if (snapAmount > maxSnapForward) {
            maxSnapForward = snapAmount;
          }
        }

        if (isAltDrag) {
          // ALT-DRAG: Duplicate items at new positions
          const itemIds = movedItems.map((m) => m.id);
          const positions = movedItems.map((m) => ({
            from: m.newFrom + maxSnapForward,
            trackId: m.newTrackId,
          }));

          // Duplicate items (single undo snapshot)
          duplicateItemsRef.current(itemIds, positions);
        } else {
          // Normal drag: Apply the snap to ALL items in the group
          const allUpdates = movedItems.map((m) => ({
            id: m.id,
            from: m.newFrom + maxSnapForward,
            trackId: m.newTrackId !== getItems().find((i) => i.id === m.id)?.trackId
              ? m.newTrackId
              : undefined,
          }));

          // Apply batch update (single undo snapshot)
          moveItemsRef.current(allUpdates);
        }
      } else {
        // Single item drag
        let proposedFrame = Math.max(0, dragState.startFrame + deltaFrames);

        // Apply snapping
        const snapResult = calculateMagneticSnap(proposedFrame, item.durationInFrames);
        // Clamp after snapping to ensure we don't go below frame 0
        proposedFrame = Math.max(0, snapResult.snappedFrame);

        // Find nearest available space (snaps forward if collision)
        // For alt-drag, include the original item in collision check since it stays in place
        const itemsExcludingDragged = isAltDrag
          ? getItems()
          : getItems().filter((i) => i.id !== item.id);
        const finalFrame = findNearestAvailableSpace(
          proposedFrame,
          item.durationInFrames,
          newTrackId,
          itemsExcludingDragged
        );

        if (finalFrame !== null) {
          if (isAltDrag) {
            // ALT-DRAG: Duplicate item at new position
            duplicateItemsRef.current(
              [item.id],
              [{ from: finalFrame, trackId: newTrackId }]
            );
          } else {
            // Normal drag: Move item
            const trackChanged = newTrackId !== dragState.startTrackId;
            moveItemRef.current(item.id, finalFrame, trackChanged ? newTrackId : undefined);
          }
        } else {
          // No space available - cancel drag (keep at original position)
          console.warn(isAltDrag ? 'Cannot duplicate item: no available space' : 'Cannot move item: no available space');
        }
      }

      // Clean up - defer drag state clearing to avoid multiple render cycles
      // The move operation already triggered a re-render; clearing drag state
      // should happen after that render completes
      if (elementRef?.current) {
        elementRef.current.style.transform = '';
      }
      dragOffsetRef.current = { x: 0, y: 0 }; // Reset shared ref immediately
      prevSnapTargetRef.current = null; // Reset snap target tracking
      dragStateRef.current = null;
      isAltDragRef.current = false; // Reset alt drag state
      clearGlobalDragCursor();
      document.body.style.userSelect = '';

      // Batch React state updates (React 18 batches these automatically)
      setIsDragging(false);
      setDragOffset({ x: 0, y: 0 });

      // Defer selection store cleanup to next microtask to avoid
      // synchronous re-render cascade after move operation
      queueMicrotask(() => {
        setDragState(null);
      });
    };

    if (dragStateRef.current) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);

      return () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
        clearGlobalDragCursor();
        document.body.style.userSelect = '';
      };
    }
  }, [isDragging, item.id, item.durationInFrames, getTrackIdFromMouseY, isMouseOverGroupTrack, calculateMagneticSnap, elementRef, getItems, setDragState]);

  return {
    isDragging,
    dragOffset,
    handleDragStart,
  };
}
