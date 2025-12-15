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

import { useSyncExternalStore, useMemo } from 'react';
import type { TimelineState, TimelineActions } from '../types';
import type { ItemKeyframes } from '@/types/keyframe';
import type { TimelineItem, TimelineTrack } from '@/types/timeline';
import type { Transition } from '@/types/transition';

import { createLogger } from '@/lib/logger';

const logger = createLogger('TimelineStore');

// Domain stores
import { useItemsStore } from './items-store';
import { useTransitionsStore } from './transitions-store';
import { useKeyframesStore } from './keyframes-store';
import { useMarkersStore } from './markers-store';
import { useTimelineSettingsStore } from './timeline-settings-store';
import { useTimelineCommandStore } from './timeline-command-store';

// Actions
import * as timelineActions from './timeline-actions';

// External dependencies for save/load
import { getProject, updateProject } from '@/lib/storage/indexeddb';
import { usePlaybackStore } from '@/features/preview/stores/playback-store';
import { useZoomStore } from './zoom-store';
import { generatePlayheadThumbnail } from '@/features/projects/utils/thumbnail-generator';
import type { ProjectTimeline } from '@/types/project';


/**
 * Save timeline to project in IndexedDB.
 */
async function saveTimeline(projectId: string): Promise<void> {
  // Read directly from domain stores
  const itemsState = useItemsStore.getState();
  const transitionsState = useTransitionsStore.getState();
  const keyframesState = useKeyframesStore.getState();
  const markersState = useMarkersStore.getState();
  const currentFrame = usePlaybackStore.getState().currentFrame;
  const zoomLevel = useZoomStore.getState().level;

  try {
    const project = await getProject(projectId);
    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }

    const settingsState = useTimelineSettingsStore.getState();

    // Build timeline data (fps is stored in project.metadata, not timeline)
    const timeline: ProjectTimeline = {
      tracks: itemsState.tracks as ProjectTimeline['tracks'],
      items: itemsState.items as ProjectTimeline['items'],
      currentFrame,
      zoomLevel,
      scrollPosition: settingsState.scrollPosition,
      ...(markersState.inPoint !== null && { inPoint: markersState.inPoint }),
      ...(markersState.outPoint !== null && { outPoint: markersState.outPoint }),
      ...(markersState.markers.length > 0 && {
        markers: markersState.markers.map((m) => ({
          id: m.id,
          frame: m.frame,
          color: m.color,
          ...(m.label && { label: m.label }),
        })),
      }),
      ...(transitionsState.transitions.length > 0 && {
        transitions: transitionsState.transitions.map((t) => ({
          id: t.id,
          type: t.type,
          leftClipId: t.leftClipId,
          rightClipId: t.rightClipId,
          trackId: t.trackId,
          durationInFrames: t.durationInFrames,
          presentation: t.presentation,
          ...(t.timing && { timing: t.timing }),
          ...(t.direction && { direction: t.direction }),
        })),
      }),
      ...(keyframesState.keyframes.length > 0 && {
        keyframes: keyframesState.keyframes.map((ik) => ({
          itemId: ik.itemId,
          properties: ik.properties.map((pk) => ({
            property: pk.property,
            keyframes: pk.keyframes.map((k) => ({
              id: k.id,
              frame: k.frame,
              value: k.value,
              easing: k.easing,
            })),
          })),
        })),
      }),
    };

    // Generate thumbnail from current Player frame
    let thumbnail: string | undefined;
    if (itemsState.items.length > 0) {
      try {
        const captureFrame = usePlaybackStore.getState().captureFrame;
        if (captureFrame) {
          const capturedThumbnail = await captureFrame();
          if (capturedThumbnail) {
            thumbnail = capturedThumbnail;
          }
        } else {
          // Fallback to source-based thumbnail if Player isn't available
          const fps = project.metadata?.fps || 30;
          const playheadThumbnail = await generatePlayheadThumbnail(
            itemsState.items,
            itemsState.tracks,
            currentFrame,
            fps
          );
          if (playheadThumbnail) {
            thumbnail = playheadThumbnail;
          }
        }
      } catch (thumbError) {
        // Thumbnail generation failure shouldn't block save
        logger.warn('Failed to generate thumbnail:', thumbError);
      }
    }

    // Update project
    await updateProject(projectId, {
      timeline,
      ...(thumbnail && { thumbnail }),
      updatedAt: Date.now(),
    });

    // Mark as clean after successful save
    useTimelineSettingsStore.getState().markClean();
  } catch (error) {
    logger.error('Failed to save timeline:', error);
    throw error;
  }
}

/**
 * Load timeline from project in IndexedDB.
 */
