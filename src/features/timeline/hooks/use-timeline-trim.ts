import { useState, useCallback, useRef, useEffect } from 'react';
import type { TimelineItem } from '@/types/timeline';
import type { SnapTarget } from '../types/drag';
import { useTimelineStore } from '../stores/timeline-store';
import { useSelectionStore } from '@/features/editor/stores/selection-store';
import { useTimelineZoom } from './use-timeline-zoom';
import { useSnapCalculator } from './use-snap-calculator';
import { clampTrimAmount, clampToAdjacentItems, type TrimHandle } from '../utils/trim-utils';
import { useTransitionsStore } from '../stores/transitions-store';
import { useRollingEditPreviewStore } from '../stores/rolling-edit-preview-store';
import { rollingTrimItems } from '../stores/actions/item-actions';

interface TrimState {
  isTrimming: boolean;
  handle: TrimHandle | null;
  startX: number;
  initialFrom: number;
  initialDuration: number;
  currentDelta: number; // Track current delta for visual feedback
  isRollingEdit: boolean;
  neighborId: string | null;
}

/**
 * Hook for handling timeline item trimming
 *
 * Optimized approach:
 * - Visual feedback via local state during drag (no store updates)
 * - Only commit to store on mouseup (single undo entry)
 * - Smooth performance with RAF updates
 * - Snapping support for trim edges to grid and item boundaries
 * - Source boundary clamping for accurate visual feedback
 */
