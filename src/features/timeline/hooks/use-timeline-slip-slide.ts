import { useState, useCallback, useRef, useEffect } from 'react';
import type { TimelineItem } from '@/types/timeline';
import { useTimelineStore } from '../stores/timeline-store';
import { useTransitionsStore } from '../stores/transitions-store';
import { useSelectionStore } from '@/features/editor/stores/selection-store';
import { useTimelineZoom } from './use-timeline-zoom';
import { useSnapCalculator } from './use-snap-calculator';
import { useSlipEditPreviewStore } from '../stores/slip-edit-preview-store';
import { useSlideEditPreviewStore } from '../stores/slide-edit-preview-store';
import { slipItem, slideItem } from '../stores/actions/item-actions';
import {
  getSourceProperties,
  isMediaItem,
  timelineToSourceFrames,
} from '../utils/source-calculations';
import { clampTrimAmount } from '../utils/trim-utils';
import { findEditNeighborsWithTransitions } from '../utils/transition-linked-neighbors';
import { computeClampedSlipDelta } from '../utils/slip-utils';

interface SlipSlideState {
  isActive: boolean;
  mode: 'slip' | 'slide' | null;
  startX: number;
  currentDelta: number;
  leftNeighborId: string | null;
  rightNeighborId: string | null;
}

/**
 * Hook for handling slip and slide editing on timeline items.
 *
 * Slip: shifts source content within a fixed clip window.
 * Slide: moves clip on timeline, adjusting adjacent neighbors.
 *
 * Only operates on video/audio items.
 */
