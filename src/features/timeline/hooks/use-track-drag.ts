import { useState, useEffect, useRef, useCallback } from 'react';
import type { TimelineTrack } from '@/types/timeline';
import { useTimelineStore } from '../stores/timeline-store';
import { useSelectionStore } from '@/shared/state/selection';
import { DRAG_THRESHOLD_PIXELS } from '../constants';
import { getVisibleTracks } from '../utils/group-utils';

/**
 * Determine the parent group for a gap between visible tracks.
 * At group boundaries (tracks above/below have different parents),
 * uses cursor position to decide: above the gap line → stay in the group,
 * below → use the other side's context.
 */
function resolveGapParent(
  visibleTracks: TimelineTrack[],
  cumulativeHeights: number[],
  gapIndex: number,
  cursorCenterY: number
): string | undefined {
  if (gapIndex <= 0) return undefined; // Before first track → top-level

  const trackAbove = visibleTracks[gapIndex - 1];
  const trackBelow = gapIndex < visibleTracks.length ? visibleTracks[gapIndex] : undefined;

  const aboveCtx = trackAbove?.isGroup ? trackAbove.id : trackAbove?.parentTrackId;
  const belowCtx = trackBelow?.parentTrackId;

  // Same context on both sides (or no track below) → use it
  if (aboveCtx === belowCtx) return aboveCtx;
  if (!trackBelow) return aboveCtx;

  // Different contexts → boundary. Use cursor position to pick a side.
  const gapY = cumulativeHeights[gapIndex];
  if (gapY !== undefined && cursorCenterY < gapY) {
    return aboveCtx; // Cursor above gap → stay with above's group
  }
  return belowCtx; // Cursor at/below gap → use below's context
}

// Shared ref for drag offset (avoids re-renders from store updates)
export const trackDragOffsetRef = { current: 0 };

// Flag to suppress the click event that fires after a drag drop
export const trackDragJustDroppedRef = { current: false };

// Shared ref for drop index indicator (gap between visible tracks)
export const trackDropIndexRef = { current: -1 };

// Shared ref for drop-on-group target (group track ID, empty if not targeting a group)
export const trackDropGroupIdRef = { current: '' };

// Shared ref for the parent group implied by the current gap position (empty = top-level)
export const trackDropParentIdRef = { current: '' };

