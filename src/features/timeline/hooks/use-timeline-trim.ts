import { useState, useCallback, useRef, useEffect } from 'react';
import type { TimelineItem } from '@/types/timeline';
import { usePlaybackStore } from '@/shared/state/playback';
import { useEditorStore } from '@/app/state/editor';
import { toast } from 'sonner';
import type { SnapTarget } from '../types/drag';
import { useTimelineStore } from '../stores/timeline-store';
import { useItemsStore } from '../stores/items-store';
import { useSelectionStore } from '@/shared/state/selection';
import { pixelsToTimeNow } from '../utils/zoom-conversions';
import { useSnapCalculator } from './use-snap-calculator';
import { clampTrimAmount, clampToAdjacentItems, type TrimHandle } from '../utils/trim-utils';
import { useTransitionsStore } from '../stores/transitions-store';
import { useRollingEditPreviewStore } from '../stores/rolling-edit-preview-store';
import { useRippleEditPreviewStore } from '../stores/ripple-edit-preview-store';
import { useTransitionBreakPreviewStore } from '../stores/transition-break-preview-store';
import { useLinkedEditPreviewStore } from '../stores/linked-edit-preview-store';
import {
  rollingTrimItems,
  rippleTrimItem,
  trimItemBreakingTransition,
} from '../stores/actions/item-actions';
import {
  buildInsertedGapPreviewUpdatesForSyncLockedTracks,
  buildRemovedIntervalPreviewUpdatesForSyncLockedTracks,
} from '../stores/actions/sync-lock-ripple';
import { findHandleNeighborWithTransitions } from '../utils/transition-linked-neighbors';
import {
  buildSynchronizedLinkedMoveUpdates,
  getSynchronizedLinkedCounterpartPair,
  getSynchronizedLinkedItems,
} from '../utils/linked-items';
import {
  applyMovePreview,
  applyTrimEndPreview,
  applyTrimStartPreview,
  type PreviewItemUpdate,
} from '../utils/item-edit-preview';
import {
  clampRippleTrimDeltaToPreserveTransition,
  clampRollingTrimDeltaToPreserveTransition,
} from '../utils/transition-utils';
import { getTransitionBridgeAtHandle } from '../utils/transition-edit-guards';

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
  forcedMode: 'rolling' | 'ripple' | null;
  isConstrained: boolean;
  constraintLabel: string | null;
  destroyTransitionAtHandle: boolean;
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
  const pixelsToTime = pixelsToTimeNow;
  const fps = useTimelineStore((s) => s.fps);
  const trimItemStart = useTimelineStore((s) => s.trimItemStart);
  const trimItemEnd = useTimelineStore((s) => s.trimItemEnd);
  const setDragState = useSelectionStore((s) => s.setDragState);
  const setActiveSnapTarget = useSelectionStore((s) => s.setActiveSnapTarget);

  // Get fresh item from store to ensure we have latest values after previous trims
  const getItemFromStore = useCallback(() => {
    return useTimelineStore.getState().items.find((i) => i.id === item.id) ?? item;
  }, [item.id]);

  // Use snap calculator - pass item.id to exclude self from magnetic snaps
  // Only use magnetic snap targets (item edges), not grid lines
  const { getMagneticSnapTargets, getSnapThresholdFrames, snapEnabled } = useSnapCalculator(
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
    forcedMode: null,
    isConstrained: false,
    constraintLabel: null,
    destroyTransitionAtHandle: false,
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
      let minDistance = getSnapThresholdFrames();

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
    [snapEnabled, getMagneticSnapTargets, getSnapThresholdFrames]
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
      const forcedMode = trimStateRef.current.forcedMode;
      const isRollingEdit = forcedMode === 'rolling'
        || (forcedMode === null && altKeyRef.current && !shiftKeyRef.current);
      const isRippleEdit = forcedMode === 'ripple'
        || (forcedMode === null && shiftKeyRef.current);
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
      let isConstrained = false;
      let constraintLabel: string | null = null;
      const { clampedAmount } = clampTrimAmount(currentItem, handle!, deltaFrames, fps);
      if (clampedAmount !== deltaFrames) {
        isConstrained = true;
        constraintLabel = 'no handle';
      }
      deltaFrames = clampedAmount;

      // Clamp to adjacent items on the same track (allow overlap with transition-linked clips)
      // During ripple edit, skip adjacency clamping — downstream clips shift with the trim.
      if (!isRippleEdit) {
        const transitionLinkedIds = new Set<string>();
        if (!trimStateRef.current.destroyTransitionAtHandle) {
          for (const t of transitions) {
            if (t.leftClipId === currentItem.id) transitionLinkedIds.add(t.rightClipId);
            if (t.rightClipId === currentItem.id) transitionLinkedIds.add(t.leftClipId);
          }
        }
        // During rolling edit, exclude the neighbor from adjacency constraints —
        // it moves with the edit point, so the rolling edit clamp below handles it.
        if (isRollingEdit && neighborId) {
          transitionLinkedIds.add(neighborId);
        }
        const adjacentClamped = clampToAdjacentItems(currentItem, handle!, deltaFrames, allItems, transitionLinkedIds);
        if (adjacentClamped !== deltaFrames) {
          isConstrained = true;
          constraintLabel = 'neighbor limit';
        }
        deltaFrames = adjacentClamped;
      }

      // Rolling edit: clamp to both clips' source limits
      if (isRollingEdit && neighborId) {
        const neighbor = allItems.find((i) => i.id === neighborId)!;
        if (handle === 'end') {
          // Neighbor's start is trimmed by the same delta (positive = shrink start)
          const { clampedAmount: neighborClamped } = clampTrimAmount(neighbor, 'start', deltaFrames, fps);
          // Use tighter constraint of both clips
          if (Math.abs(neighborClamped) < Math.abs(deltaFrames)) {
            isConstrained = true;
            constraintLabel = 'cut limit';
            deltaFrames = neighborClamped;
          }
        } else {
          // For the left neighbor's end, pass deltaFrames directly to clampTrimAmount
          // delta > 0 (shrink this item's start, edit point moves right) â†’ neighbor extends end (positive for trimEnd = extend)
          // delta < 0 (extend this item's start, edit point moves left) â†’ neighbor shrinks end (negative for trimEnd = shrink)
          const { clampedAmount: neighborClamped } = clampTrimAmount(neighbor, 'end', deltaFrames, fps);
          if (Math.abs(neighborClamped) < Math.abs(deltaFrames)) {
            isConstrained = true;
            constraintLabel = 'cut limit';
            deltaFrames = neighborClamped;
          }
        }

        const transitionAtHandle = getTransitionBridgeAtHandle(transitions, currentItem.id, handle!);
        const transitionClamped = clampRollingTrimDeltaToPreserveTransition(
          currentItem,
          handle!,
          deltaFrames,
          neighbor,
          transitionAtHandle,
          fps,
        );
        if (transitionClamped !== deltaFrames) {
          isConstrained = true;
          constraintLabel = 'transition limit';
          deltaFrames = transitionClamped;
        }
      }

      if (isRippleEdit && !trimStateRef.current.destroyTransitionAtHandle) {
        const transitionAtHandle = getTransitionBridgeAtHandle(transitions, currentItem.id, handle!);
        const neighborAtHandle = transitionAtHandle
          ? allItems.find((candidate) => (
              handle === 'end'
                ? candidate.id === transitionAtHandle.rightClipId
                : candidate.id === transitionAtHandle.leftClipId
            )) ?? null
          : null;
        const transitionClamped = clampRippleTrimDeltaToPreserveTransition(
          currentItem,
          handle!,
          deltaFrames,
          neighborAtHandle,
          transitionAtHandle,
          fps,
        );
        if (transitionClamped !== deltaFrames) {
          isConstrained = true;
          constraintLabel = 'transition limit';
          deltaFrames = transitionClamped;
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
            constrained: isConstrained,
          });
        } else if (previewStore.neighborDelta !== deltaFrames || previewStore.constrained !== isConstrained) {
          previewStore.setNeighborDelta(deltaFrames, isConstrained);
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

      if (trimStateRef.current.destroyTransitionAtHandle && handle) {
        const transitionBreakStore = useTransitionBreakPreviewStore.getState();
        if (
          transitionBreakStore.itemId !== item.id
          || transitionBreakStore.handle !== handle
        ) {
          transitionBreakStore.setPreview({
            itemId: item.id,
            handle,
            delta: deltaFrames,
          });
        } else if (transitionBreakStore.delta !== deltaFrames) {
          transitionBreakStore.setDelta(deltaFrames);
        }
      } else {
        const transitionBreakStore = useTransitionBreakPreviewStore.getState();
        if (transitionBreakStore.itemId) {
          transitionBreakStore.clearPreview();
        }
      }

      // Update local state for visual feedback
      const isRolling = isRollingEdit && neighborId !== null;
      const linkedPreviewUpdates: PreviewItemUpdate[] = [];
      const linkedSelectionEnabled = useEditorStore.getState().linkedSelectionEnabled;

      if (isRolling && neighborId) {
        const counterpartPair = linkedSelectionEnabled
          ? (handle === 'end'
            ? getSynchronizedLinkedCounterpartPair(allItems, currentItem.id, neighborId)
            : getSynchronizedLinkedCounterpartPair(allItems, neighborId, currentItem.id))
          : null;

        if (counterpartPair) {
          linkedPreviewUpdates.push(
            applyTrimEndPreview(counterpartPair.leftCounterpart, deltaFrames, fps),
            applyTrimStartPreview(counterpartPair.rightCounterpart, deltaFrames, fps),
          );
        }
      } else if (isRippleEdit) {
        const synchronizedItems = linkedSelectionEnabled
          ? getSynchronizedLinkedItems(allItems, currentItem.id)
          : [currentItem];
        const linkedCompanions = synchronizedItems.filter((linkedItem) => linkedItem.id !== currentItem.id);

        for (const linkedItem of linkedCompanions) {
          if (handle === 'end') {
            linkedPreviewUpdates.push(applyTrimEndPreview(linkedItem, deltaFrames, fps));
          } else {
            linkedPreviewUpdates.push({
              ...applyTrimStartPreview(linkedItem, deltaFrames, fps),
              from: linkedItem.from,
            });
          }
        }

        const rippleShift = handle === 'end' ? deltaFrames : -deltaFrames;
        if (rippleShift !== 0 && synchronizedItems.length > 1) {
          const synchronizedIds = new Set(synchronizedItems.map((linkedItem) => linkedItem.id));
          const oldById = new Map(synchronizedItems.map((linkedItem) => [linkedItem.id, linkedItem]));
          const baseDeltaByItemId = new Map<string, number>();

          for (const synchronizedItem of synchronizedItems) {
            const synchronizedOld = oldById.get(synchronizedItem.id);
            if (!synchronizedOld) continue;

            const synchronizedOldEnd = synchronizedOld.from + synchronizedOld.durationInFrames;
            const transitionNeighborIds = new Set<string>();
            for (const transition of transitions) {
              if (transition.leftClipId === synchronizedItem.id) {
                transitionNeighborIds.add(transition.rightClipId);
              }
            }

            for (const candidate of allItems) {
              if (synchronizedIds.has(candidate.id)) continue;
              if (candidate.trackId !== synchronizedOld.trackId) continue;
              if (candidate.from >= synchronizedOldEnd || transitionNeighborIds.has(candidate.id)) {
                baseDeltaByItemId.set(candidate.id, rippleShift);
              }
            }
          }

          linkedPreviewUpdates.push(
            ...buildSynchronizedLinkedMoveUpdates(allItems, baseDeltaByItemId)
              // Same-track downstream clips already get their live ripple shift from
              // `useRippleEditPreviewStore`; duplicating that here moves them twice,
              // which creates the temporary gap/ghost before mouseup snaps back.
              .filter((update) => allItems.find((candidate) => candidate.id === update.id)?.trackId !== currentItem.trackId)
              .map((update) => applyMovePreview(
                allItems.find((candidate) => candidate.id === update.id)!,
                update.from - (allItems.find((candidate) => candidate.id === update.id)?.from ?? update.from),
              )),
          );
        }

        if (rippleShift !== 0) {
          const editedTrackIds = new Set(
            synchronizedItems.map((linkedItem) => linkedItem.trackId),
          );
          const syncLockPreviewUpdates = rippleShift < 0
            ? buildRemovedIntervalPreviewUpdatesForSyncLockedTracks({
              items: allItems,
              tracks: useItemsStore.getState().tracks,
              editedTrackIds,
              intervals: [{
                start: currentItem.from + currentItem.durationInFrames + rippleShift,
                end: currentItem.from + currentItem.durationInFrames,
              }],
            })
            : buildInsertedGapPreviewUpdatesForSyncLockedTracks({
              items: allItems,
              tracks: useItemsStore.getState().tracks,
              editedTrackIds,
              cutFrame: currentItem.from + currentItem.durationInFrames,
              amount: rippleShift,
            });

          linkedPreviewUpdates.push(...syncLockPreviewUpdates);
        }
      } else {
        const synchronizedItems = linkedSelectionEnabled
          ? getSynchronizedLinkedItems(allItems, currentItem.id)
          : [currentItem];
        for (const linkedItem of synchronizedItems) {
          if (linkedItem.id === currentItem.id) continue;
          linkedPreviewUpdates.push(
            handle === 'end'
              ? applyTrimEndPreview(linkedItem, deltaFrames, fps)
              : applyTrimStartPreview(linkedItem, deltaFrames, fps),
          );
        }
      }

      useLinkedEditPreviewStore.getState().setUpdates(linkedPreviewUpdates);

      if (deltaFrames !== trimStateRef.current.currentDelta ||
          isRolling !== trimStateRef.current.isRollingEdit ||
          isRippleEdit !== trimStateRef.current.isRippleEdit ||
          neighborId !== trimStateRef.current.neighborId ||
          isConstrained !== trimStateRef.current.isConstrained ||
          constraintLabel !== trimStateRef.current.constraintLabel) {
        setTrimState(prev => ({
          ...prev,
          currentDelta: deltaFrames,
          isRollingEdit: isRolling,
          isRippleEdit,
          neighborId: neighborId,
          isConstrained,
          constraintLabel,
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
        setActiveSnapTarget(snapTarget);
      }
    },
    [pixelsToTime, fps, trackLocked, findSnapForFrame, setActiveSnapTarget, item.id, getItemFromStore]
  );

  // Mouse up handler - commits changes to store (single update)
  const handleMouseUp = useCallback(() => {
    if (trimStateRef.current.isTrimming) {
      const state = trimStateRef.current;
      const deltaFrames = trimStateRef.current.currentDelta;

      // Only update store if there was actual change
      if (deltaFrames !== 0) {
        const transitionIdsToRemove = state.destroyTransitionAtHandle && state.handle
          ? useTransitionsStore.getState().transitions
              .filter((transition) => (
                state.handle === 'start'
                  ? transition.rightClipId === item.id
                  : transition.leftClipId === item.id
              ))
              .map((transition) => transition.id)
          : [];

        if (state.destroyTransitionAtHandle && state.handle) {
          trimItemBreakingTransition(item.id, state.handle, deltaFrames, transitionIdsToRemove);
        } else if (state.isRippleEdit) {
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
      useTransitionBreakPreviewStore.getState().clearPreview();
      useLinkedEditPreviewStore.getState().clear();

      // Clear drag state (including snap indicator)
      setActiveSnapTarget(null);
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
        forcedMode: null,
        isConstrained: false,
        constraintLabel: null,
        destroyTransitionAtHandle: false,
      });
    }
  }, [item.id, trimItemStart, trimItemEnd, setActiveSnapTarget, setDragState]);

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
        useRollingEditPreviewStore.getState().clearPreview();
        useTransitionBreakPreviewStore.getState().clearPreview();
        useLinkedEditPreviewStore.getState().clear();
      };
    }
  }, [trimState.isTrimming, handleMouseMove, handleMouseUp]);

  // Start trim drag
  const handleTrimStart = useCallback(
    (e: React.MouseEvent, handle: TrimHandle, options?: {
      forcedMode?: 'rolling' | 'ripple' | null;
      destroyTransitionAtHandle?: boolean;
    }) => {
      // Only respond to left mouse button
      if (e.button !== 0) return;
      if (trackLocked) return;

      // Always prevent default trim-handle mouse behavior for all paths,
      // including guardrail early returns.
      e.stopPropagation();
      e.preventDefault();
      usePlaybackStore.getState().setPreviewFrame(null);

      const forcedMode = options?.forcedMode ?? null;
      const destroyTransitionAtHandle = options?.destroyTransitionAtHandle ?? false;
      const modifierRolling = e.altKey && !e.shiftKey;
      const modifierRipple = e.shiftKey;

      const wantsRolling = forcedMode === 'rolling' || (forcedMode === null && modifierRolling);
      const wantsRipple = forcedMode === 'ripple' || (forcedMode === null && modifierRipple);
      const currentItem = getItemFromStore();
      const transitions = useTransitionsStore.getState().transitions;
      let neighborId: string | null = null;

      if (wantsRolling) {
        const neighbor = findHandleNeighborWithTransitions(
          currentItem,
          handle,
          useTimelineStore.getState().items,
          transitions,
        );
        neighborId = neighbor?.id ?? null;
        if (!neighborId) {
          toast.warning('Rolling edit needs a neighbor on this edge');
          return;
        }
      }

      setDragState({
        isDragging: true,
        draggedItemIds: [item.id],
        offset: { x: 0, y: 0 },
      });
      setActiveSnapTarget(null);

      setTrimState({
        isTrimming: true,
        handle,
        startX: e.clientX,
        initialFrom: item.from,
        initialDuration: item.durationInFrames,
        currentDelta: 0,
        isRollingEdit: wantsRolling,
        isRippleEdit: wantsRipple,
        neighborId,
        forcedMode,
        isConstrained: false,
        constraintLabel: null,
        destroyTransitionAtHandle,
      });

      if (wantsRolling && neighborId) {
        useRollingEditPreviewStore.getState().setPreview({
          trimmedItemId: item.id,
          neighborItemId: neighborId,
          handle,
          neighborDelta: 0,
        });
      }

      if (destroyTransitionAtHandle) {
        useTransitionBreakPreviewStore.getState().setPreview({
          itemId: item.id,
          handle,
          delta: 0,
        });
      } else {
        useTransitionBreakPreviewStore.getState().clearPreview();
      }
    },
    [item.from, item.durationInFrames, trackLocked, getItemFromStore, item.id, setActiveSnapTarget, setDragState]
  );

  return {
    isTrimming: trimState.isTrimming,
    trimHandle: trimState.handle,
    trimDelta: trimState.currentDelta,
    isRollingEdit: trimState.isRollingEdit,
    isRippleEdit: trimState.isRippleEdit,
    trimConstrained: trimState.isConstrained,
    trimConstraintLabel: trimState.constraintLabel,
    handleTrimStart,
  };
}
