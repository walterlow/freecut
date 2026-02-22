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
import type { ItemKeyframes } from '@/types/keyframe';
import type { TimelineItem, TimelineTrack } from '@/types/timeline';
import type { Transition } from '@/types/transition';

import { createLogger } from '@/lib/logger';
import { DEFAULT_TRACK_HEIGHT } from '../constants';

const logger = createLogger('TimelineStore');

// Domain stores
import { useItemsStore } from './items-store';
import { useTransitionsStore } from './transitions-store';
import { useKeyframesStore } from './keyframes-store';
import { useMarkersStore } from './markers-store';
import { useTimelineSettingsStore } from './timeline-settings-store';
import { useTimelineCommandStore } from './timeline-command-store';
import { useCompositionsStore } from './compositions-store';
import { useCompositionNavigationStore } from './composition-navigation-store';

// Actions
import * as timelineActions from './timeline-actions';

// External dependencies for save/load
import { getProject, updateProject, saveThumbnail } from '@/lib/storage/indexeddb';
import { usePlaybackStore } from '@/features/preview/stores/playback-store';
import { useZoomStore } from './zoom-store';
import type { ProjectTimeline } from '@/types/project';
import { renderSingleFrame } from '@/features/export/utils/client-render-engine';
import { convertTimelineToComposition } from '@/features/export/utils/timeline-to-composition';
import { resolveMediaUrls } from '@/features/preview/utils/media-resolver';
import { validateMediaReferences } from '@/features/timeline/utils/media-validation';
import { useMediaLibraryStore } from '@/features/media-library/stores/media-library-store';
import { migrateProject, CURRENT_SCHEMA_VERSION } from '@/lib/migrations';


/**
 * Save timeline to project in IndexedDB.
 */
async function saveTimeline(projectId: string): Promise<void> {
  // If currently editing a sub-composition, navigate back to root to save
  // the main timeline data, then re-enter after save completes.
  const navStore = useCompositionNavigationStore.getState();
  const previousCompositionId = navStore.activeCompositionId;
  const previousLabel = previousCompositionId
    ? navStore.breadcrumbs.find((b) => b.compositionId === previousCompositionId)?.label ?? ''
    : '';
  if (previousCompositionId !== null) {
    navStore.resetToRoot();
  }

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
              ...(k.easingConfig && { easingConfig: k.easingConfig }),
            })),
          })),
        })),
      }),
      // Sub-compositions (pre-comps)
      ...(() => {
        const comps = useCompositionsStore.getState().compositions;
        if (comps.length === 0) return {};
        return {
          compositions: comps.map((c) => ({
            id: c.id,
            name: c.name,
            items: c.items as ProjectTimeline['items'],
            tracks: c.tracks as ProjectTimeline['tracks'],
            ...(c.transitions?.length && { transitions: c.transitions as ProjectTimeline['transitions'] }),
            ...(c.keyframes?.length && { keyframes: c.keyframes as ProjectTimeline['keyframes'] }),
            fps: c.fps,
            width: c.width,
            height: c.height,
            durationInFrames: c.durationInFrames,
            ...(c.backgroundColor && { backgroundColor: c.backgroundColor }),
          })),
        };
      })(),
    };

    // Generate thumbnail using the client render engine (renders all layers)
    let thumbnailId: string | undefined;
    if (itemsState.items.length > 0) {
      try {
        const fps = project.metadata?.fps || 30;
        const width = project.metadata?.width || 1920;
        const height = project.metadata?.height || 1080;
        const backgroundColor = project.metadata?.backgroundColor;

        // Convert timeline to Composition composition format
        const composition = convertTimelineToComposition(
          itemsState.tracks,
          itemsState.items,
          transitionsState.transitions,
          fps,
          width,
          height,
          null, // inPoint - render full timeline
          null, // outPoint
          keyframesState.keyframes,
          backgroundColor
        );

        // Resolve media URLs (convert mediaId to blob URLs)
        const resolvedTracks = await resolveMediaUrls(composition.tracks);
        const resolvedComposition = { ...composition, tracks: resolvedTracks };

        // Calculate thumbnail dimensions preserving project aspect ratio
        // Fit within 320x180 bounds while maintaining aspect ratio
        const maxThumbWidth = 320;
        const maxThumbHeight = 180;
        const projectAspectRatio = width / height;
        const targetAspectRatio = maxThumbWidth / maxThumbHeight;

        let thumbWidth: number;
        let thumbHeight: number;
        if (projectAspectRatio > targetAspectRatio) {
          // Wider than 16:9 - constrained by width
          thumbWidth = maxThumbWidth;
          thumbHeight = Math.round(maxThumbWidth / projectAspectRatio);
        } else {
          // Taller than 16:9 (portrait) - constrained by height
          thumbHeight = maxThumbHeight;
          thumbWidth = Math.round(maxThumbHeight * projectAspectRatio);
        }

        // Render single frame at current playhead position
        const thumbnailBlob = await renderSingleFrame({
          composition: resolvedComposition,
          frame: currentFrame,
          width: thumbWidth,
          height: thumbHeight,
          quality: 0.85,
          format: 'image/jpeg',
        });

        // Save thumbnail to IndexedDB
        thumbnailId = `project:${projectId}:cover`;
        await saveThumbnail({
          id: thumbnailId,
          mediaId: projectId,
          blob: thumbnailBlob,
          timestamp: Date.now(),
          width: thumbWidth,
          height: thumbHeight,
        });
      } catch (thumbError) {
        // Thumbnail generation failure shouldn't block save
        logger.warn('Failed to generate thumbnail:', thumbError);
      }
    }

    // Update project
    // Clear deprecated thumbnail field when using thumbnailId to save space
    await updateProject(projectId, {
      timeline,
      ...(thumbnailId && { thumbnailId, thumbnail: undefined }),
      updatedAt: Date.now(),
    });

    // Mark as clean after successful save
    useTimelineSettingsStore.getState().markClean();

    // Re-enter the sub-composition the user was editing before save
    if (previousCompositionId !== null) {
      useCompositionNavigationStore.getState().enterComposition(previousCompositionId, previousLabel);
    }
  } catch (error) {
    logger.error('Failed to save timeline:', error);
    // Re-enter even on failure so user doesn't lose their editing context
    if (previousCompositionId !== null) {
      useCompositionNavigationStore.getState().enterComposition(previousCompositionId, previousLabel);
    }
    throw error;
  }
}