interface DragState {
  trackId: string; // Anchor track
  startMouseY: number;
  currentMouseY: number;
  draggedTracks: Array<{
    id: string;
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
 * Supports multi-track selection and drag, group drop targets, and parent context.
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

      // Don't modify selection during Ctrl/Cmd+click or Shift+click - let the click handler deal with it
      if (e.ctrlKey || e.metaKey || e.shiftKey) {
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
      let tracksToDrag = isInSelection ? [...currentSelectedIds] : [track.id];
      const allTracks = tracksRef.current;

      // If dragging a group, include its children in the drag set
      const additionalIds: string[] = [];
      for (const id of tracksToDrag) {
        const t = allTracks.find((tr) => tr.id === id);
        if (t?.isGroup) {
          for (const child of allTracks) {
            if (child.parentTrackId === id && !tracksToDrag.includes(child.id)) {
              additionalIds.push(child.id);
            }
          }
        }
      }
      if (additionalIds.length > 0) {
        tracksToDrag = [...new Set([...tracksToDrag, ...additionalIds])];
      }

      // Store initial state for all dragged tracks
      const draggedTracks = tracksToDrag
        .map((id) => {
          const trackIndex = allTracks.findIndex((t) => t.id === id);
          if (trackIndex === -1) return null;
          return { id };
        })
        .filter((t) => t !== null) as Array<{ id: string }>;

      // Initialize drag state
      dragStateRef.current = {
        trackId: track.id,
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

    const cleanup = () => {
      setIsDragging(false);
      setDragOffset(0);
      setDropIndex(-1);
      setDragState(null);
      trackDragOffsetRef.current = 0;
      trackDropIndexRef.current = -1;
      trackDropGroupIdRef.current = '';
      trackDropParentIdRef.current = '';
      dragStateRef.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!dragStateRef.current) return;

      const deltaY = e.clientY - dragStateRef.current.startMouseY;

      // Update drag offset for visual preview (anchor track)
      setDragOffset(deltaY);

      // Update shared ref for other tracks to read (no re-renders)
      trackDragOffsetRef.current = deltaY;

      // Use visible tracks for position calculation (matches what the user sees)
      const allTracks = tracksRef.current;
      const visibleTracks = getVisibleTracks(allTracks);

      if (visibleTracks.length > 0 && dragStateRef.current) {
        const draggedIdsSet = new Set(dragStateRef.current.draggedTracks.map((t) => t.id));

        // Check if any dragged track is a group (can't drop groups into other groups)
        const hasDraggedGroup = dragStateRef.current.draggedTracks.some((dt) => {
          const t = allTracks.find((tr) => tr.id === dt.id);
          return t?.isGroup;
        });

        // Calculate cumulative heights for each visible track boundary
        const cumulativeHeights: number[] = [0];
        for (let i = 0; i < visibleTracks.length; i++) {
          const vt = visibleTracks[i];
          const lastHeight = cumulativeHeights[cumulativeHeights.length - 1];
          if (vt && lastHeight !== undefined) {
            cumulativeHeights.push(lastHeight + vt.height);
          }
        }

        // Find the dragged track's position in visible tracks
        const startVisibleIndex = visibleTracks.findIndex(
          (t) => t.id === dragStateRef.current!.trackId
        );

        if (startVisibleIndex !== -1) {
          const startTrackTop = cumulativeHeights[startVisibleIndex];
          const draggedTrack = visibleTracks[startVisibleIndex];

          if (startTrackTop !== undefined && draggedTrack) {
            const currentCenterY = startTrackTop + draggedTrack.height / 2 + deltaY;

            // Check if cursor center is over the middle zone of a group track.
            // Only the inner 50% counts as "drop onto group" — the outer edges
            // fall through to gap detection so users can reorder above/below.
            let dropGroupId = '';
            if (!hasDraggedGroup) {
              for (let i = 0; i < visibleTracks.length; i++) {
                const vt = visibleTracks[i];
                const trackTop = cumulativeHeights[i];
                const trackBottom = cumulativeHeights[i + 1];
                if (
                  vt?.isGroup &&
                  !draggedIdsSet.has(vt.id) &&
                  trackTop !== undefined &&
                  trackBottom !== undefined
                ) {
                  const inset = (trackBottom - trackTop) * 0.25;
                  if (currentCenterY >= trackTop + inset && currentCenterY < trackBottom - inset) {
                    dropGroupId = vt.id;
                    break;
                  }
                }
              }
            }

            trackDropGroupIdRef.current = dropGroupId;

            if (dropGroupId) {
              // Over a group → suppress gap indicator
              setDropIndex(-1);
              trackDropIndexRef.current = -1;
              trackDropParentIdRef.current = '';
            } else {
              // Find which gap the center is closest to
              let closestIndex = 0;
              let minDistance = Infinity;

              for (let i = 0; i <= visibleTracks.length; i++) {
                const gapY = cumulativeHeights[i];
                if (gapY !== undefined) {
                  const distance = Math.abs(currentCenterY - gapY);
                  if (distance < minDistance) {
                    minDistance = distance;
                    closestIndex = i;
                  }
                }
              }

              // Determine parent context for this gap (matches handleMouseUp logic)
              const gapParentId = resolveGapParent(
                visibleTracks, cumulativeHeights, closestIndex, currentCenterY
              );

              setDropIndex(closestIndex);
              trackDropIndexRef.current = closestIndex;
              trackDropParentIdRef.current = gapParentId ?? '';
            }
          }
        }
      }

      dragStateRef.current.currentMouseY = e.clientY;
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      // Cancel drag on Escape
      if (e.key === 'Escape' && isDragging) {
        cleanup();
      }
    };

    const handleMouseUp = () => {
      if (!dragStateRef.current || !isDragging) return;

      const dragState = dragStateRef.current;
      const deltaY = dragState.currentMouseY - dragState.startMouseY;
      const allTracks = tracksRef.current;
      const visibleTracks = getVisibleTracks(allTracks);

      // Guard against empty tracks array
      if (allTracks.length === 0 || visibleTracks.length === 0) {
        cleanup();
        return;
      }

      const draggedIds = dragState.draggedTracks.map((t) => t.id);
      const draggedIdsSet = new Set(draggedIds);
      const dropGroupId = trackDropGroupIdRef.current;

      if (dropGroupId) {
        // --- Drop onto a group track: reparent and place after group's last child ---
        const nonDraggedTracks = allTracks.filter((t) => !draggedIdsSet.has(t.id));
        const draggedTracksData = draggedIds
          .map((id) => allTracks.find((t) => t.id === id))
          .filter((t): t is TimelineTrack => t !== undefined)
          .map((t) => {
            // Keep children of a dragged group with their parent
            if (t.parentTrackId && draggedIdsSet.has(t.parentTrackId)) return t;
            return { ...t, parentTrackId: dropGroupId };
          });

        if (draggedTracksData.length > 0) {
          // Find insert position: after group header + all existing children
          let insertIndex = nonDraggedTracks.findIndex((t) => t.id === dropGroupId);
          if (insertIndex !== -1) {
            insertIndex++; // After the group header
            while (
              insertIndex < nonDraggedTracks.length &&
              nonDraggedTracks[insertIndex]?.parentTrackId === dropGroupId
            ) {
              insertIndex++;
            }
          } else {
            insertIndex = nonDraggedTracks.length;
          }

          const reorderedTracks = [
            ...nonDraggedTracks.slice(0, insertIndex),
            ...draggedTracksData,
            ...nonDraggedTracks.slice(insertIndex),
          ];
          setTracksRef.current(reorderedTracks.map((t, i) => ({ ...t, order: i })));
        }
      } else {
        // --- Gap drop: reorder with parent context ---

        // Calculate cumulative heights for visible tracks
        const cumulativeHeights: number[] = [0];
        for (let i = 0; i < visibleTracks.length; i++) {
          const vt = visibleTracks[i];
          const lastHeight = cumulativeHeights[cumulativeHeights.length - 1];
          if (vt && lastHeight !== undefined) {
            cumulativeHeights.push(lastHeight + vt.height);
          }
        }

        // Find dragged track position in visible tracks
        const startVisibleIndex = visibleTracks.findIndex((t) => t.id === dragState.trackId);
        if (startVisibleIndex === -1) {
          cleanup();
          return;
        }

        const startTrackTop = cumulativeHeights[startVisibleIndex];
        const draggedTrack = visibleTracks[startVisibleIndex];
        let newVisibleIndex = startVisibleIndex;

        if (startTrackTop !== undefined && draggedTrack) {
          const currentCenterY = startTrackTop + draggedTrack.height / 2 + deltaY;

          // Find which gap the center is closest to
          let closestIndex = 0;
          let minDistance = Infinity;
          for (let i = 0; i <= visibleTracks.length; i++) {
            const gapY = cumulativeHeights[i];
            if (gapY !== undefined) {
              const distance = Math.abs(currentCenterY - gapY);
              if (distance < minDistance) {
                minDistance = distance;
                closestIndex = i;
              }
            }
          }
          newVisibleIndex = closestIndex;
        }

        // Determine parent context from neighboring visible tracks at the gap
        // Recalculate currentCenterY for handleMouseUp
        const muStartTop = cumulativeHeights[startVisibleIndex];
        const muDraggedTrack = visibleTracks[startVisibleIndex];
        const muCenterY = (muStartTop !== undefined && muDraggedTrack)
          ? muStartTop + muDraggedTrack.height / 2 + deltaY
          : 0;
        const newParentTrackId = resolveGapParent(
          visibleTracks, cumulativeHeights, newVisibleIndex, muCenterY
        );

        // Map visible gap index → full array insert position
        let fullInsertBeforeId: string | undefined;
        if (newVisibleIndex < visibleTracks.length) {
          fullInsertBeforeId = visibleTracks[newVisibleIndex]?.id;
        }

        let fullIndex: number;
        if (fullInsertBeforeId) {
          fullIndex = allTracks.findIndex((t) => t.id === fullInsertBeforeId);
          if (fullIndex === -1) fullIndex = allTracks.length;
        } else {
          fullIndex = allTracks.length;
        }

        // Build reordered track list with updated parentTrackId
        const nonDraggedTracks = allTracks.filter((t) => !draggedIdsSet.has(t.id));
        const draggedTracksData = draggedIds
          .map((id) => allTracks.find((t) => t.id === id))
          .filter((t): t is TimelineTrack => t !== undefined)
          .map((t) => {
            // Don't reparent group tracks (nesting depth capped at 1)
            if (t.isGroup) return t;
            // Keep children of a dragged group with their parent
            if (t.parentTrackId && draggedIdsSet.has(t.parentTrackId)) return t;
            return { ...t, parentTrackId: newParentTrackId };
          });

        if (draggedTracksData.length > 0) {
          // Calculate insert index in non-dragged array (adjust for removed tracks)
          let insertIndex = fullIndex;
          for (let i = 0; i < fullIndex && i < allTracks.length; i++) {
            const t = allTracks[i];
            if (t && draggedIdsSet.has(t.id)) {
              insertIndex--;
            }
          }
          insertIndex = Math.max(0, Math.min(insertIndex, nonDraggedTracks.length));

          const reorderedTracks = [
            ...nonDraggedTracks.slice(0, insertIndex),
            ...draggedTracksData,
            ...nonDraggedTracks.slice(insertIndex),
          ];

          // Update order property for all tracks
          setTracksRef.current(reorderedTracks.map((t, i) => ({ ...t, order: i })));
        }
      }

      // Suppress the click event that fires after mouseup to retain selection
      trackDragJustDroppedRef.current = true;
      requestAnimationFrame(() => { trackDragJustDroppedRef.current = false; });

      // Clean up
      cleanup();
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
