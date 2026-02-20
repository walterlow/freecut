import { useState, useCallback, useRef, useEffect } from 'react';
import type { TimelineItem } from '@/types/timeline';
import type { SnapTarget } from '../types/drag';
import { useTimelineStore } from '../stores/timeline-store';
import { useSelectionStore } from '@/features/editor/stores/selection-store';
import { useTimelineZoom } from './use-timeline-zoom';
import { useSnapCalculator } from './use-snap-calculator';
import { clampTrimAmount, clampToAdjacentItems, type TrimHandle } from '../utils/trim-utils';

interface TrimState {
  isTrimming: boolean;
  handle: TrimHandle | null;
  startX: number;
  initialFrom: number;
  initialDuration: number;
  currentDelta: number; // Track current delta for visual feedback
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
  });

  const trimStateRef = useRef(trimState);
  trimStateRef.current = trimState;

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

      // Clamp to adjacent items on the same track
      const allItems = useTimelineStore.getState().items;
      deltaFrames = clampToAdjacentItems(currentItem, handle!, deltaFrames, allItems);

      // Update local state for visual feedback
      if (deltaFrames !== trimStateRef.current.currentDelta) {
        setTrimState(prev => ({ ...prev, currentDelta: deltaFrames }));
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

      // Only update store if there was actual change
      if (deltaFrames !== 0) {
        if (trimStateRef.current.handle === 'start') {
          trimItemStart(item.id, deltaFrames);
        } else if (trimStateRef.current.handle === 'end') {
          trimItemEnd(item.id, deltaFrames);
        }
      }

      // Clear drag state (including snap indicator)
      setDragState(null);
      prevSnapTargetRef.current = null;

      setTrimState({
        isTrimming: false,
        handle: null,
        startX: 0,
        initialFrom: 0,
        initialDuration: 0,
        currentDelta: 0,
      });
    }
  }, [item.id, trimItemStart, trimItemEnd, setDragState]);

  // Setup and cleanup mouse event listeners
  useEffect(() => {
    if (trimState.isTrimming) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);

      return () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
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
      });
    },
    [item.from, item.durationInFrames, trackLocked]
  );

  return {
    isTrimming: trimState.isTrimming,
    trimHandle: trimState.handle,
    trimDelta: trimState.currentDelta,
    handleTrimStart,
  };
}