/**
 * Load timeline from project in IndexedDB.
 * Single source of truth for all timeline loading (project open, refresh, etc.)
 *
 * This function:
 * 1. Loads the project from storage
 * 2. Runs migrations if the project schema is outdated
 * 3. Normalizes data to apply current defaults
 * 4. Persists migrated projects back to storage
 * 5. Restores timeline state to stores
 */
async function loadTimeline(projectId: string): Promise<void> {
  // Mark loading started - used to coordinate initial player sync
  useTimelineSettingsStore.getState().setTimelineLoading(true);

  try {
    const rawProject = await getProject(projectId);
    if (!rawProject) {
      throw new Error(`Project not found: ${projectId}`);
    }

    // Run migrations and normalization
    const migrationResult = migrateProject(rawProject);
    const project = migrationResult.project;

    // Log migration activity
    if (migrationResult.migrated) {
      if (migrationResult.appliedMigrations.length > 0) {
        logger.info(
          `Migrated project from v${migrationResult.fromVersion} to v${migrationResult.toVersion}`,
          { migrations: migrationResult.appliedMigrations }
        );
      } else {
        logger.debug('Project normalized with current defaults');
      }

      // Persist migrated project back to storage
      await updateProject(projectId, {
        ...project,
        schemaVersion: CURRENT_SCHEMA_VERSION,
      });
      logger.debug('Saved migrated project to storage');
    }

    if (project.timeline && project.timeline.tracks?.length > 0) {
      const t = project.timeline;

      logger.debug('loadTimeline: loading existing timeline', {
        tracksCount: t.tracks?.length ?? 0,
        itemsCount: t.items?.length ?? 0,
        keyframesCount: t.keyframes?.length ?? 0,
        transitionsCount: t.transitions?.length ?? 0,
        schemaVersion: project.schemaVersion ?? 1,
      });

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
      useTimelineSettingsStore.getState().setScrollPosition(t.scrollPosition || 0);

      // Restore sub-compositions
      if (t.compositions && t.compositions.length > 0) {
        useCompositionsStore.getState().setCompositions(
          t.compositions.map((c) => ({
            id: c.id,
            name: c.name,
            items: c.items as TimelineItem[],
            tracks: c.tracks as TimelineTrack[],
            transitions: (c.transitions ?? []) as Transition[],
            keyframes: (c.keyframes ?? []) as ItemKeyframes[],
            fps: c.fps,
            width: c.width,
            height: c.height,
            durationInFrames: c.durationInFrames,
            ...(c.backgroundColor && { backgroundColor: c.backgroundColor }),
          }))
        );
      } else {
        useCompositionsStore.getState().setCompositions([]);
      }

      // Reset composition navigation to root on load
      useCompositionNavigationStore.getState().resetToRoot();

      // Restore zoom and playback
      if (t.zoomLevel !== undefined) {
        useZoomStore.getState().setZoomLevel(t.zoomLevel);
      } else {
        useZoomStore.getState().setZoomLevel(1);
      }
      if (t.currentFrame !== undefined) {
        usePlaybackStore.getState().setCurrentFrame(t.currentFrame);
      } else {
        usePlaybackStore.getState().setCurrentFrame(0);
      }
    } else {
      logger.debug('loadTimeline: initializing new project with default track');

      // Initialize with default tracks for new projects
      useItemsStore.getState().setTracks([
        {
          id: 'track-1',
          name: 'Track 1',
          height: DEFAULT_TRACK_HEIGHT,
          locked: false,
          visible: true,
          muted: false,
          solo: false,
          order: 0,
          items: [],
        },
      ]);
      useItemsStore.getState().setItems([]);
      useTransitionsStore.getState().setTransitions([]);
      useTransitionsStore.getState().setPendingBreakages([]);
      useKeyframesStore.getState().setKeyframes([]);
      useMarkersStore.getState().setMarkers([]);
      useMarkersStore.getState().setInPoint(null);
      useMarkersStore.getState().setOutPoint(null);
      useCompositionsStore.getState().setCompositions([]);
      useCompositionNavigationStore.getState().resetToRoot();
      useTimelineSettingsStore.getState().setScrollPosition(0);
      useZoomStore.getState().setZoomLevel(1);
      usePlaybackStore.getState().setCurrentFrame(0);
    }

    // Common setup for both cases
    // fps is stored in project.metadata, not timeline
    useTimelineSettingsStore.getState().setFps(project.metadata?.fps || 30);
    // snapEnabled is UI state, default to true
    useTimelineSettingsStore.getState().setSnapEnabled(true);
    useTimelineSettingsStore.getState().markClean();

    // Clear undo history when loading
    useTimelineCommandStore.getState().clearHistory();

    // Validate media references after loading timeline
    const loadedItems = useItemsStore.getState().items;
    const orphans = await validateMediaReferences(loadedItems, projectId);
    if (orphans.length > 0) {
      logger.warn(`Found ${orphans.length} orphaned clip(s) referencing deleted media`);
      useMediaLibraryStore.getState().setOrphanedClips(orphans);
      useMediaLibraryStore.getState().openOrphanedClipsDialog();
    }

    // Mark loading complete - signals player sync can proceed
    useTimelineSettingsStore.getState().setTimelineLoading(false);
  } catch (error) {
    logger.error('Failed to load timeline:', error);
    // Still mark loading complete on error so UI isn't stuck
    useTimelineSettingsStore.getState().setTimelineLoading(false);
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
      createGroup: timelineActions.createGroup,
      ungroup: timelineActions.ungroup,
      toggleGroupCollapse: timelineActions.toggleGroupCollapse,
      addToGroup: timelineActions.addToGroup,
      removeFromGroup: timelineActions.removeFromGroup,
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
      duplicateItems: timelineActions.duplicateItems,
      trimItemStart: timelineActions.trimItemStart,
      trimItemEnd: timelineActions.trimItemEnd,
      rollingTrimItems: timelineActions.rollingTrimItems,
      rippleTrimItem: timelineActions.rippleTrimItem,
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

      // Snapshot reference unchanged → selection unchanged
      if (lastSnapshotRef.current === snapshot && lastSelectionRef.current !== undefined) {
        return lastSelectionRef.current;
      }

      const nextSelection = selectorRef.current(snapshot);

      // Selected value unchanged despite new snapshot (e.g. markers changed
      // but this component only selects items) → reuse previous reference
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

// Re-export actions for direct use
export * from './timeline-actions';
