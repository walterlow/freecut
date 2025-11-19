import { useState, useEffect, useRef, useCallback } from 'react';
import type { TimelineItem } from '@/types/timeline';
import type { DragState, UseTimelineDragReturn } from '../types/drag';
import { useTimelineStore } from '../stores/timeline-store';
import { useSelectionStore } from '@/features/editor/stores/selection-store';
import { useTimelineZoom } from './use-timeline-zoom';
import { useSnapCalculator } from './use-snap-calculator';
import { findNearestAvailableSpace } from '../utils/collision-utils';
import { DRAG_THRESHOLD_PIXELS } from '../constants';

// Shared ref for drag offset (avoids re-renders from store updates)
export const dragOffsetRef = { current: { x: 0, y: 0 } };

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
  trackLocked: boolean = false
): UseTimelineDragReturn {
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const dragStateRef = useRef<DragState | null>(null);

  // Get store actions and state with granular selectors
  const moveItem = useTimelineStore((s) => s.moveItem);
  const moveItems = useTimelineStore((s) => s.moveItems);
  const tracks = useTimelineStore((s) => s.tracks);
  const items = useTimelineStore((s) => s.items);

  // Selection store
  const selectedItemIds = useSelectionStore((s) => s.selectedItemIds);
  const selectItems = useSelectionStore((s) => s.selectItems);
  const setDragState = useSelectionStore((s) => s.setDragState);

  // Get zoom utilities
  const { pixelsToFrame } = useTimelineZoom();

  // Phase 2 features
  const { calculateSnap } = useSnapCalculator(
    timelineDuration,
    isDragging ? item.id : null
  );

  // Get all items for collision detection
  const allItems = useTimelineStore((s) => s.items);

  // Create stable refs to avoid stale closures in event listeners
  const pixelsToFrameRef = useRef(pixelsToFrame);
  const moveItemRef = useRef(moveItem);
  const moveItemsRef = useRef(moveItems);
  const tracksRef = useRef(tracks);
  const itemsRef = useRef(items);
  const allItemsRef = useRef(allItems);
  const selectedItemIdsRef = useRef(selectedItemIds);

  // Update refs when dependencies change
  useEffect(() => {
    pixelsToFrameRef.current = pixelsToFrame;
    moveItemRef.current = moveItem;
    moveItemsRef.current = moveItems;
    tracksRef.current = tracks;
    itemsRef.current = items;
    allItemsRef.current = allItems;
    selectedItemIdsRef.current = selectedItemIds;
  }, [pixelsToFrame, moveItem, moveItems, tracks, items, allItems, selectedItemIds]);

  /**
   * Calculate which track the mouse is over based on Y position
   */
  const getTrackIdFromMouseY = useCallback((mouseY: number, startTrackId: string): string => {
    const trackElements = document.querySelectorAll('[data-track-id]');
    const tracks = tracksRef.current;

    // Find track element under cursor
    for (const el of Array.from(trackElements)) {
      const rect = el.getBoundingClientRect();
      if (mouseY >= rect.top && mouseY <= rect.bottom) {
        const trackId = el.getAttribute('data-track-id');
        if (trackId) return trackId;
      }
    }

    // Fallback to calculating by track height
    const startTrack = tracks.find((t) => t.id === startTrackId);
    if (!startTrack) return startTrackId;

    const startTrackIndex = tracks.findIndex((t) => t.id === startTrackId);
    const trackHeight = startTrack.height || 64;
    const deltaY = mouseY - (dragStateRef.current?.startMouseY || 0);
    const trackOffset = Math.round(deltaY / trackHeight);
    const newTrackIndex = Math.max(0, Math.min(tracks.length - 1, startTrackIndex + trackOffset));

    return tracks[newTrackIndex]?.id || startTrackId;
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
      const allItems = itemsRef.current;

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
          // Start the drag
          setIsDragging(true);
          document.body.style.cursor = 'grabbing';
          document.body.style.userSelect = 'none';

          // Broadcast drag state to all selected items
          const draggedIds = dragStateRef.current?.draggedItems.map((item) => item.id) || [];
          setDragState({
            isDragging: true,
            draggedItemIds: draggedIds,
            offset: { x: 0, y: 0 },
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
    [item.id, item.from, item.trackId, selectItems, trackLocked, setDragState]
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

      // Update drag offset for visual preview (local state for anchor item)
      setDragOffset({ x: deltaX, y: deltaY });

      // Update shared ref for other items to read (no re-renders)
      dragOffsetRef.current = { x: deltaX, y: deltaY };

      dragStateRef.current.currentMouseX = e.clientX;
      dragStateRef.current.currentMouseY = e.clientY;
    };

    const handleMouseUp = () => {
      if (!dragStateRef.current || !isDragging) return;

      const dragState = dragStateRef.current;
      const deltaX = dragState.currentMouseX - dragState.startMouseX;

      // Apply changes (we only get here if isDragging is true)
      if (true) {
        // Calculate frame delta
        const deltaFrames = pixelsToFrameRef.current(deltaX);

        // Calculate new track for anchor item
        const newTrackId = getTrackIdFromMouseY(dragState.currentMouseY, dragState.startTrackId);

        // Multi-item drag or single?
        if (dragState.draggedItems.length > 1) {
          // Multi-item drag: calculate new positions for all items
          const movedItems = dragState.draggedItems.map((draggedItem) => {
            const sourceItem = itemsRef.current.find((i) => i.id === draggedItem.id);
            if (!sourceItem) return null;

            // Calculate new frame (maintain relative offset from anchor)
            let newFrom = Math.max(0, draggedItem.initialFrame + deltaFrames);

            // Calculate new track (maintain relative offset)
            const anchorTrackIndex = tracksRef.current.findIndex(
              (t) => t.id === dragState.startTrackId
            );
            const itemTrackIndex = tracksRef.current.findIndex(
              (t) => t.id === draggedItem.initialTrackId
            );
            const newAnchorTrackIndex = tracksRef.current.findIndex((t) => t.id === newTrackId);
            const trackOffset = itemTrackIndex - anchorTrackIndex;
            const newItemTrackIndex = Math.max(
              0,
              Math.min(tracksRef.current.length - 1, newAnchorTrackIndex + trackOffset)
            );
            const itemNewTrackId = tracksRef.current[newItemTrackIndex]?.id || draggedItem.initialTrackId;

            // Apply snapping (only to anchor item, others follow)
            if (draggedItem.id === item.id) {
              const snapResult = calculateSnap(newFrom);
              newFrom = snapResult.snappedFrame;
            }

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
          const itemsExcludingDragged = allItemsRef.current.filter((i) => !draggedItemIds.includes(i.id));

          let maxSnapForward = 0; // How many frames we need to move the whole group forward

          for (const movedItem of movedItems) {
            const finalPosition = findNearestAvailableSpace(
              movedItem.newFrom,
              movedItem.durationInFrames,
              movedItem.newTrackId,
              itemsExcludingDragged
            );

            if (finalPosition === null) {
              console.warn('Cannot move items: no available space');
              return; // Cancel the entire multi-drag
            }

            // Calculate how much this item needs to move forward
            const snapAmount = finalPosition - movedItem.newFrom;
            if (snapAmount > maxSnapForward) {
              maxSnapForward = snapAmount;
            }
          }

          // Apply the snap to ALL items in the group
          const allUpdates = movedItems.map((m) => ({
            id: m.id,
            from: m.newFrom + maxSnapForward,
            trackId: m.newTrackId !== itemsRef.current.find((i) => i.id === m.id)?.trackId
              ? m.newTrackId
              : undefined,
          }));

          // Apply batch update (single undo snapshot)
          moveItemsRef.current(allUpdates);
        } else {
          // Single item drag
          let proposedFrame = Math.max(0, dragState.startFrame + deltaFrames);

          // Apply snapping
          const snapResult = calculateSnap(proposedFrame);
          proposedFrame = snapResult.snappedFrame;

          // Find nearest available space (snaps forward if collision)
          // Exclude the item being dragged from collision detection
          const itemsExcludingDragged = allItemsRef.current.filter((i) => i.id !== item.id);
          const finalFrame = findNearestAvailableSpace(
            proposedFrame,
            item.durationInFrames,
            newTrackId,
            itemsExcludingDragged
          );

          if (finalFrame !== null) {
            const trackChanged = newTrackId !== dragState.startTrackId;
            moveItemRef.current(item.id, finalFrame, trackChanged ? newTrackId : undefined);
          } else {
            // No space available - cancel drag (keep at original position)
            console.warn('Cannot move item: no available space');
          }
        }
      }

      // Clean up
      setIsDragging(false);
      setDragOffset({ x: 0, y: 0 });
      setDragState(null); // Clear drag state
      dragOffsetRef.current = { x: 0, y: 0 }; // Reset shared ref
      dragStateRef.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    if (dragStateRef.current) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);

      return () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isDragging, item.id, getTrackIdFromMouseY, calculateSnap]);

  return {
    isDragging,
    dragOffset,
    handleDragStart,
  };
}