export function useTimelineTrim(item: TimelineItem, timelineDuration: number, trackLocked: boolean = false) {
  const { pixelsToTime } = useTimelineZoom();
  const fps = useTimelineStore((s) => s.fps);
  const trimItemStart = useTimelineStore((s) => s.trimItemStart);
  const trimItemEnd = useTimelineStore((s) => s.trimItemEnd);
  const setDragState = useSelectionStore((s) => s.setDragState);

  // Get fresh item from store to ensure we have latest values after previous trims
  const getItemFromStore = useCallback(() => {
    return useTimelineStore.getState().items.find((i) => i.id === item.id) ?? item;
  }, [item.id]);

  // Use snap calculator - pass item.id to exclude self from magnetic snaps
  // Only use magnetic snap targets (item edges), not grid lines
  const { magneticSnapTargets, snapThresholdFrames, snapEnabled } = useSnapCalculator(
    timelineDuration,
    item.id
  );

  const [trimState, setTrimState] = useState<TrimState>({
    isTrimming: false,
    handle: null,
    startX: 0,
    initialFrom: 0,
    initialDuration: 0,
    currentDelta: 0,
    isRollingEdit: false,
    neighborId: null,
  });

  const trimStateRef = useRef(trimState);
  trimStateRef.current = trimState;

  // Track Alt key state for rolling edit
  const altKeyRef = useRef(false);

  // Track previous snap target to avoid unnecessary store updates
  const prevSnapTargetRef = useRef<{ frame: number; type: string } | null>(null);

  /**
   * Find nearest snap target for a given frame position
   */
  const findSnapForFrame = useCallback(
    (targetFrame: number): { snappedFrame: number; snapTarget: SnapTarget | null } => {
      if (!snapEnabled || magneticSnapTargets.length === 0) {
        return { snappedFrame: targetFrame, snapTarget: null };
      }

      let nearestTarget: SnapTarget | null = null;
      let minDistance = snapThresholdFrames;

      for (const target of magneticSnapTargets) {
        const distance = Math.abs(targetFrame - target.frame);
        if (distance < minDistance) {
          nearestTarget = target;
          minDistance = distance;
        }
      }

      if (nearestTarget) {
        return { snappedFrame: nearestTarget.frame, snapTarget: nearestTarget };
      }

      return { snappedFrame: targetFrame, snapTarget: null };
    },
    [snapEnabled, magneticSnapTargets, snapThresholdFrames]
  );

  // Mouse move handler - only updates local state for visual feedback
  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!trimStateRef.current.isTrimming || trackLocked) return;

      const deltaX = e.clientX - trimStateRef.current.startX;
      const deltaTime = pixelsToTime(deltaX);
      let deltaFrames = Math.round(deltaTime * fps);

      const { handle, initialFrom, initialDuration } = trimStateRef.current;

      // Calculate the target edge position and apply snapping
      let targetEdgeFrame: number;
      if (handle === 'start') {
        // For start handle, we're moving the start position
        targetEdgeFrame = initialFrom + deltaFrames;
      } else {
        // For end handle, we're moving the end position
        targetEdgeFrame = initialFrom + initialDuration + deltaFrames;
      }

      // Find snap target for the edge being trimmed
      const { snappedFrame, snapTarget } = findSnapForFrame(targetEdgeFrame);

      // If snapped, adjust deltaFrames accordingly
      if (snapTarget) {
        if (handle === 'start') {
          deltaFrames = snappedFrame - initialFrom;
        } else {
          deltaFrames = snappedFrame - (initialFrom + initialDuration);
        }
      }

      // Apply source boundary clamping for media items
      // This ensures visual feedback matches what the store will actually commit
      // Use fresh item from store to ensure we have latest values after previous trims
      const currentItem = getItemFromStore();
      const { clampedAmount } = clampTrimAmount(currentItem, handle!, deltaFrames, fps);
      deltaFrames = clampedAmount;

      // Clamp to adjacent items on the same track (allow overlap with transition-linked clips)
      const allItems = useTimelineStore.getState().items;
      const transitions = useTransitionsStore.getState().transitions;
      const transitionLinkedIds = new Set<string>();
      for (const t of transitions) {
        if (t.leftClipId === currentItem.id) transitionLinkedIds.add(t.rightClipId);
        if (t.rightClipId === currentItem.id) transitionLinkedIds.add(t.leftClipId);
      }
      deltaFrames = clampToAdjacentItems(currentItem, handle!, deltaFrames, allItems, transitionLinkedIds);

      // Rolling edit: if Alt is held, find adjacent neighbor and clamp to both clips' limits
      const currentAlt = altKeyRef.current;
      let neighborId: string | null = null;

      if (currentAlt) {
        if (handle === 'end') {
          // Trimming end → neighbor is the clip immediately to the right
          const neighbor = allItems.find(
            (other) => other.id !== currentItem.id &&
              other.trackId === currentItem.trackId &&
              other.from === currentItem.from + currentItem.durationInFrames
          );
          if (neighbor) {
            neighborId = neighbor.id;
            // Neighbor's start is trimmed by the same delta (positive = shrink start)
            const { clampedAmount: neighborClamped } = clampTrimAmount(neighbor, 'start', deltaFrames, fps);
            // Use tighter constraint of both clips
            if (Math.abs(neighborClamped) < Math.abs(deltaFrames)) {
              deltaFrames = neighborClamped;
            }
          }
        } else {
          // Trimming start → neighbor is the clip immediately to the left
          const neighbor = allItems.find(
            (other) => other.id !== currentItem.id &&
              other.trackId === currentItem.trackId &&
              other.from + other.durationInFrames === currentItem.from
          );
          if (neighbor) {
            neighborId = neighbor.id;
            // For the left neighbor's end, pass deltaFrames directly to clampTrimAmount
            // delta > 0 (shrink this item's start, edit point moves right) → neighbor extends end (positive for trimEnd = extend)
            // delta < 0 (extend this item's start, edit point moves left) → neighbor shrinks end (negative for trimEnd = shrink)
            const { clampedAmount: neighborClamped } = clampTrimAmount(neighbor, 'end', deltaFrames, fps);
            if (Math.abs(neighborClamped) < Math.abs(deltaFrames)) {
              deltaFrames = neighborClamped;
            }
          }
        }
      }

      // Update rolling edit preview store
      if (neighborId) {
        const previewStore = useRollingEditPreviewStore.getState();
        if (!previewStore.trimmedItemId) {
          previewStore.setPreview({
            trimmedItemId: item.id,
            neighborItemId: neighborId,
            handle: handle!,
            neighborDelta: deltaFrames,
          });
        } else {
          previewStore.setNeighborDelta(deltaFrames);
        }
      } else {
        // Clear preview when Alt is released or no neighbor found
        const previewStore = useRollingEditPreviewStore.getState();
        if (previewStore.trimmedItemId) {
          previewStore.clearPreview();
        }
      }

      // Update local state for visual feedback
      const isRolling = currentAlt && neighborId !== null;
      if (deltaFrames !== trimStateRef.current.currentDelta ||
          isRolling !== trimStateRef.current.isRollingEdit ||
          neighborId !== trimStateRef.current.neighborId) {
        setTrimState(prev => ({
          ...prev,
          currentDelta: deltaFrames,
          isRollingEdit: isRolling,
          neighborId: neighborId,
        }));
      }

      // Update snap target visualization (only when changed)
      const prevSnap = prevSnapTargetRef.current;
      const snapChanged =
        (prevSnap === null && snapTarget !== null) ||
        (prevSnap !== null && snapTarget === null) ||
        (prevSnap !== null && snapTarget !== null && (prevSnap.frame !== snapTarget.frame || prevSnap.type !== snapTarget.type));

      if (snapChanged) {
        prevSnapTargetRef.current = snapTarget ? { frame: snapTarget.frame, type: snapTarget.type } : null;
        setDragState({
          isDragging: true,
          draggedItemIds: [item.id],
          offset: { x: deltaX, y: 0 },
          activeSnapTarget: snapTarget,
        });
      }
    },
    [pixelsToTime, fps, trackLocked, findSnapForFrame, setDragState, item.id, getItemFromStore]
  );

  // Mouse up handler - commits changes to store (single update)
  const handleMouseUp = useCallback(() => {
    if (trimStateRef.current.isTrimming) {
      const deltaFrames = trimStateRef.current.currentDelta;
      const state = trimStateRef.current;

      // Only update store if there was actual change
      if (deltaFrames !== 0) {
        if (state.isRollingEdit && state.neighborId) {
          // Rolling edit: determine left/right clip IDs and edit point delta
          if (state.handle === 'end') {
            // Trimming end handle: this item is the left clip
            rollingTrimItems(item.id, state.neighborId, deltaFrames);
          } else {
            // Trimming start handle: this item is the right clip, neighbor is left
            // rollingTrimItems convention: positive delta = edit point moves right
            rollingTrimItems(state.neighborId, item.id, deltaFrames);
          }
        } else {
          // Normal trim
          if (state.handle === 'start') {
            trimItemStart(item.id, deltaFrames);
          } else if (state.handle === 'end') {
            trimItemEnd(item.id, deltaFrames);
          }
        }
      }

      // Clear rolling edit preview
      useRollingEditPreviewStore.getState().clearPreview();

      // Clear drag state (including snap indicator)
      setDragState(null);
      prevSnapTargetRef.current = null;

      // Reset Alt key ref
      altKeyRef.current = false;

      setTrimState({
        isTrimming: false,
        handle: null,
        startX: 0,
        initialFrom: 0,
        initialDuration: 0,
        currentDelta: 0,
        isRollingEdit: false,
        neighborId: null,
      });
    }
  }, [item.id, trimItemStart, trimItemEnd, setDragState]);

  // Setup and cleanup mouse event listeners
  useEffect(() => {
    if (trimState.isTrimming) {
      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Alt') {
          e.preventDefault(); // Prevent browser menu activation on Windows
          altKeyRef.current = true;
        }
      };
      const handleKeyUp = (e: KeyboardEvent) => {
        if (e.key === 'Alt') altKeyRef.current = false;
      };

      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      window.addEventListener('keydown', handleKeyDown);
      window.addEventListener('keyup', handleKeyUp);

      return () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
        window.removeEventListener('keydown', handleKeyDown);
        window.removeEventListener('keyup', handleKeyUp);
      };
    }
  }, [trimState.isTrimming, handleMouseMove, handleMouseUp]);

  // Start trim drag
  const handleTrimStart = useCallback(
    (e: React.MouseEvent, handle: TrimHandle) => {
      // Only respond to left mouse button
      if (e.button !== 0) return;
      if (trackLocked) return;

      e.stopPropagation();
      e.preventDefault();

      setTrimState({
        isTrimming: true,
        handle,
        startX: e.clientX,
        initialFrom: item.from,
        initialDuration: item.durationInFrames,
        currentDelta: 0,
        isRollingEdit: false,
        neighborId: null,
      });
    },
    [item.from, item.durationInFrames, trackLocked]
  );

  return {
    isTrimming: trimState.isTrimming,
    trimHandle: trimState.handle,
    trimDelta: trimState.currentDelta,
    isRollingEdit: trimState.isRollingEdit,
    handleTrimStart,
  };
}