export function useTimelineSlipSlide(
  item: TimelineItem,
  timelineDuration: number,
  trackLocked: boolean = false,
) {
  const { pixelsToTime } = useTimelineZoom();
  const fps = useTimelineStore((s) => s.fps);
  const setDragState = useSelectionStore((s) => s.setDragState);

  const { getMagneticSnapTargets, snapThresholdFrames, snapEnabled } = useSnapCalculator(
    timelineDuration,
    item.id,
  );

  const [state, setState] = useState<SlipSlideState>({
    isActive: false,
    mode: null,
    startX: 0,
    currentDelta: 0,
    leftNeighborId: null,
    rightNeighborId: null,
  });

  const stateRef = useRef(state);
  stateRef.current = state;
  const latestDeltaRef = useRef(0);

  const getItemFromStore = useCallback(() => {
    return useTimelineStore.getState().items.find((i) => i.id === item.id) ?? item;
  }, [item.id]);

  /**
   * Find immediate edit neighbors on the same track.
   * Prefers strict adjacency, falls back to transition-linked neighbors.
   */
  const findNeighbors = useCallback(() => {
    const allItems = useTimelineStore.getState().items;
    const currentItem = getItemFromStore();
    const transitions = useTransitionsStore.getState().transitions;
    return findEditNeighborsWithTransitions(currentItem, allItems, transitions);
  }, [getItemFromStore]);

  /**
   * Clamp slip delta to source boundaries.
   * slipDelta is in source-native frames.
   */
  const clampSlipDelta = useCallback((delta: number): number => {
    const currentItem = getItemFromStore();
    if (!isMediaItem(currentItem)) return 0;

    const { sourceStart, sourceEnd, sourceDuration } = getSourceProperties(currentItem);
    return computeClampedSlipDelta(sourceStart, sourceEnd, sourceDuration, delta);
  }, [getItemFromStore]);

  /**
   * Clamp slide delta to neighbor source boundaries and timeline start.
   */
  const clampSlideDelta = useCallback((delta: number, leftNeighborId: string | null, rightNeighborId: string | null): number => {
    const currentItem = getItemFromStore();
    let clamped = delta;

    // Can't slide past timeline start
    if (currentItem.from + clamped < 0) {
      clamped = -currentItem.from;
    }

    const allItems = useTimelineStore.getState().items;

    // Left neighbor: clamp by how much its end can extend/shrink
    if (leftNeighborId) {
      const leftNeighbor = allItems.find((i) => i.id === leftNeighborId);
      if (leftNeighbor) {
        const { clampedAmount } = clampTrimAmount(leftNeighbor, 'end', clamped, fps);
        if (Math.abs(clampedAmount) < Math.abs(clamped)) {
          clamped = clampedAmount;
        }
      }
    }

    // Right neighbor: clamp by how much its start can extend/shrink
    if (rightNeighborId) {
      const rightNeighbor = allItems.find((i) => i.id === rightNeighborId);
      if (rightNeighbor) {
        const { clampedAmount } = clampTrimAmount(rightNeighbor, 'start', clamped, fps);
        if (Math.abs(clampedAmount) < Math.abs(clamped)) {
          clamped = clampedAmount;
        }
      }
    }

    return clamped;
  }, [getItemFromStore, fps]);

  // Mouse move handler
  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!stateRef.current.isActive || trackLocked) return;

      const deltaX = e.clientX - stateRef.current.startX;
      const deltaTime = pixelsToTime(deltaX);
      let deltaFrames = Math.round(deltaTime * fps);
      const mode = stateRef.current.mode;

      if (mode === 'slip') {
        // Convert timeline frame delta to source frame delta
        const currentItem = getItemFromStore();
        const { speed, sourceFps } = getSourceProperties(currentItem);
        const effectiveSourceFps = sourceFps ?? fps;
        const sourceFramesDelta = timelineToSourceFrames(deltaFrames, speed, fps, effectiveSourceFps);

        const clamped = clampSlipDelta(sourceFramesDelta);

        // Update preview store
        const previewStore = useSlipEditPreviewStore.getState();
        if (
          previewStore.itemId !== item.id
          || previewStore.trackId !== currentItem.trackId
        ) {
          previewStore.setPreview({
            itemId: item.id,
            trackId: currentItem.trackId,
            slipDelta: clamped,
          });
        } else if (previewStore.slipDelta !== clamped) {
          previewStore.setSlipDelta(clamped);
        }

        if (clamped !== latestDeltaRef.current) {
          latestDeltaRef.current = clamped;
          setState((prev) => ({ ...prev, currentDelta: clamped }));
        }
      } else if (mode === 'slide') {
        const { leftNeighborId, rightNeighborId } = stateRef.current;
        const storeItem = getItemFromStore();

        // Apply snapping for slide (clip edges snap to items/playhead/grid)
        if (snapEnabled) {
          const targets = getMagneticSnapTargets();
          const excludeIds = new Set<string>([item.id]);
          if (leftNeighborId) excludeIds.add(leftNeighborId);
          if (rightNeighborId) excludeIds.add(rightNeighborId);

          const newStart = storeItem.from + deltaFrames;
          const newEnd = newStart + storeItem.durationInFrames;

          let bestSnap: { frame: number; offset: number } | null = null;

          for (const target of targets) {
            if (target.itemId && excludeIds.has(target.itemId)) continue;

            // Snap start edge
            const startDist = Math.abs(newStart - target.frame);
            if (startDist < snapThresholdFrames) {
              if (!bestSnap || startDist < Math.abs(bestSnap.offset)) {
                bestSnap = { frame: target.frame, offset: target.frame - newStart };
              }
            }

            // Snap end edge
            const endDist = Math.abs(newEnd - target.frame);
            if (endDist < snapThresholdFrames) {
              if (!bestSnap || endDist < Math.abs(bestSnap.offset)) {
                bestSnap = { frame: target.frame, offset: target.frame - newEnd };
              }
            }
          }

          if (bestSnap) {
            deltaFrames += bestSnap.offset;
          }
        }

        const clamped = clampSlideDelta(deltaFrames, leftNeighborId, rightNeighborId);

        // Update preview store
        const previewStore = useSlideEditPreviewStore.getState();
        if (
          previewStore.itemId !== item.id
          || previewStore.trackId !== storeItem.trackId
          || previewStore.leftNeighborId !== leftNeighborId
          || previewStore.rightNeighborId !== rightNeighborId
        ) {
          previewStore.setPreview({
            itemId: item.id,
            trackId: storeItem.trackId,
            leftNeighborId,
            rightNeighborId,
            slideDelta: clamped,
          });
        } else if (previewStore.slideDelta !== clamped) {
          previewStore.setSlideDelta(clamped);
        }

        if (clamped !== latestDeltaRef.current) {
          latestDeltaRef.current = clamped;
          setState((prev) => ({ ...prev, currentDelta: clamped }));
        }
      }
    },
    [pixelsToTime, fps, trackLocked, item.id, getItemFromStore, clampSlipDelta, clampSlideDelta, snapEnabled, getMagneticSnapTargets, snapThresholdFrames],
  );

  // Mouse up handler — commits changes
  const handleMouseUp = useCallback(() => {
    if (!stateRef.current.isActive) return;

    const { mode, leftNeighborId, rightNeighborId } = stateRef.current;
    const currentDelta = latestDeltaRef.current;

    try {
      if (currentDelta !== 0) {
        if (mode === 'slip') {
          slipItem(item.id, currentDelta);
        } else if (mode === 'slide') {
          slideItem(item.id, currentDelta, leftNeighborId, rightNeighborId);
        }
      }
    } finally {
      // Clear preview stores
      useSlipEditPreviewStore.getState().clearPreview();
      useSlideEditPreviewStore.getState().clearPreview();

      // Clear drag state
      setDragState(null);

      setState({
        isActive: false,
        mode: null,
        startX: 0,
        currentDelta: 0,
        leftNeighborId: null,
        rightNeighborId: null,
      });
      latestDeltaRef.current = 0;
    }
  }, [item.id, setDragState]);

  // Setup/cleanup mouse event listeners
  useEffect(() => {
    if (state.isActive) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);

      return () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
        // If unmounting mid-drag, clear preview and drag state
        if (stateRef.current.isActive) {
          useSlipEditPreviewStore.getState().clearPreview();
          useSlideEditPreviewStore.getState().clearPreview();
          setDragState(null);
          latestDeltaRef.current = 0;
        }
      };
    }
  }, [state.isActive, handleMouseMove, handleMouseUp, setDragState]);

  // Start slip/slide drag
  const handleSlipSlideStart = useCallback(
    (e: React.MouseEvent, mode: 'slip' | 'slide') => {
      if (e.button !== 0) return;
      if (trackLocked) return;
      if (item.type !== 'video' && item.type !== 'audio') return;

      e.stopPropagation();
      e.preventDefault();

      const { leftNeighbor, rightNeighbor } = findNeighbors();

      // Signal drag start so other components can detect active drag
      setDragState({
        isDragging: true,
        draggedItemIds: [item.id],
        offset: { x: 0, y: 0 },
      });

      setState({
        isActive: true,
        mode,
        startX: e.clientX,
        currentDelta: 0,
        leftNeighborId: leftNeighbor?.id ?? null,
        rightNeighborId: rightNeighbor?.id ?? null,
      });
      latestDeltaRef.current = 0;
    },
    [item.id, item.type, trackLocked, findNeighbors, setDragState],
  );

  return {
    isSlipSlideActive: state.isActive,
    slipSlideMode: state.mode,
    slipSlideDelta: state.currentDelta,
    handleSlipSlideStart,
  };
}
