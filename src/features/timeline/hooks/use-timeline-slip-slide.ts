import { useState, useCallback, useRef, useEffect } from 'react';
import type { TimelineItem } from '@/types/timeline';
import { usePlaybackStore } from '@/shared/state/playback';
import { useEditorStore } from '@/app/state/editor';
import { DRAG_THRESHOLD_PIXELS } from '../constants';
import { useTimelineStore } from '../stores/timeline-store';
import { useTransitionsStore } from '../stores/transitions-store';
import { useSelectionStore } from '@/shared/state/selection';
import { pixelsToTimeNow } from '../utils/zoom-conversions';
import { useSnapCalculator } from './use-snap-calculator';
import { useSlipEditPreviewStore } from '../stores/slip-edit-preview-store';
import { useSlideEditPreviewStore } from '../stores/slide-edit-preview-store';
import { useLinkedEditPreviewStore } from '../stores/linked-edit-preview-store';
import { slipItem, slideItem } from '../stores/actions/item-actions';
import {
  getSourceProperties,
  isMediaItem,
  timelineToSourceFrames,
} from '../utils/source-calculations';
import { clampTrimAmount, clampToAdjacentItems } from '../utils/trim-utils';
import { findEditNeighborsWithTransitions, findNearestNeighbors } from '../utils/transition-linked-neighbors';
import { computeClampedSlipDelta } from '../utils/slip-utils';
import {
  getMatchingSynchronizedLinkedCounterpart,
  getSynchronizedLinkedItems,
} from '../utils/linked-items';
import { clampSlipDeltaToPreserveTransitions, clampSlideDeltaToPreserveTransitions } from '../utils/transition-utils';
import {
  applyMovePreview,
  applySlipPreview,
  applyTrimEndPreview,
  applyTrimStartPreview,
  type PreviewItemUpdate,
} from '../utils/item-edit-preview';
import { hasExceededDragThreshold } from '../utils/drag-threshold';

interface SlipSlideState {
  isActive: boolean;
  mode: 'slip' | 'slide' | null;
  startX: number;
  currentDelta: number;
  leftNeighborId: string | null;
  rightNeighborId: string | null;
  isConstrained: boolean;
  constraintEdge: 'start' | 'end' | null;
  constraintLabel: string | null;
}

interface SlipSlideStartOptions {
  activateOnMoveThreshold?: boolean;
}

/**
 * Hook for handling slip and slide editing on timeline items.
 *
 * Slip: shifts source content within a fixed clip window.
 * Slide: moves clip on timeline, adjusting adjacent neighbors.
 *
 * Only operates on source-bounded items (video/audio/compound wrappers).
 */
