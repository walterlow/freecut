/**
 * Timeline Store Facade
 *
 * Provides backward-compatible access to the split timeline stores.
 * Components can continue using `useTimelineStore` exactly as before.
 *
 * Architecture:
 * - Domain stores hold the actual state (items, transitions, keyframes, markers, settings)
 * - Command store handles undo/redo via snapshots
 * - Timeline actions wrap cross-domain operations
 * - This facade combines them into a single unified API
 */

import { useSyncExternalStore, useRef, useCallback } from 'react';
import type { TimelineState, TimelineActions } from '../types';

// Domain stores
import { useItemsStore } from './items-store';
import { useTransitionsStore } from './transitions-store';
import { useKeyframesStore } from './keyframes-store';
import { useMarkersStore } from './markers-store';
import { useTimelineSettingsStore } from './timeline-settings-store';
import { useTimelineCommandStore } from './timeline-command-store';
import {
  getEffectiveTimelineMaxFrame,
  sanitizeInOutPoints,
} from '../utils/in-out-points';

// Actions
import * as timelineActions from './timeline-actions';
import { loadTimeline, saveTimeline } from './timeline-persistence';

// =============================================================================
// CACHED SNAPSHOT SYSTEM
// useSyncExternalStore requires getSnapshot to return the same reference
// when the underlying data hasn't changed, otherwise it causes infinite loops.
// =============================================================================

// Cache for the combined state - only rebuild when underlying state changes
let cachedSnapshot: (TimelineState & TimelineActions) | null = null;

// Track references to detect changes
let lastItemsRef: unknown = null;
let lastTracksRef: unknown = null;
let lastTransitionsRef: unknown = null;
let lastKeyframesRef: unknown = null;
let lastMarkersRef: unknown = null;
let lastInPointRef: unknown = null;
let lastOutPointRef: unknown = null;
let lastFpsRef: unknown = null;
let lastScrollPositionRef: unknown = null;
let lastSnapEnabledRef: unknown = null;
let lastIsDirtyRef: unknown = null;

/**
 * Get cached snapshot, rebuilding only if underlying state changed.
 */
