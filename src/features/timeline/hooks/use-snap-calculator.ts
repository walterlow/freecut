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
  getFilteredItemSnapEdges,
} from '../utils/timeline-snap-utils';
import { getVisibleTrackIds } from '../utils/group-utils';
import { BASE_SNAP_THRESHOLD_PIXELS } from '../constants';

// Helpers to get state on-demand without subscribing
// This is CRITICAL: useSnapCalculator is used by every TimelineItem via
// use-timeline-drag, use-timeline-trim, and use-rate-stretch hooks.
// Subscribing to items would cause ALL items to re-render when ANY item moves!
const getItemsOnDemand = () => useTimelineStore.getState().items;
const getTracksOnDemand = () => useTimelineStore.getState().tracks;

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
    const visibleTrackIds = getVisibleTrackIds(getTracksOnDemand());
    const targets: SnapTarget[] = [];

    // 1. Grid snap points (timeline markers)
    const gridFrames = generateGridSnapPoints(timelineDuration, fps, zoomLevel);
    gridFrames.forEach((frame) => {
      targets.push({ frame, type: 'grid' });
    });

    // 2. Item edges + transition midpoints (filtered by visible tracks,
    //    transition inner edges suppressed, dragged items excluded)
    for (const edge of getFilteredItemSnapEdges(items, transitions, visibleTrackIds, excludeIds)) {
      targets.push(edge);
    }

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
    getMagneticSnapTargets,
    snapThresholdFrames,
    snapEnabled,
  };
}
