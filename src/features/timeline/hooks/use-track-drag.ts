import { useState, useEffect, useRef, useCallback } from 'react';
import type { TimelineTrack } from '@/types/timeline';
import { useTimelineStore } from '../stores/timeline-store';
import { useSelectionStore } from '@/features/editor/stores/selection-store';
import { DRAG_THRESHOLD_PIXELS } from '../constants';

// Shared ref for drag offset (avoids re-renders from store updates)
export const trackDragOffsetRef = { current: 0 };

// Shared ref for drop index indicator
export const trackDropIndexRef = { current: -1 };

interface DragState {
  trackId: string; // Anchor track
  startTrackIndex: number;
  startMouseY: number;
  currentMouseY: number;
  draggedTracks: Array<{
    id: string;
    initialIndex: number;
  }>;
}

interface UseTrackDragReturn {
  isDragging: boolean;
  dragOffset: number;
  dropIndex: number; // Index where tracks will be dropped (-1 if not dragging)
  handleDragStart: (e: React.MouseEvent) => void;
}

/**
 * Track drag-and-drop hook for vertical reordering
 *
 * Follows the same pattern as use-timeline-drag but for vertical track reordering.
 * Supports multi-track selection and drag.
 *
 * @param track - The track to make draggable
 */
export function useTrackDrag(track: TimelineTrack): UseTrackDragReturn {
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState(0);
  const [dropIndex, setDropIndex] = useState(-1);
  const dragStateRef = useRef<DragState | null>(null);

  // Get store state with granular selectors
  const tracks = useTimelineStore((s) => s.tracks);
  const setTracks = useTimelineStore((s) => s.setTracks);

  // Selection store
  const selectedTrackIds = useSelectionStore((s) => s.selectedTrackIds);
  const selectTracks = useSelectionStore((s) => s.selectTracks);
  const setDragState = useSelectionStore((s) => s.setDragState);

  // Create stable refs to avoid stale closures
  const tracksRef = useRef(tracks);
  const selectedTrackIdsRef = useRef(selectedTrackIds);
  const setTracksRef = useRef(setTracks);

  // Update refs when dependencies change
  useEffect(() => {
    tracksRef.current = tracks;
    selectedTrackIdsRef.current = selectedTrackIds;
    setTracksRef.current = setTracks;
  }, [tracks, selectedTrackIds, setTracks]);

  /**
   * Handle mouse down - start dragging
   */
  const handleDragStart = useCallback(
    (e: React.MouseEvent) => {
      const target = e.target;
      if (
        target instanceof Element &&
        target.closest('button, [role="button"], a, input, textarea, select')
      ) {
        return;
      }

      e.stopPropagation();

      // Don't modify selection during Ctrl/Cmd+click - let the click handler deal with it
      if (e.ctrlKey || e.metaKey) {
        return;
      }

      // Check if this track is in current selection
      const currentSelectedIds = selectedTrackIdsRef.current;
      const isInSelection = currentSelectedIds.includes(track.id);

      // If not in selection, select it
      if (!isInSelection) {
        selectTracks([track.id]);
      }

      // Determine which tracks to drag
      const tracksToDrag = isInSelection ? currentSelectedIds : [track.id];
      const allTracks = tracksRef.current;

      // Store initial state for all dragged tracks
      const draggedTracks = tracksToDrag
        .map((id) => {
          const trackIndex = allTracks.findIndex((t) => t.id === id);
          if (trackIndex === -1) return null;
          return {
            id,
            initialIndex: trackIndex,
          };
        })
        .filter((t) => t !== null) as Array<{
        id: string;
        initialIndex: number;
      }>;

      const trackIndex = allTracks.findIndex((t) => t.id === track.id);

      // Initialize drag state
      dragStateRef.current = {
        trackId: track.id,
        startTrackIndex: trackIndex,
        startMouseY: e.clientY,
        currentMouseY: e.clientY,
        draggedTracks,
      };

      // Attach a temporary mousemove listener to detect drag threshold
      const checkDragThreshold = (e: MouseEvent) => {
        if (!dragStateRef.current) return;

        const deltaY = e.clientY - dragStateRef.current.startMouseY;

        // Check if we've moved enough to start dragging
        if (Math.abs(deltaY) > DRAG_THRESHOLD_PIXELS) {
          // Start the drag
          setIsDragging(true);
          document.body.style.cursor = 'grabbing';
          document.body.style.userSelect = 'none';

          // Broadcast drag state
          const draggedIds = dragStateRef.current?.draggedTracks.map((t) => t.id) || [];
          setDragState({
            isDragging: true,
            draggedItemIds: [],
            draggedTrackIds: draggedIds,
            offset: { x: 0, y: 0 },
          });

          // Remove this listener
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
    [track.id, selectTracks, setDragState]
  );

  /**
   * Handle mouse move and mouse up during drag
   */
  useEffect(() => {
    if (!dragStateRef.current || !isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!dragStateRef.current) return;

      const deltaY = e.clientY - dragStateRef.current.startMouseY;

      // Update drag offset for visual preview (anchor track)
      setDragOffset(deltaY);

      // Update shared ref for other tracks to read (no re-renders)
      trackDragOffsetRef.current = deltaY;

      // Calculate drop index for visual indicator based on cumulative track heights
      const allTracks = tracksRef.current;
      if (allTracks.length > 0 && dragStateRef.current) {
        // Calculate cumulative heights for each track boundary
        const cumulativeHeights: number[] = [0];
        for (let i = 0; i < allTracks.length; i++) {
          const track = allTracks[i];
          const lastHeight = cumulativeHeights[cumulativeHeights.length - 1];
          if (track && lastHeight !== undefined) {
            cumulativeHeights.push(lastHeight + track.height);
          }
        }

        // Calculate the current position of the dragged track's center
        const startIndex = dragStateRef.current.startTrackIndex;
        const startTrackTop = cumulativeHeights[startIndex];
        const draggedTrack = allTracks[startIndex];

        if (startTrackTop !== undefined && draggedTrack) {
          const currentCenterY = startTrackTop + draggedTrack.height / 2 + deltaY;

          // Find which gap the center is closest to
          let closestIndex = 0;
          let minDistance = Infinity;

          for (let i = 0; i <= allTracks.length; i++) {
            const gapY = cumulativeHeights[i];
            if (gapY !== undefined) {
              const distance = Math.abs(currentCenterY - gapY);

              if (distance < minDistance) {
                minDistance = distance;
                closestIndex = i;
              }
            }
          }

          setDropIndex(closestIndex);
          trackDropIndexRef.current = closestIndex;
        }
      }

      dragStateRef.current.currentMouseY = e.clientY;
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      // Cancel drag on Escape
      if (e.key === 'Escape' && isDragging) {
        setIsDragging(false);
        setDragOffset(0);
        setDropIndex(-1);
        setDragState(null);
        trackDragOffsetRef.current = 0;
        trackDropIndexRef.current = -1;
        dragStateRef.current = null;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    };

    const handleMouseUp = () => {
      if (!dragStateRef.current || !isDragging) return;

      const dragState = dragStateRef.current;
      const deltaY = dragState.currentMouseY - dragState.startMouseY;

      // Calculate new position
      const allTracks = tracksRef.current;

      // Guard against empty tracks array
      if (allTracks.length === 0) {
        setIsDragging(false);
        setDragOffset(0);
        setDropIndex(-1);
        setDragState(null);
        trackDragOffsetRef.current = 0;
        trackDropIndexRef.current = -1;
        dragStateRef.current = null;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        return;
      }

      // Calculate drop position using same logic as drop indicator
      let newIndex = dragState.startTrackIndex;

      // Calculate cumulative heights for each track boundary
      const cumulativeHeights: number[] = [0];
      for (let i = 0; i < allTracks.length; i++) {
        const track = allTracks[i];
        const lastHeight = cumulativeHeights[cumulativeHeights.length - 1];
        if (track && lastHeight !== undefined) {
          cumulativeHeights.push(lastHeight + track.height);
        }
      }

      // Calculate the current position of the dragged track's center
      const startIndex = dragState.startTrackIndex;
      const startTrackTop = cumulativeHeights[startIndex];
      const draggedTrack = allTracks[startIndex];

      if (startTrackTop !== undefined && draggedTrack) {
        const currentCenterY = startTrackTop + draggedTrack.height / 2 + deltaY;

        // Find which gap the center is closest to
        let closestIndex = 0;
        let minDistance = Infinity;

        for (let i = 0; i <= allTracks.length; i++) {
          const gapY = cumulativeHeights[i];
          if (gapY !== undefined) {
            const distance = Math.abs(currentCenterY - gapY);

            if (distance < minDistance) {
              minDistance = distance;
              closestIndex = i;
            }
          }
        }

        newIndex = closestIndex;
      }

      // Only reorder if position actually changed
      if (newIndex !== dragState.startTrackIndex) {
        // Get IDs of tracks being dragged
        const draggedIds = dragState.draggedTracks.map((t) => t.id);

        // Create new track order
        // Remove dragged tracks from current positions
        const nonDraggedTracks = allTracks.filter((t) => !draggedIds.includes(t.id));

        // Get dragged tracks in their original order (filter out any that no longer exist)
        const draggedTracksData = draggedIds
          .map((id) => allTracks.find((t) => t.id === id))
          .filter((track): track is TimelineTrack => track !== undefined);

        // Validate we still have tracks to move
        if (draggedTracksData.length === 0) {
          setIsDragging(false);
          setDragOffset(0);
          setDropIndex(-1);
          setDragState(null);
          trackDragOffsetRef.current = 0;
          trackDropIndexRef.current = -1;
          dragStateRef.current = null;
          document.body.style.cursor = '';
          document.body.style.userSelect = '';
          return;
        }

        // Calculate correct insert index in the non-dragged array
        // newIndex represents a gap (0 = before first, 1 = after first, etc.)
        // We need to adjust for dragged tracks that have been removed
        let insertIndex = newIndex;

        // Count how many dragged tracks are before the target gap
        for (let i = 0; i < newIndex && i < allTracks.length; i++) {
          const track = allTracks[i];
          if (track && draggedIds.includes(track.id)) {
            insertIndex--;
          }
        }

        // Clamp to valid range
        insertIndex = Math.max(0, Math.min(insertIndex, nonDraggedTracks.length));

        const reorderedTracks = [
          ...nonDraggedTracks.slice(0, insertIndex),
          ...draggedTracksData,
          ...nonDraggedTracks.slice(insertIndex),
        ];

        // Update order property for all tracks
        const tracksWithOrder = reorderedTracks.map((t, index) => ({
          ...t,
          order: index,
        }));

        // Apply reorder (this creates an undo snapshot via Zundo)
        setTracksRef.current(tracksWithOrder);
      }

      // Clean up
      setIsDragging(false);
      setDragOffset(0);
      setDropIndex(-1);
      setDragState(null);
      trackDragOffsetRef.current = 0;
      trackDropIndexRef.current = -1;
      dragStateRef.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    if (dragStateRef.current) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      window.addEventListener('keydown', handleKeyDown);

      return () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
        window.removeEventListener('keydown', handleKeyDown);
      };
    }
  }, [isDragging, setDragState]);

  return {
    isDragging,
    dragOffset,
    dropIndex,
    handleDragStart,
  };
}