function getSnapshot(): TimelineState & TimelineActions {
  const itemsState = useItemsStore.getState();
  const transitionsState = useTransitionsStore.getState();
  const keyframesState = useKeyframesStore.getState();
  const markersState = useMarkersStore.getState();
  const settingsState = useTimelineSettingsStore.getState();

  // Check if any reference changed
  const stateChanged =
    lastItemsRef !== itemsState.items ||
    lastTracksRef !== itemsState.tracks ||
    lastTransitionsRef !== transitionsState.transitions ||
    lastKeyframesRef !== keyframesState.keyframes ||
    lastMarkersRef !== markersState.markers ||
    lastInPointRef !== markersState.inPoint ||
    lastOutPointRef !== markersState.outPoint ||
    lastFpsRef !== settingsState.fps ||
    lastScrollPositionRef !== settingsState.scrollPosition ||
    lastSnapEnabledRef !== settingsState.snapEnabled ||
    lastIsDirtyRef !== settingsState.isDirty;

  if (!cachedSnapshot || stateChanged) {
    // Update tracked references
    lastItemsRef = itemsState.items;
    lastTracksRef = itemsState.tracks;
    lastTransitionsRef = transitionsState.transitions;
    lastKeyframesRef = keyframesState.keyframes;
    lastMarkersRef = markersState.markers;
    lastInPointRef = markersState.inPoint;
    lastOutPointRef = markersState.outPoint;
    lastFpsRef = settingsState.fps;
    lastScrollPositionRef = settingsState.scrollPosition;
    lastSnapEnabledRef = settingsState.snapEnabled;
    lastIsDirtyRef = settingsState.isDirty;

    // Rebuild cached snapshot
    cachedSnapshot = {
      // State
      items: itemsState.items,
      tracks: itemsState.tracks,
      transitions: transitionsState.transitions,
      keyframes: keyframesState.keyframes,
      markers: markersState.markers,
      inPoint: markersState.inPoint,
      outPoint: markersState.outPoint,
      fps: settingsState.fps,
      scrollPosition: settingsState.scrollPosition,
      snapEnabled: settingsState.snapEnabled,
      isDirty: settingsState.isDirty,

      // Actions (static references, never change)
      setTracks: timelineActions.setTracks,
      addItem: timelineActions.addItem,
      addItems: timelineActions.addItems,
      updateItem: timelineActions.updateItem,
      removeItems: timelineActions.removeItems,
      rippleDeleteItems: timelineActions.rippleDeleteItems,
      closeGapAtPosition: timelineActions.closeGapAtPosition,
      closeAllGapsOnTrack: timelineActions.closeAllGapsOnTrack,
      toggleSnap: timelineActions.toggleSnap,
      setScrollPosition: timelineActions.setScrollPosition,
      moveItem: timelineActions.moveItem,
      moveItems: timelineActions.moveItems,
      moveItemsWithTrackChanges: timelineActions.moveItemsWithTrackChanges,
      duplicateItems: timelineActions.duplicateItems,
      duplicateItemsWithTrackChanges: timelineActions.duplicateItemsWithTrackChanges,
      trimItemStart: timelineActions.trimItemStart,
      trimItemEnd: timelineActions.trimItemEnd,
      rollingTrimItems: timelineActions.rollingTrimItems,
      rippleTrimItem: timelineActions.rippleTrimItem,
      splitItem: timelineActions.splitItem,
      splitItemAtFrames: timelineActions.splitItemAtFrames,
      joinItems: timelineActions.joinItems,
      rateStretchItem: timelineActions.rateStretchItem,
      resetSpeedWithRipple: timelineActions.resetSpeedWithRipple,
      setInPoint: timelineActions.setInPoint,
      setOutPoint: timelineActions.setOutPoint,
      clearInOutPoints: timelineActions.clearInOutPoints,
      addMarker: timelineActions.addMarker,
      updateMarker: timelineActions.updateMarker,
      removeMarker: timelineActions.removeMarker,
      clearAllMarkers: timelineActions.clearAllMarkers,
      updateItemTransform: timelineActions.updateItemTransform,
      resetItemTransform: timelineActions.resetItemTransform,
      updateItemsTransform: timelineActions.updateItemsTransform,
      updateItemsTransformMap: timelineActions.updateItemsTransformMap,
      commitMaskEdit: timelineActions.commitMaskEdit,
      addEffect: timelineActions.addEffect,
      addEffects: timelineActions.addEffects,
      updateEffect: timelineActions.updateEffect,
      removeEffect: timelineActions.removeEffect,
      toggleEffect: timelineActions.toggleEffect,
      addTransition: timelineActions.addTransition,
      updateTransition: timelineActions.updateTransition,
      updateTransitions: timelineActions.updateTransitions,
      removeTransition: timelineActions.removeTransition,
      addKeyframe: timelineActions.addKeyframe,
      addKeyframes: timelineActions.addKeyframes,
      updateKeyframe: timelineActions.updateKeyframe,
      applyAutoKeyframeOperations: timelineActions.applyAutoKeyframeOperations,
      removeKeyframe: timelineActions.removeKeyframe,
      removeKeyframesForItem: timelineActions.removeKeyframesForItem,
      removeKeyframesForProperty: timelineActions.removeKeyframesForProperty,
      getKeyframesForItem: timelineActions.getKeyframesForItem,
      hasKeyframesAtFrame: timelineActions.hasKeyframesAtFrame,
      repairLegacyAvTracks: timelineActions.repairLegacyAvTracks,
      clearTimeline: timelineActions.clearTimeline,
      markDirty: timelineActions.markDirty,
      markClean: timelineActions.markClean,
      saveTimeline,
      loadTimeline,
    };
  }

  return cachedSnapshot;
}

/**
 * Subscribe to combined state changes.
 * Creates subscriptions to all domain stores.
 */
function subscribeToCombinedState(callback: () => void): () => void {
  const unsubItems = useItemsStore.subscribe(callback);
  const unsubTransitions = useTransitionsStore.subscribe(callback);
  const unsubKeyframes = useKeyframesStore.subscribe(callback);
  const unsubMarkers = useMarkersStore.subscribe(callback);
  const unsubSettings = useTimelineSettingsStore.subscribe(callback);

  return () => {
    unsubItems();
    unsubTransitions();
    unsubKeyframes();
    unsubMarkers();
    unsubSettings();
  };
}

// Type for the facade store
type TimelineStoreFacade = {
  <T>(selector: (state: TimelineState & TimelineActions) => T): T;
  getState: () => TimelineState & TimelineActions;
  setState: (partial: Partial<TimelineState>) => void;
  subscribe: (listener: () => void) => () => void;
  temporal: {
    getState: () => {
      undo: () => void;
      redo: () => void;
      clear: () => void;
      pastStates: unknown[];
      futureStates: unknown[];
    };
  };
};

/**
 * Create the facade store hook.
 * This mimics Zustand's API for backward compatibility.
 */
