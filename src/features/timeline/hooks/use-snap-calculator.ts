import { useMemo, useCallback } from 'react';
import type { SnapTarget } from '../types/drag';
import { useTimelineStore } from '../stores/timeline-store';
import { useTransitionsStore } from '../stores/transitions-store';
import { useZoomStore } from '../stores/zoom-store';
import { usePlaybackStore } from '@/features/preview/stores/playback-store';
import { useTimelineZoom } from './use-timeline-zoom';
import {
  generateGridSnapPoints,
  findNearestSnapTarget,
  calculateAdaptiveSnapThreshold,
} from '../utils/timeline-snap-utils';
import { BASE_SNAP_THRESHOLD_PIXELS } from '../constants';

// Helpers to get state on-demand without subscribing
// This is CRITICAL: useSnapCalculator is used by every TimelineItem via
// use-timeline-drag, use-timeline-trim, and use-rate-stretch hooks.
// Subscribing to items would cause ALL items to re-render when ANY item moves!
const getItemsOnDemand = () => useTimelineStore.getState().items;
const getTracksOnDemand = () => useTimelineStore.getState().tracks;

/**
 * Build a set of track IDs whose items should contribute snap targets.
 * Excludes: group tracks (hold no items), hidden tracks, children of
 * collapsed or hidden groups.
 */
function getVisibleTrackIds(): Set<string> {
  const tracks = getTracksOnDemand();
  const ids = new Set<string>();

  // Index groups by ID for quick lookup
  const groupById = new Map<string, { visible: boolean; collapsed: boolean }>();
  for (const t of tracks) {
    if (t.isGroup) {
      groupById.set(t.id, {
        visible: t.visible !== false,
        collapsed: !!t.isCollapsed,
      });
    }
  }

  for (const t of tracks) {
    if (t.isGroup) continue; // Groups hold no items
    if (t.visible === false) continue; // Explicitly hidden

    // Check parent group state
    if (t.parentTrackId) {
      const parent = groupById.get(t.parentTrackId);
      if (parent && (parent.collapsed || !parent.visible)) continue;
    }

    ids.add(t.id);
  }

  return ids;
}

/**
 * Advanced snap calculator hook
 *
 * Combines grid snapping (timeline markers) with magnetic snapping (item edges)
 * Magnetic snapping takes priority when both are within threshold
 *
 * Phase 2 enhancement over basic grid snapping
 *
 * @param timelineDuration - Total timeline duration in seconds
 * @param excludeItemIds - Item ID(s) to exclude from snap targets (for dragging items)
 *                         Accepts a single ID string or an array of IDs for group selection
 */
