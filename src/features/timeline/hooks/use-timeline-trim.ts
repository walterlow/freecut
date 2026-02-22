import { useState, useCallback, useRef, useEffect } from 'react';
import type { TimelineItem } from '@/types/timeline';
import { toast } from 'sonner';
import type { SnapTarget } from '../types/drag';
import { useTimelineStore } from '../stores/timeline-store';
import { useSelectionStore } from '@/features/editor/stores/selection-store';
import { useTimelineZoom } from './use-timeline-zoom';
import { useSnapCalculator } from './use-snap-calculator';
import { clampTrimAmount, clampToAdjacentItems, type TrimHandle } from '../utils/trim-utils';
import { useTransitionsStore } from '../stores/transitions-store';
import { useRollingEditPreviewStore } from '../stores/rolling-edit-preview-store';
import { useRippleEditPreviewStore } from '../stores/ripple-edit-preview-store';
import { rollingTrimItems, rippleTrimItem } from '../stores/actions/item-actions';
import { hasTransitionBridgeAtHandle } from '../utils/transition-edit-guards';
import { findHandleNeighborWithTransitions } from '../utils/transition-linked-neighbors';

interface TrimState {
  isTrimming: boolean;
  handle: TrimHandle | null;
  startX: number;
  initialFrom: number;
  initialDuration: number;
  currentDelta: number; // Track current delta for visual feedback
  isRollingEdit: boolean;
  isRippleEdit: boolean;
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
  const { getMagneticSnapTargets, snapThresholdFrames, snapEnabled } = useSnapCalculator(
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
    isRippleEdit: false,
    neighborId: null,
  });

  const trimStateRef = useRef(trimState);
  trimStateRef.current = trimState;

  // Track Alt key state for rolling edit
  const altKeyRef = useRef(false);

  // Track Shift key state for ripple edit
  const shiftKeyRef = useRef(false);

  // Track previous snap target to avoid unnecessary store updates
  const prevSnapTargetRef = useRef<{ frame: number; type: string } | null>(null);

  /**
   * Find nearest snap target for a given frame position
   * @param excludeItemId - Optional item ID to exclude from snap targets (e.g. rolling edit neighbor)
   */
  const findSnapForFrame = useCallback(
    (targetFrame: number, excludeItemIds?: Set<string>): { snappedFrame: number; snapTarget: SnapTarget | null } => {
      if (!snapEnabled) {
        return { snappedFrame: targetFrame, snapTarget: null };
      }

      // Read fresh targets from store — the memoized magneticSnapTargets can be
      // stale after previous edits that shifted items (e.g. ripple edit).
      const targets = getMagneticSnapTargets();
      if (targets.length === 0) {
        return { snappedFrame: targetFrame, snapTarget: null };
      }

      let nearestTarget: SnapTarget | null = null;
      let minDistance = snapThresholdFrames;

      for (const target of targets) {
        if (excludeItemIds && target.itemId && excludeItemIds.has(target.itemId)) continue;
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
    [snapEnabled, getMagneticSnapTargets, snapThresholdFrames]
  );

  // Mouse move handler - only updates local state for visual feedback
  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!trimStateRef.current.isTrimming || trackLocked) return;

      const deltaX = e.clientX - trimStateRef.current.startX;
      const deltaTime = pixelsToTime(deltaX);
      let deltaFrames = Math.round(deltaTime * fps);

      const { handle, initialFrom, initialDuration } = trimStateRef.current;

      // Detect edit modes.
      // Explicit tool selection takes precedence over modifier keys.
      const activeTool = useSelectionStore.getState().activeTool;
      const explicitRolling = activeTool === 'rolling-edit';
      const explicitRipple = activeTool === 'ripple-edit';
      const isRollingEdit = explicitRolling || (!explicitRipple && altKeyRef.current && !shiftKeyRef.current);
      const isRippleEdit = explicitRipple || (!explicitRolling && shiftKeyRef.current);
      const allItems = useTimelineStore.getState().items;
      const transitions = useTransitionsStore.getState().transitions;
      const currentItem = getItemFromStore();
      let neighborId: string | null = null;

      if (isRollingEdit) {
        const neighbor = findHandleNeighborWithTransitions(
          currentItem,
          handle!,
          allItems,
          transitions,
        );
        if (neighbor) neighborId = neighbor.id;
      }

      // Calculate the target edge position and apply snapping
      // During rolling edit, exclude the neighbor from snap targets.
      // During ripple edit, exclude downstream same-track items — their positions
      // are stale because they will shift by the trim amount on commit.
      const snapExcludeIds = new Set<string>([currentItem.id]);
      if (neighborId) snapExcludeIds.add(neighborId);
      if (isRippleEdit) {
        // Split segments from the same origin can create self-referential
        // snap targets during ripple drags; exclude the whole segment family.
        if (currentItem.originId) {
          for (const other of allItems) {
            if (
              other.id !== currentItem.id &&
              other.trackId === currentItem.trackId &&
              other.originId === currentItem.originId
            ) {
              snapExcludeIds.add(other.id);
            }
          }
        }

        const currentEnd = currentItem.from + currentItem.durationInFrames;
        for (const other of allItems) {
          if (other.id !== currentItem.id && other.trackId === currentItem.trackId && other.from >= currentEnd) {
            snapExcludeIds.add(other.id);
          }
        }
        // Also exclude transition-connected neighbors in both directions — in
        // the overlap model, their `from` can be before currentEnd, but their
        // edges/midpoints still sit on the active edit region.
        for (const t of transitions) {
          if (t.leftClipId === currentItem.id) snapExcludeIds.add(t.rightClipId);
          if (t.rightClipId === currentItem.id) snapExcludeIds.add(t.leftClipId);
        }
      }

      const initialEnd = initialFrom + initialDuration;

      // Snap the edge the user is dragging — always the handle edge,
      // regardless of edit mode. Ripple commit logic (anchor from, move end,
      // shift downstream) is separate from the snap target.
      const targetEdgeFrame = handle === 'start'
        ? initialFrom + deltaFrames
        : initialEnd + deltaFrames;

      // Find snap target for the edge being trimmed
      const { snappedFrame, snapTarget } = findSnapForFrame(
        targetEdgeFrame,
        snapExcludeIds.size > 0 ? snapExcludeIds : undefined
      );

      // If snapped, adjust deltaFrames accordingly
      if (snapTarget) {
        if (handle === 'start') {
          deltaFrames = snappedFrame - initialFrom;
        } else {
          deltaFrames = snappedFrame - initialEnd;
        }
      }

      // Apply source boundary clamping for media items
      // This ensures visual feedback matches what the store will actually commit
      const { clampedAmount } = clampTrimAmount(currentItem, handle!, deltaFrames, fps);
      deltaFrames = clampedAmount;

      // Clamp to adjacent items on the same track (allow overlap with transition-linked clips)
      // During ripple edit, skip adjacency clamping — downstream clips shift with the trim.
      if (!isRippleEdit) {
        const transitionLinkedIds = new Set<string>();
        for (const t of transitions) {
          if (t.leftClipId === currentItem.id) transitionLinkedIds.add(t.rightClipId);
          if (t.rightClipId === currentItem.id) transitionLinkedIds.add(t.leftClipId);
        }
        // During rolling edit, exclude the neighbor from adjacency constraints —
        // it moves with the edit point, so the rolling edit clamp below handles it.
        if (isRollingEdit && neighborId) {
          transitionLinkedIds.add(neighborId);
        }
        deltaFrames = clampToAdjacentItems(currentItem, handle!, deltaFrames, allItems, transitionLinkedIds);
      }

      // Rolling edit: clamp to both clips' source limits
      if (isRollingEdit && neighborId) {
        const neighbor = allItems.find((i) => i.id === neighborId)!;
        if (handle === 'end') {
          // Neighbor's start is trimmed by the same delta (positive = shrink start)
          const { clampedAmount: neighborClamped } = clampTrimAmount(neighbor, 'start', deltaFrames, fps);
          // Use tighter constraint of both clips
          if (Math.abs(neighborClamped) < Math.abs(deltaFrames)) {
            deltaFrames = neighborClamped;
          }
        } else {
          // For the left neighbor's end, pass deltaFrames directly to clampTrimAmount
          // delta > 0 (shrink this item's start, edit point moves right) → neighbor extends end (positive for trimEnd = extend)
          // delta < 0 (extend this item's start, edit point moves left) → neighbor shrinks end (negative for trimEnd = shrink)
          const { clampedAmount: neighborClamped } = clampTrimAmount(neighbor, 'end', deltaFrames, fps);
          if (Math.abs(neighborClamped) < Math.abs(deltaFrames)) {
            deltaFrames = neighborClamped;
          }
        }
      }

      // Update rolling edit preview store
      if (neighborId) {
        const previewStore = useRollingEditPreviewStore.getState();
        if (
          previewStore.trimmedItemId !== item.id
          || previewStore.neighborItemId !== neighborId
          || previewStore.handle !== handle
        ) {
          previewStore.setPreview({
            trimmedItemId: item.id,
            neighborItemId: neighborId,
            handle: handle!,
            neighborDelta: deltaFrames,
          });
        } else if (previewStore.neighborDelta !== deltaFrames) {
          previewStore.setNeighborDelta(deltaFrames);
        }
      } else {
        // Clear preview when Alt is released or no neighbor found
        const previewStore = useRollingEditPreviewStore.getState();
        if (previewStore.trimmedItemId) {
          previewStore.clearPreview();
        }
      }

      // Update ripple edit preview store for downstream item visual feedback.
      // Both the trimmed item's delta and the downstream shift are stored in the
      // same Zustand store so they commit in a single render — preventing a
      // one-frame gap between the extending clip and the shifting neighbours.
      if (isRippleEdit) {
        // Calculate the shift that downstream items would experience
        let rippleShift = 0;
        if (handle === 'end') {
          rippleShift = deltaFrames;
        } else {
          // Start handle: anchor-from model — downstream shifts by -delta
          rippleShift = -deltaFrames;
        }

        const rippleStore = useRippleEditPreviewStore.getState();
        if (
          rippleStore.trimmedItemId !== item.id
          || rippleStore.handle !== handle
          || rippleStore.trackId !== currentItem.trackId
        ) {
          // Compute downstream item IDs once — includes transition-connected
          // neighbors whose `from` may be before the trimmed clip's end (overlap model).
          const currentEnd = currentItem.from + currentItem.durationInFrames;
          const dsIds = new Set<string>();
          for (const other of allItems) {
            if (other.id !== currentItem.id && other.trackId === currentItem.trackId && other.from >= currentEnd) {
              dsIds.add(other.id);
            }
          }
          // Transition-connected neighbors in the overlap model
          for (const t of transitions) {
            if (t.leftClipId === currentItem.id) dsIds.add(t.rightClipId);
          }
          rippleStore.setPreview({
            trimmedItemId: item.id,
            handle: handle!,
            trackId: currentItem.trackId,
            downstreamItemIds: dsIds,
            delta: rippleShift,
            trimDelta: deltaFrames,
          });
        } else if (
          rippleStore.delta !== rippleShift
          || rippleStore.trimDelta !== deltaFrames
        ) {
          rippleStore.setDeltas(rippleShift, deltaFrames);
        }
      } else {
        // Clear ripple preview when Shift is released or not in ripple mode
        const rippleStore = useRippleEditPreviewStore.getState();
        if (rippleStore.trimmedItemId) {
          rippleStore.clearPreview();
        }
      }

      // Update local state for visual feedback
      const isRolling = isRollingEdit && neighborId !== null;
      if (deltaFrames !== trimStateRef.current.currentDelta ||
          isRolling !== trimStateRef.current.isRollingEdit ||
          isRippleEdit !== trimStateRef.current.isRippleEdit ||
          neighborId !== trimStateRef.current.neighborId) {
        setTrimState(prev => ({
          ...prev,
          currentDelta: deltaFrames,
          isRollingEdit: isRolling,
          isRippleEdit,
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
        if (state.isRippleEdit) {
          // Ripple edit: trim + shift downstream items
          rippleTrimItem(item.id, state.handle!, deltaFrames);
        } else if (state.isRollingEdit && state.neighborId) {
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

      // Clear ripple edit preview
      useRippleEditPreviewStore.getState().clearPreview();

      // Clear drag state (including snap indicator)
      setDragState(null);
      prevSnapTargetRef.current = null;

      // Reset modifier key refs
      altKeyRef.current = false;
      shiftKeyRef.current = false;

      setTrimState({
        isTrimming: false,
        handle: null,
        startX: 0,
        initialFrom: 0,
        initialDuration: 0,
        currentDelta: 0,
        isRollingEdit: false,
        isRippleEdit: false,
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
        if (e.key === 'Shift') {
          shiftKeyRef.current = true;
        }
      };
      const handleKeyUp = (e: KeyboardEvent) => {
        if (e.key === 'Alt') altKeyRef.current = false;
        if (e.key === 'Shift') shiftKeyRef.current = false;
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

      // Always prevent default trim-handle mouse behavior for all paths,
      // including guardrail early returns.
      e.stopPropagation();
      e.preventDefault();

      const activeTool = useSelectionStore.getState().activeTool;
      const explicitRolling = activeTool === 'rolling-edit';
      const explicitRipple = activeTool === 'ripple-edit';
      const modifierRolling = !explicitRipple && e.altKey && !e.shiftKey;
      const modifierRipple = !explicitRolling && e.shiftKey;

      const wantsRolling = explicitRolling || modifierRolling;
      const wantsRipple = explicitRipple || modifierRipple;

      const currentItem = getItemFromStore();
      const transitions = useTransitionsStore.getState().transitions;

      if (wantsRolling) {
        const neighbor = findHandleNeighborWithTransitions(
          currentItem,
          handle,
          useTimelineStore.getState().items,
          transitions,
        );
        const neighborId = neighbor?.id ?? null;
        if (!neighborId) {
          toast.warning('Rolling edit needs a neighbor on this edge');
          return;
        }
      }

      if (wantsRipple && hasTransitionBridgeAtHandle(transitions, currentItem.id, handle)) {
        toast.warning('Ripple edit is blocked on transition edges', {
          description: 'Remove the transition bridge or edit the opposite edge.',
        });
        return;
      }

      setTrimState({
        isTrimming: true,
        handle,
        startX: e.clientX,
        initialFrom: item.from,
        initialDuration: item.durationInFrames,
        currentDelta: 0,
        isRollingEdit: false,
        isRippleEdit: false,
        neighborId: null,
      });
    },
    [item.from, item.durationInFrames, trackLocked, getItemFromStore]
  );

  return {
    isTrimming: trimState.isTrimming,
    trimHandle: trimState.handle,
    trimDelta: trimState.currentDelta,
    isRollingEdit: trimState.isRollingEdit,
    isRippleEdit: trimState.isRippleEdit,
    handleTrimStart,
  };
}