function createTimelineStoreFacade(): TimelineStoreFacade {
  // The main hook function — uses selector memoization so components only
  // re-render when their *selected* value changes, not on every domain change.
  function useTimelineStore<T>(selector: (state: TimelineState & TimelineActions) => T): T {
    const selectorRef = useRef(selector);
    const lastSnapshotRef = useRef<(TimelineState & TimelineActions) | null>(null);
    const lastSelectionRef = useRef<T | undefined>(undefined);

    // Always keep the latest selector in the ref so the stable getSelection
    // callback below can access it during subscription notifications.
    selectorRef.current = selector;

    // Stable callback: compares the selected value across snapshot changes.
    // If the selector returns the same value (via Object.is), the previous
    // reference is returned — useSyncExternalStore sees no change and skips
    // the re-render for this component.
    const getSelection = useCallback((): T => {
      const snapshot = getSnapshot();

      // Snapshot reference unchanged â†’ selection unchanged
      if (lastSnapshotRef.current === snapshot && lastSelectionRef.current !== undefined) {
        return lastSelectionRef.current;
      }

      const nextSelection = selectorRef.current(snapshot);

      // Selected value unchanged despite new snapshot (e.g. markers changed
      // but this component only selects items) â†’ reuse previous reference
      if (lastSelectionRef.current !== undefined && Object.is(lastSelectionRef.current, nextSelection)) {
        lastSnapshotRef.current = snapshot;
        return lastSelectionRef.current;
      }

      lastSnapshotRef.current = snapshot;
      lastSelectionRef.current = nextSelection;
      return nextSelection;
    }, []);

    return useSyncExternalStore(
      subscribeToCombinedState,
      getSelection,
      getSelection
    );
  }

  // Static methods
  useTimelineStore.getState = getSnapshot;

  useTimelineStore.setState = (partial: Partial<TimelineState>) => {
    const nextItems = 'items' in partial && partial.items !== undefined
      ? partial.items
      : useItemsStore.getState().items;
    const nextFps = 'fps' in partial && partial.fps !== undefined
      ? partial.fps
      : useTimelineSettingsStore.getState().fps;
    const markersState = useMarkersStore.getState();
    const nextInPoint = 'inPoint' in partial
      ? partial.inPoint ?? null
      : markersState.inPoint;
    const nextOutPoint = 'outPoint' in partial
      ? partial.outPoint ?? null
      : markersState.outPoint;
    const shouldSanitizeInOutPoints =
      ('inPoint' in partial)
      || ('outPoint' in partial)
      || ('items' in partial && partial.items !== undefined)
      || ('fps' in partial && partial.fps !== undefined);

    // Map partial state to appropriate domain stores
    if ('items' in partial && partial.items !== undefined) {
      useItemsStore.getState().setItems(partial.items);
    }
    if ('tracks' in partial && partial.tracks !== undefined) {
      useItemsStore.getState().setTracks(partial.tracks);
    }
    if ('transitions' in partial && partial.transitions !== undefined) {
      useTransitionsStore.getState().setTransitions(partial.transitions);
    }
    if ('keyframes' in partial && partial.keyframes !== undefined) {
      useKeyframesStore.getState().setKeyframes(partial.keyframes);
    }
    if ('markers' in partial && partial.markers !== undefined) {
      useMarkersStore.getState().setMarkers(partial.markers);
    }
    if ('fps' in partial && partial.fps !== undefined) {
      useTimelineSettingsStore.getState().setFps(partial.fps);
    }
    if ('scrollPosition' in partial && partial.scrollPosition !== undefined) {
      useTimelineSettingsStore.getState().setScrollPosition(partial.scrollPosition);
    }
    if ('snapEnabled' in partial && partial.snapEnabled !== undefined) {
      useTimelineSettingsStore.getState().setSnapEnabled(partial.snapEnabled);
    }
    if ('isDirty' in partial && partial.isDirty !== undefined) {
      useTimelineSettingsStore.getState().setIsDirty(partial.isDirty);
    }
    if (shouldSanitizeInOutPoints) {
      const sanitizedInOutPoints = sanitizeInOutPoints({
        inPoint: nextInPoint,
        outPoint: nextOutPoint,
        maxFrame: getEffectiveTimelineMaxFrame(nextItems, nextFps),
      });
      useMarkersStore.getState().setInPoint(sanitizedInOutPoints.inPoint);
      useMarkersStore.getState().setOutPoint(sanitizedInOutPoints.outPoint);
    }
  };

  useTimelineStore.subscribe = subscribeToCombinedState;

  // Temporal compatibility - maps to command store
  useTimelineStore.temporal = {
    getState: () => ({
      undo: useTimelineCommandStore.getState().undo,
      redo: useTimelineCommandStore.getState().redo,
      clear: useTimelineCommandStore.getState().clearHistory,
      pastStates: useTimelineCommandStore.getState().undoStack,
      futureStates: useTimelineCommandStore.getState().redoStack,
    }),
  };

  return useTimelineStore as TimelineStoreFacade;
}

// Export the facade
export const useTimelineStore = createTimelineStoreFacade();

// Re-export actions for direct use
export * from './timeline-actions';