async function loadTimeline(projectId: string): Promise<void> {
  try {
    const project = await getProject(projectId);
    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }

    if (project.timeline) {
      const t = project.timeline;

      // Restore tracks and items from project
      // Sort tracks by order property to preserve user's track arrangement
      const sortedTracks = [...(t.tracks || [])]
        .map((track, index) => ({ track, originalIndex: index }))
        .sort((a, b) => (a.track.order ?? a.originalIndex) - (b.track.order ?? b.originalIndex))
        .map(({ track }) => ({
          ...track,
          items: [], // Items are stored separately
        }));

      // Restore all state to domain stores
      useItemsStore.getState().setTracks(sortedTracks as TimelineTrack[]);
      useItemsStore.getState().setItems((t.items || []) as TimelineItem[]);
      useTransitionsStore.getState().setTransitions((t.transitions || []) as Transition[]);
      useTransitionsStore.getState().setPendingBreakages([]);
      useKeyframesStore.getState().setKeyframes((t.keyframes || []) as ItemKeyframes[]);
      useMarkersStore.getState().setMarkers(t.markers || []);
      useMarkersStore.getState().setInPoint(t.inPoint ?? null);
      useMarkersStore.getState().setOutPoint(t.outPoint ?? null);
      // fps is stored in project.metadata, not timeline
      useTimelineSettingsStore.getState().setFps(project.metadata?.fps || 30);
      useTimelineSettingsStore.getState().setScrollPosition(t.scrollPosition || 0);
      // snapEnabled is UI state, default to true
      useTimelineSettingsStore.getState().setSnapEnabled(true);
      useTimelineSettingsStore.getState().markClean();

      // Restore zoom and playback
      if (t.zoomLevel !== undefined) {
        useZoomStore.getState().setZoomLevel(t.zoomLevel);
      }
      if (t.currentFrame !== undefined) {
        usePlaybackStore.getState().setCurrentFrame(t.currentFrame);
      }

      // Clear undo history when loading
      useTimelineCommandStore.getState().clearHistory();
    }
  } catch (error) {
    logger.error('Failed to load timeline:', error);
    throw error;
  }
}

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
let lastPendingBreakagesRef: unknown = null;
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
    lastPendingBreakagesRef !== transitionsState.pendingBreakages ||
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
    lastPendingBreakagesRef = transitionsState.pendingBreakages;
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
      pendingBreakages: transitionsState.pendingBreakages,
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
      updateItem: timelineActions.updateItem,
      removeItems: timelineActions.removeItems,
      rippleDeleteItems: timelineActions.rippleDeleteItems,
      closeGapAtPosition: timelineActions.closeGapAtPosition,
      toggleSnap: timelineActions.toggleSnap,
      setScrollPosition: timelineActions.setScrollPosition,
      moveItem: timelineActions.moveItem,
      moveItems: timelineActions.moveItems,
      duplicateItems: timelineActions.duplicateItems,
      trimItemStart: timelineActions.trimItemStart,
      trimItemEnd: timelineActions.trimItemEnd,
      splitItem: timelineActions.splitItem,
      joinItems: timelineActions.joinItems,
      rateStretchItem: timelineActions.rateStretchItem,
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
      addEffect: timelineActions.addEffect,
      addEffects: timelineActions.addEffects,
      updateEffect: timelineActions.updateEffect,
      removeEffect: timelineActions.removeEffect,
      toggleEffect: timelineActions.toggleEffect,
      addTransition: timelineActions.addTransition,
      updateTransition: timelineActions.updateTransition,
      updateTransitions: timelineActions.updateTransitions,
      removeTransition: timelineActions.removeTransition,
      clearPendingBreakages: timelineActions.clearPendingBreakages,
      addKeyframe: timelineActions.addKeyframe,
      addKeyframes: timelineActions.addKeyframes,
      updateKeyframe: timelineActions.updateKeyframe,
      removeKeyframe: timelineActions.removeKeyframe,
      removeKeyframesForItem: timelineActions.removeKeyframesForItem,
      removeKeyframesForProperty: timelineActions.removeKeyframesForProperty,
      getKeyframesForItem: timelineActions.getKeyframesForItem,
      hasKeyframesAtFrame: timelineActions.hasKeyframesAtFrame,
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
  // The main hook function
  function useTimelineStore<T>(selector: (state: TimelineState & TimelineActions) => T): T {
    const state = useSyncExternalStore(
      subscribeToCombinedState,
      getSnapshot,
      getSnapshot
    );
    return selector(state);
  }

  // Static methods
  useTimelineStore.getState = getSnapshot;

  useTimelineStore.setState = (partial: Partial<TimelineState>) => {
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
    if ('pendingBreakages' in partial && partial.pendingBreakages !== undefined) {
      useTransitionsStore.getState().setPendingBreakages(partial.pendingBreakages);
    }
    if ('keyframes' in partial && partial.keyframes !== undefined) {
      useKeyframesStore.getState().setKeyframes(partial.keyframes);
    }
    if ('markers' in partial && partial.markers !== undefined) {
      useMarkersStore.getState().setMarkers(partial.markers);
    }
    if ('inPoint' in partial) {
      useMarkersStore.getState().setInPoint(partial.inPoint ?? null);
    }
    if ('outPoint' in partial) {
      useMarkersStore.getState().setOutPoint(partial.outPoint ?? null);
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

// =============================================================================
// MEMOIZED SELECTORS (re-export for backward compatibility)
// =============================================================================

/**
 * Memoized selector that returns keyframes as a Map for O(1) lookups by itemId.
 */
export function useKeyframeMap(): Map<string, ItemKeyframes> {
  const keyframes = useKeyframesStore((s) => s.keyframes);

  return useMemo(() => {
    const map = new Map<string, ItemKeyframes>();
    for (const kf of keyframes) {
      map.set(kf.itemId, kf);
    }
    return map;
  }, [keyframes]);
}

/**
 * Get keyframes for a specific item.
 */
export function useItemKeyframes(itemId: string): ItemKeyframes | undefined {
  return useKeyframesStore((s) =>
    s.keyframes.find((k) => k.itemId === itemId)
  );
}

// =============================================================================
// RE-EXPORTS for direct domain store access (optional, for new code)
// =============================================================================

export { useItemsStore } from './items-store';
export { useTransitionsStore } from './transitions-store';
export { useKeyframesStore } from './keyframes-store';
export { useMarkersStore } from './markers-store';
export { useTimelineSettingsStore } from './timeline-settings-store';
export { useTimelineCommandStore, useCanUndo, useCanRedo } from './timeline-command-store';

// Re-export actions for direct use
export * from './timeline-actions';