export function useSnapCalculator(
  timelineDuration: number,
  excludeItemIds: string | string[] | null
) {
  // Normalize to array for consistent handling
  const excludeIds = useMemo(() => {
    if (!excludeItemIds) return [];
    return Array.isArray(excludeItemIds) ? excludeItemIds : [excludeItemIds];
  }, [excludeItemIds]);
  // Get state with granular selectors
  // NOTE: Don't subscribe to items or currentFrame - read from store when needed to prevent re-renders
  const fps = useTimelineStore((s) => s.fps);
  const snapEnabled = useTimelineStore((s) => s.snapEnabled);
  const zoomLevel = useZoomStore((s) => s.level);
  const { pixelsPerSecond } = useTimelineZoom();

  /**
   * Calculate adaptive snap threshold in frames
   */
  const snapThresholdFrames = useMemo(() => {
    return calculateAdaptiveSnapThreshold(
      zoomLevel,
      BASE_SNAP_THRESHOLD_PIXELS,
      pixelsPerSecond,
      fps
    );
  }, [zoomLevel, pixelsPerSecond, fps]);

  /**
   * Generate snap targets on-demand (NOT memoized on items to avoid re-renders)
   * Called when calculateSnap is invoked, using current items from store
   */
  const generateSnapTargets = useCallback(() => {
    const items = getItemsOnDemand();
    const transitions = useTransitionsStore.getState().transitions;
    const visibleTrackIds = getVisibleTrackIds();
    const targets: SnapTarget[] = [];

    // 1. Grid snap points (timeline markers)
    const gridFrames = generateGridSnapPoints(timelineDuration, fps, zoomLevel);
    gridFrames.forEach((frame) => {
      targets.push({ frame, type: 'grid' });
    });

    // 2. Build sets of edges hidden by transitions.
    // In the overlap model, the left clip's end and right clip's start are
    // inside the transition zone and don't correspond to visible boundaries.
    // Suppress those edges and add the visual midpoint instead.
    const suppressEnd = new Set<string>();   // item IDs whose end edge is hidden
    const suppressStart = new Set<string>(); // item IDs whose start edge is hidden

    for (const t of transitions) {
      suppressEnd.add(t.leftClipId);
      suppressStart.add(t.rightClipId);

      // Add the visual midpoint of the transition as a snap target.
      // Midpoint = rightClip.from + ceil(transitionDuration / 2)
      const rightClip = items.find((i) => i.id === t.rightClipId);
      if (rightClip && visibleTrackIds.has(rightClip.trackId)) {
        const midpoint = rightClip.from + Math.ceil(t.durationInFrames / 2);
        targets.push({ frame: midpoint, type: 'item-start' });
      }
    }

    // 3. Magnetic snap points (item edges), skipping transition inner edges
    //    and items on hidden/collapsed tracks
    items
      .filter((item) => !excludeIds.includes(item.id) && visibleTrackIds.has(item.trackId))
      .forEach((item) => {
        // Item start (skip if this clip is the RIGHT side of a transition)
        if (!suppressStart.has(item.id)) {
          targets.push({
            frame: item.from,
            type: 'item-start',
            itemId: item.id,
          });
        }
        // Item end (skip if this clip is the LEFT side of a transition)
        if (!suppressEnd.has(item.id)) {
          targets.push({
            frame: item.from + item.durationInFrames,
            type: 'item-end',
            itemId: item.id,
          });
        }
      });

    return targets;
  }, [excludeIds, timelineDuration, fps, zoomLevel]);

  /**
   * Calculate snap for a given position
   * Checks both start and end positions of the item
   * Returns snapped position and snap information
   *
   * @param targetStartFrame - The proposed start frame of the item
   * @param itemDurationInFrames - Duration of the item in frames
   */
  const calculateSnap = useCallback((targetStartFrame: number, itemDurationInFrames: number) => {
    if (!snapEnabled) {
      return {
        snappedFrame: targetStartFrame,
        snapTarget: null,
        didSnap: false,
      };
    }

    // Calculate end frame
    const targetEndFrame = targetStartFrame + itemDurationInFrames;

    // Generate snap targets on-demand and add playhead
    const currentFrame = usePlaybackStore.getState().currentFrame;
    const allTargets: SnapTarget[] = [
      ...generateSnapTargets(),
      { frame: currentFrame, type: 'playhead' as const },
    ];

    // Find nearest snap target for start position
    const nearestStartTarget = findNearestSnapTarget(
      targetStartFrame,
      allTargets,
      snapThresholdFrames
    );

    // Find nearest snap target for end position
    const nearestEndTarget = findNearestSnapTarget(
      targetEndFrame,
      allTargets,
      snapThresholdFrames
    );

    // Determine which snap is stronger (closer)
    const startDistance = nearestStartTarget
      ? Math.abs(targetStartFrame - nearestStartTarget.frame)
      : Infinity;
    const endDistance = nearestEndTarget
      ? Math.abs(targetEndFrame - nearestEndTarget.frame)
      : Infinity;

    // Use the closest snap (prioritize magnetic snaps over grid snaps if distances are equal)
    if (startDistance < endDistance) {
      if (nearestStartTarget) {
        return {
          snappedFrame: nearestStartTarget.frame,
          snapTarget: nearestStartTarget,
          didSnap: true,
        };
      }
    } else if (endDistance < Infinity) {
      if (nearestEndTarget) {
        // Snap the end, so adjust start position accordingly
        const adjustedStartFrame = nearestEndTarget.frame - itemDurationInFrames;
        return {
          snappedFrame: adjustedStartFrame,
          snapTarget: nearestEndTarget,
          didSnap: true,
        };
      }
    }

    return {
      snappedFrame: targetStartFrame,
      snapTarget: null,
      didSnap: false,
    };
  }, [snapEnabled, generateSnapTargets, snapThresholdFrames]);

  /**
   * Get magnetic snap targets only (item edges, for visual guidelines)
   * Generated on-demand to avoid subscribing to items
   */
  const getMagneticSnapTargets = useCallback(() => {
    return generateSnapTargets().filter(
      (t) => t.type === 'item-start' || t.type === 'item-end'
    );
  }, [generateSnapTargets]);

  // For compatibility with existing code that expects a memoized array,
  // we generate it once. This won't update when items move, but that's
  // intentional to avoid re-renders. Fresh targets are used in calculateSnap.
  const magneticSnapTargets = useMemo(() => getMagneticSnapTargets(), [getMagneticSnapTargets]);

  return {
    calculateSnap,
    magneticSnapTargets,
    snapThresholdFrames,
    snapEnabled,
  };
}