export function useTimelineSlipSlide(
  item: TimelineItem,
  timelineDuration: number,
  trackLocked: boolean = false,
) {
  const pixelsToTime = pixelsToTimeNow;
  const fps = useTimelineStore((s) => s.fps);
  const setDragState = useSelectionStore((s) => s.setDragState);

  const { getMagneticSnapTargets, getSnapThresholdFrames, snapEnabled } = useSnapCalculator(
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
    isConstrained: false,
    constraintEdge: null,
    constraintLabel: null,
  });

  const stateRef = useRef(state);
  stateRef.current = state;
  const latestDeltaRef = useRef(0);
  const pendingStartCleanupRef = useRef<(() => void) | null>(null);

  const getItemFromStore = useCallback(() => {
    return useTimelineStore.getState().items.find((i) => i.id === item.id) ?? item;
  }, [item.id]);

  /**
   * Find immediate edit neighbors (strict adjacency / transition-linked).
   * Only adjacent neighbors get trimmed during slide.
   */
  const findNeighbors = useCallback(() => {
    const allItems = useTimelineStore.getState().items;
    const currentItem = getItemFromStore();
    const transitions = useTransitionsStore.getState().transitions;
    return findEditNeighborsWithTransitions(currentItem, allItems, transitions);
  }, [getItemFromStore]);

  const beginSlipSlideGesture = useCallback((startX: number, mode: 'slip' | 'slide') => {
    usePlaybackStore.getState().setPreviewFrame(null);

    const { leftNeighbor, rightNeighbor } = findNeighbors();
    const currentItem = getItemFromStore();

    setDragState({
      isDragging: true,
      draggedItemIds: [item.id],
      offset: { x: 0, y: 0 },
    });

    setState({
      isActive: true,
      mode,
      startX,
      currentDelta: 0,
      leftNeighborId: leftNeighbor?.id ?? null,
      rightNeighborId: rightNeighbor?.id ?? null,
      isConstrained: false,
      constraintEdge: null,
      constraintLabel: null,
    });
    latestDeltaRef.current = 0;

    // Seed preview stores immediately so linked companions show their
    // overlays on the same frame as the primary clip (no 1-frame delay).
    if (mode === 'slip') {
      useSlipEditPreviewStore.getState().setPreview({
        itemId: item.id,
        trackId: currentItem.trackId,
        slipDelta: 0,
      });
    } else {
      // Compute the effective slide range (tightest across all tracks),
      // incorporating transition constraints so the initial limit box matches
      // the bounds used during dragging.
      const allItems = useTimelineStore.getState().items;
      const transitions = useTransitionsStore.getState().transitions;
      const sourceMinDelta = clampSlideDelta(-1_000_000_000, leftNeighbor?.id ?? null, rightNeighbor?.id ?? null);
      const sourceMaxDelta = clampSlideDelta(1_000_000_000, leftNeighbor?.id ?? null, rightNeighbor?.id ?? null);
      const slideMinDelta = clampSlideDeltaToPreserveTransitions(
        currentItem, sourceMinDelta, leftNeighbor ?? null, rightNeighbor ?? null,
        allItems, transitions, fps,
      );
      const slideMaxDelta = clampSlideDeltaToPreserveTransitions(
        currentItem, sourceMaxDelta, leftNeighbor ?? null, rightNeighbor ?? null,
        allItems, transitions, fps,
      );
      useSlideEditPreviewStore.getState().setPreview({
        itemId: item.id,
        trackId: currentItem.trackId,
        leftNeighborId: leftNeighbor?.id ?? null,
        rightNeighborId: rightNeighbor?.id ?? null,
        slideDelta: 0,
        minDelta: slideMinDelta,
        maxDelta: slideMaxDelta,
      });
    }

    // Seed linked companion previews with zero-delta so their overlays appear immediately
    const linkedSelectionEnabled = useEditorStore.getState().linkedSelectionEnabled;
    if (linkedSelectionEnabled) {
      const allItems = useTimelineStore.getState().items;
      const companions = getSynchronizedLinkedItems(allItems, currentItem.id)
        .filter((c) => c.id !== currentItem.id);
      if (companions.length > 0) {
        const updates: PreviewItemUpdate[] = companions.map((c) =>
          mode === 'slip' ? applySlipPreview(c, 0) : applyMovePreview(c, 0),
        );
        useLinkedEditPreviewStore.getState().setUpdates(updates);
      }
    }
  // Note: clampSlideDelta intentionally omitted — it reads fps from store at
  // call time, and including it would cause a TDZ error (defined after this hook).
  }, [findNeighbors, getItemFromStore, item.id, setDragState]);

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
   * Clamp slide delta to neighbor source boundaries, timeline start,
   * and non-adjacent clip boundaries (can't overlap clips across a gap).
   */
  const clampSlideDelta = useCallback((delta: number, leftNeighborId: string | null, rightNeighborId: string | null): number => {
    const currentItem = getItemFromStore();
    let clamped = delta;

    // Can't slide past timeline start
    if (currentItem.from + clamped < 0) {
      clamped = -currentItem.from;
    }

    const allItems = useTimelineStore.getState().items;
    const slideItemIds = new Set([item.id, leftNeighborId, rightNeighborId].filter(Boolean) as string[]);

    // Adjacent neighbors: clamp by source limits (standard slide behavior)
    if (leftNeighborId) {
      const leftNeighbor = allItems.find((i) => i.id === leftNeighborId);
      if (leftNeighbor) {
        const { clampedAmount } = clampTrimAmount(leftNeighbor, 'end', clamped, fps);
        if (Math.abs(clampedAmount) < Math.abs(clamped)) {
          clamped = clampedAmount;
        }
        const adjacentClamped = clampToAdjacentItems(leftNeighbor, 'end', clamped, allItems, slideItemIds);
        if (Math.abs(adjacentClamped) < Math.abs(clamped)) {
          clamped = adjacentClamped;
        }
      }
    }

    if (rightNeighborId) {
      const rightNeighbor = allItems.find((i) => i.id === rightNeighborId);
      if (rightNeighbor) {
        const { clampedAmount } = clampTrimAmount(rightNeighbor, 'start', clamped, fps);
        if (Math.abs(clampedAmount) < Math.abs(clamped)) {
          clamped = clampedAmount;
        }
        const adjacentClamped = clampToAdjacentItems(rightNeighbor, 'start', clamped, allItems, slideItemIds);
        if (Math.abs(adjacentClamped) < Math.abs(clamped)) {
          clamped = adjacentClamped;
        }
      }
    }

    // Clamp by linked companions' adjacent neighbors' source limits and
    // treat non-adjacent clips across all participant tracks as walls.
    const linkedSelectionEnabled = useEditorStore.getState().linkedSelectionEnabled;
    const participants = linkedSelectionEnabled
      ? getSynchronizedLinkedItems(allItems, currentItem.id)
      : [currentItem];

    for (const participant of participants) {
      if (participant.id === currentItem.id) continue; // primary already handled above

      const pEnd = participant.from + participant.durationInFrames;
      const participantExcludeIds = new Set<string>(slideItemIds);
      for (const p of participants) participantExcludeIds.add(p.id);

      // Find this companion's own adjacent neighbors and clamp by their source limits
      for (const other of allItems) {
        if (other.trackId !== participant.trackId || other.id === participant.id) continue;
        const otherEnd = other.from + other.durationInFrames;
        if (otherEnd === participant.from) {
          // Left-adjacent neighbor on companion's track
          participantExcludeIds.add(other.id);
          const { clampedAmount } = clampTrimAmount(other, 'end', clamped, fps);
          if (Math.abs(clampedAmount) < Math.abs(clamped)) clamped = clampedAmount;
        }
        if (other.from === pEnd) {
          // Right-adjacent neighbor on companion's track
          participantExcludeIds.add(other.id);
          const { clampedAmount } = clampTrimAmount(other, 'start', clamped, fps);
          if (Math.abs(clampedAmount) < Math.abs(clamped)) clamped = clampedAmount;
        }
      }

      // Non-adjacent clips on this companion's track act as walls
      const nearest = findNearestNeighbors(participant, allItems);
      if (nearest.leftNeighbor && !participantExcludeIds.has(nearest.leftNeighbor.id)) {
        const wallRight = nearest.leftNeighbor.from + nearest.leftNeighbor.durationInFrames;
        const maxLeft = -(participant.from - wallRight);
        if (clamped < maxLeft) clamped = maxLeft;
      }
      if (nearest.rightNeighbor && !participantExcludeIds.has(nearest.rightNeighbor.id)) {
        const wallLeft = nearest.rightNeighbor.from;
        const maxRight = wallLeft - pEnd;
        if (clamped > maxRight) clamped = maxRight;
      }
    }

    // Also check the primary clip's track for non-adjacent walls
    {
      const primaryEnd = currentItem.from + currentItem.durationInFrames;
      const nearest = findNearestNeighbors(currentItem, allItems);
      if (nearest.leftNeighbor && !slideItemIds.has(nearest.leftNeighbor.id)) {
        const wallRight = nearest.leftNeighbor.from + nearest.leftNeighbor.durationInFrames;
        const maxLeft = -(currentItem.from - wallRight);
        if (clamped < maxLeft) clamped = maxLeft;
      }
      if (nearest.rightNeighbor && !slideItemIds.has(nearest.rightNeighbor.id)) {
        const wallLeft = nearest.rightNeighbor.from;
        const maxRight = wallLeft - primaryEnd;
        if (clamped > maxRight) clamped = maxRight;
      }
    }

    return clamped;
  }, [getItemFromStore, fps, item.id]);

  // Mouse move handler
  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!stateRef.current.isActive || trackLocked) return;

      const deltaX = e.clientX - stateRef.current.startX;
      const deltaTime = pixelsToTime(deltaX);
      let deltaFrames = Math.round(deltaTime * fps);
      const mode = stateRef.current.mode;

      if (mode === 'slip') {
        // Convert timeline frame delta to source frame delta.
        // Inverted: drag right â†’ source window moves left (reveals earlier content),
        // matching DaVinci Resolve convention.
        const currentItem = getItemFromStore();
        const { speed, sourceFps } = getSourceProperties(currentItem);
        const effectiveSourceFps = sourceFps ?? fps;
        const sourceFramesDelta = -timelineToSourceFrames(deltaFrames, speed, fps, effectiveSourceFps);

        const sourceClamped = clampSlipDelta(sourceFramesDelta);
        const transitionClamped = clampSlipDeltaToPreserveTransitions(
          currentItem,
          sourceClamped,
          useTimelineStore.getState().items,
          useTransitionsStore.getState().transitions,
        );
        const clamped = transitionClamped;
        const isConstrained = clamped !== sourceFramesDelta;
        const constraintEdge = !isConstrained
          ? null
          : sourceFramesDelta > clamped
          ? 'end'
          : 'start';
        const constraintLabel = clamped !== sourceClamped
          ? 'transition limit'
          : sourceClamped !== sourceFramesDelta
          ? 'no handle'
          : null;

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

        if (
          clamped !== latestDeltaRef.current
          || isConstrained !== stateRef.current.isConstrained
          || constraintEdge !== stateRef.current.constraintEdge
          || constraintLabel !== stateRef.current.constraintLabel
        ) {
          latestDeltaRef.current = clamped;
          setState((prev) => ({
            ...prev,
            currentDelta: clamped,
            isConstrained,
            constraintEdge,
            constraintLabel,
          }));
        }

        const linkedSelectionEnabled = useEditorStore.getState().linkedSelectionEnabled;
        const linkedPreviewUpdates: PreviewItemUpdate[] = linkedSelectionEnabled
          ? getSynchronizedLinkedItems(
            useTimelineStore.getState().items,
            currentItem.id,
          )
            .filter((linkedItem) => linkedItem.id !== currentItem.id)
            .map((linkedItem) => applySlipPreview(linkedItem, clamped))
          : [];
        useLinkedEditPreviewStore.getState().setUpdates(linkedPreviewUpdates);

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
            if (startDist < getSnapThresholdFrames()) {
              if (!bestSnap || startDist < Math.abs(bestSnap.offset)) {
                bestSnap = { frame: target.frame, offset: target.frame - newStart };
              }
            }

            // Snap end edge
            const endDist = Math.abs(newEnd - target.frame);
            if (endDist < getSnapThresholdFrames()) {
              if (!bestSnap || endDist < Math.abs(bestSnap.offset)) {
                bestSnap = { frame: target.frame, offset: target.frame - newEnd };
              }
            }
          }

          if (bestSnap) {
            deltaFrames += bestSnap.offset;
          }
        }

        const allItems = useTimelineStore.getState().items;
        const sourceClamped = clampSlideDelta(deltaFrames, leftNeighborId, rightNeighborId);
        const transitionClamped = clampSlideDeltaToPreserveTransitions(
          storeItem,
          sourceClamped,
          leftNeighborId ? (allItems.find((candidate) => candidate.id === leftNeighborId) ?? null) : null,
          rightNeighborId ? (allItems.find((candidate) => candidate.id === rightNeighborId) ?? null) : null,
          allItems,
          useTransitionsStore.getState().transitions,
          fps,
        );
        const clamped = transitionClamped;
        const isConstrained = clamped !== deltaFrames;
        const constraintEdge = !isConstrained
          ? null
          : deltaFrames > clamped
          ? 'end'
          : 'start';
        const constraintLabel = !isConstrained
          ? null
          : sourceClamped !== deltaFrames
          ? (storeItem.from + deltaFrames < 0 ? 'timeline start' : 'neighbor limit')
          : 'transition limit';

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

        if (
          clamped !== latestDeltaRef.current
          || isConstrained !== stateRef.current.isConstrained
          || constraintEdge !== stateRef.current.constraintEdge
          || constraintLabel !== stateRef.current.constraintLabel
        ) {
          latestDeltaRef.current = clamped;
          setState((prev) => ({
            ...prev,
            currentDelta: clamped,
            isConstrained,
            constraintEdge,
            constraintLabel,
          }));
        }

        const linkedSelectionEnabled = useEditorStore.getState().linkedSelectionEnabled;
        const synchronizedCounterpart = linkedSelectionEnabled
          ? getSynchronizedLinkedItems(allItems, storeItem.id)
            .find((candidate) => candidate.id !== storeItem.id) ?? null
          : null;
        const linkedPreviewUpdates: PreviewItemUpdate[] = [];

        if (synchronizedCounterpart) {
          linkedPreviewUpdates.push(applyMovePreview(synchronizedCounterpart, clamped));

          const leftCounterpart = leftNeighborId
            ? getMatchingSynchronizedLinkedCounterpart(allItems, leftNeighborId, synchronizedCounterpart.trackId, synchronizedCounterpart.type)
            : null;
          const rightCounterpart = rightNeighborId
            ? getMatchingSynchronizedLinkedCounterpart(allItems, rightNeighborId, synchronizedCounterpart.trackId, synchronizedCounterpart.type)
            : null;

          if (leftCounterpart) {
            linkedPreviewUpdates.push(applyTrimEndPreview(leftCounterpart, clamped, fps));
          }
          if (rightCounterpart) {
            linkedPreviewUpdates.push(applyTrimStartPreview(rightCounterpart, clamped, fps));
          }
        }

        useLinkedEditPreviewStore.getState().setUpdates(linkedPreviewUpdates);

      }
    },
    [pixelsToTime, fps, trackLocked, item.id, getItemFromStore, clampSlipDelta, clampSlideDelta, snapEnabled, getMagneticSnapTargets, getSnapThresholdFrames],
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
      useLinkedEditPreviewStore.getState().clear();

      // Clear drag state
      setDragState(null);

      setState({
        isActive: false,
        mode: null,
        startX: 0,
        currentDelta: 0,
        leftNeighborId: null,
        rightNeighborId: null,
        isConstrained: false,
        constraintEdge: null,
        constraintLabel: null,
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
          useLinkedEditPreviewStore.getState().clear();
          setDragState(null);
          latestDeltaRef.current = 0;
        }
      };
    }
  }, [state.isActive, handleMouseMove, handleMouseUp, setDragState]);

  useEffect(() => () => {
    pendingStartCleanupRef.current?.();
  }, []);

  // Start slip/slide drag
  const handleSlipSlideStart = useCallback(
    (e: React.MouseEvent, mode: 'slip' | 'slide', options?: SlipSlideStartOptions) => {
      if (e.button !== 0) return;
      if (trackLocked) return;
      if (!isMediaItem(item)) return;

      e.stopPropagation();
      pendingStartCleanupRef.current?.();

      if (options?.activateOnMoveThreshold) {
        const startX = e.clientX;
        const startY = e.clientY;

        const cleanupPendingStart = () => {
          window.removeEventListener('mousemove', checkPendingStart);
          window.removeEventListener('mouseup', cancelPendingStart);
          pendingStartCleanupRef.current = null;
        };

        const checkPendingStart = (moveEvent: MouseEvent) => {
          if (!hasExceededDragThreshold(startX, startY, moveEvent.clientX, moveEvent.clientY, DRAG_THRESHOLD_PIXELS)) {
            return;
          }

          cleanupPendingStart();
          beginSlipSlideGesture(startX, mode);
        };

        const cancelPendingStart = () => {
          cleanupPendingStart();
        };

        pendingStartCleanupRef.current = cleanupPendingStart;
        window.addEventListener('mousemove', checkPendingStart);
        window.addEventListener('mouseup', cancelPendingStart);
        return;
      }

      e.preventDefault();
      beginSlipSlideGesture(e.clientX, mode);
    },
    [beginSlipSlideGesture, item, trackLocked],
  );

  return {
    isSlipSlideActive: state.isActive,
    slipSlideMode: state.mode,
    slipSlideDelta: state.currentDelta,
    slipSlideConstrained: state.isConstrained,
    slipSlideConstraintEdge: state.constraintEdge,
    slipSlideConstraintLabel: state.constraintLabel,
    handleSlipSlideStart,
  };
}
