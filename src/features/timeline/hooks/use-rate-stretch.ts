import { useState, useCallback, useRef, useEffect, useEffectEvent } from 'react';
import type { TimelineItem } from '@/types/timeline';
import type { SnapTarget } from '../types/drag';
import { useTimelineStore } from '../stores/timeline-store';
import { useSelectionStore } from '@/features/editor/stores/selection-store';
import { useTimelineZoom } from './use-timeline-zoom';
import { useSnapCalculator } from './use-snap-calculator';
import {
  MIN_SPEED,
  MAX_SPEED,
  calculateSpeed,
  clampSpeed,
  sourceToTimelineFrames,
} from '../utils/source-calculations';

type StretchHandle = 'start' | 'end';

// For GIFs/images that loop, use generous duration limits (1 frame to ~10 minutes at 30fps)
const LOOPING_MEDIA_MAX_DURATION = 30 * 60 * 10; // 10 minutes at 30fps

interface StretchState {
  isStretching: boolean;
  handle: StretchHandle | null;
  startX: number;
  initialFrom: number;
  initialDuration: number;
  sourceDuration: number; // For GIFs: the natural animation duration (for speed reference)
  initialSpeed: number;
  currentDelta: number; // Track current delta for visual feedback
  isLoopingMedia: boolean; // GIFs and images can loop infinitely
}

/**
 * Calculate duration limits based on speed constraints
 * For looping media (GIFs), duration is independent of source - just has speed limits
 */
function getDurationLimits(sourceDuration: number, isLoopingMedia: boolean): { min: number; max: number } {
  if (isLoopingMedia) {
    // For GIFs: duration can be anything, speed is calculated from natural duration
    // min = natural duration at MAX_SPEED, max = very generous (user can extend freely)
    return {
      min: Math.max(1, Math.ceil(sourceDuration / MAX_SPEED)),
      max: LOOPING_MEDIA_MAX_DURATION,
    };
  }
  // For videos/audio: duration is constrained by source content
  // Use shared utility for source-to-timeline conversion
  return {
    min: Math.max(1, sourceToTimelineFrames(sourceDuration, MAX_SPEED)),
    max: sourceToTimelineFrames(sourceDuration, MIN_SPEED),
  };
}

/**
 * Calculate and clamp speed from source duration and timeline duration
 */
function getClampedSpeed(sourceDuration: number, timelineDuration: number): number {
  return clampSpeed(calculateSpeed(sourceDuration, timelineDuration));
}

/**
 * Hook for handling timeline item rate stretching
 *
 * Rate stretch changes playback speed by adjusting duration while preserving all content.
 * - Longer duration = slower playback
 * - Shorter duration = faster playback
 * - Speed range: 0.1x to 10x
 *
 * Optimized approach:
 * - Visual feedback via local state during drag (no store updates)
 * - Only commit to store on mouseup (single undo entry)
 * - Snapping support for stretch edges to grid and item boundaries
 */
export function useRateStretch(item: TimelineItem, timelineDuration: number, trackLocked: boolean = false) {
  const { pixelsToTime } = useTimelineZoom();
  const fps = useTimelineStore((s) => s.fps);
  const rateStretchItem = useTimelineStore((s) => s.rateStretchItem);
  const setDragState = useSelectionStore((s) => s.setDragState);

  // Get fresh item from store to ensure we have latest values after previous operations
  const getItemFromStore = useCallback(() => {
    return useTimelineStore.getState().items.find((i) => i.id === item.id) ?? item;
  }, [item.id]);

  // Use snap calculator - pass item.id to exclude self from magnetic snaps
  // Only use magnetic snap targets (item edges), not grid lines
  const { magneticSnapTargets, snapThresholdFrames, snapEnabled } = useSnapCalculator(
    timelineDuration,
    item.id
  );

  const [stretchState, setStretchState] = useState<StretchState>({
    isStretching: false,
    handle: null,
    startX: 0,
    initialFrom: 0,
    initialDuration: 0,
    sourceDuration: 0,
    initialSpeed: 1,
    currentDelta: 0,
    isLoopingMedia: false,
  });

  const stretchStateRef = useRef(stretchState);
  stretchStateRef.current = stretchState;

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
  // Using useEffectEvent so changes to fps, trackLocked, etc. don't re-register listeners
  const onMouseMove = useEffectEvent((e: MouseEvent) => {
    if (!stretchStateRef.current.isStretching || trackLocked) return;

    const deltaX = e.clientX - stretchStateRef.current.startX;
    const deltaTime = pixelsToTime(deltaX);
    let deltaFrames = Math.round(deltaTime * fps);

    const { handle, initialFrom, initialDuration, sourceDuration, isLoopingMedia } = stretchStateRef.current;

    // For looping media (GIFs): don't change duration, only track delta for speed calculation
    // Dragging right = faster (positive delta), dragging left = slower (negative delta)
    if (isLoopingMedia) {
      // Update local state for speed calculation (duration stays same)
      if (deltaFrames !== stretchStateRef.current.currentDelta) {
        setStretchState(prev => ({ ...prev, currentDelta: deltaFrames }));
      }
      // No snap target visualization for GIFs since clip doesn't move
      return;
    }

    // For videos/audio: original behavior - change duration
    const limits = getDurationLimits(sourceDuration, isLoopingMedia);

    // Calculate the target edge position and apply snapping
    let targetEdgeFrame: number;
    if (handle === 'start') {
      // For start handle, we're moving the start position (compressing from left)
      // newDuration = initialDuration - deltaFrames
      // newFrom = initialFrom + (initialDuration - newDuration)
      // The edge that moves is the new start position: initialFrom + deltaFrames (when delta > 0, edge moves right)
      targetEdgeFrame = initialFrom + deltaFrames;
    } else {
      // For end handle, we're moving the end position
      // newDuration = initialDuration + deltaFrames
      // The edge that moves is the end: initialFrom + initialDuration + deltaFrames
      targetEdgeFrame = initialFrom + initialDuration + deltaFrames;
    }

    // Find snap target for the edge being stretched
    const { snappedFrame, snapTarget } = findSnapForFrame(targetEdgeFrame);

    // If snapped, adjust deltaFrames accordingly while respecting speed limits
    if (snapTarget) {
      if (handle === 'start') {
        // snappedFrame = initialFrom + newDelta
        const newDelta = snappedFrame - initialFrom;
        // Check if the resulting duration is within limits
        const proposedDuration = initialDuration - newDelta;
        if (proposedDuration >= limits.min && proposedDuration <= limits.max) {
          deltaFrames = newDelta;
        }
      } else {
        // snappedFrame = initialFrom + initialDuration + newDelta
        const newDelta = snappedFrame - (initialFrom + initialDuration);
        // Check if the resulting duration is within limits
        const proposedDuration = initialDuration + newDelta;
        if (proposedDuration >= limits.min && proposedDuration <= limits.max) {
          deltaFrames = newDelta;
        }
      }
    }

    // Update local state for visual feedback
    if (deltaFrames !== stretchStateRef.current.currentDelta) {
      setStretchState(prev => ({ ...prev, currentDelta: deltaFrames }));
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
  });

  // Mouse up handler - commits changes to store (single update)
  // Using useEffectEvent so changes to item.id, rateStretchItem don't re-register listeners
  const onMouseUp = useEffectEvent(() => {
    if (stretchStateRef.current.isStretching) {
      const { handle, initialFrom, initialDuration, sourceDuration, initialSpeed, currentDelta, isLoopingMedia } = stretchStateRef.current;

      let newDuration: number;
      let newFrom: number;
      let newSpeed: number;

      // For looping media (GIFs): only change speed, keep duration the same
      // Drag right = faster (positive delta increases speed)
      // Drag left = slower (negative delta decreases speed)
      if (isLoopingMedia) {
        newDuration = initialDuration; // Duration stays the same
        newFrom = initialFrom; // Position stays the same

        // Calculate speed change based on drag distance
        // Use a sensitivity factor: ~30 pixels per 0.1x speed change
        const speedDelta = currentDelta / 30 * 0.1;
        // Round to 2 decimal places for consistent precision
        newSpeed = Math.round(Math.max(MIN_SPEED, Math.min(MAX_SPEED, initialSpeed + speedDelta)) * 100) / 100;

        // Only update if speed actually changed
        if (Math.abs(newSpeed - initialSpeed) > 0.01) {
          rateStretchItem(item.id, newFrom, newDuration, newSpeed);
        }
      } else {
        // For videos/audio: original behavior - change duration and calculate speed
        const limits = getDurationLimits(sourceDuration, isLoopingMedia);

        if (handle === 'start') {
          // Start handle: delta right = compress (shorter duration), delta left = extend
          newDuration = Math.round(Math.max(limits.min, Math.min(limits.max, initialDuration - currentDelta)));
          const durationChange = initialDuration - newDuration;
          newFrom = Math.round(initialFrom + durationChange); // Maintain end position
        } else {
          // End handle: delta right = extend (longer duration), delta left = compress
          newDuration = Math.round(Math.max(limits.min, Math.min(limits.max, initialDuration + currentDelta)));
          newFrom = Math.round(initialFrom);
        }

        newSpeed = getClampedSpeed(sourceDuration, newDuration);

        // IMPORTANT: After rounding speed, verify the combination doesn't exceed source
        // Due to rounding (e.g., 1.4484 -> 1.45), duration * speed might exceed sourceDuration
        // If so, adjust duration down to ensure we stay within bounds
        const sourceFramesNeeded = Math.round(newDuration * newSpeed);
        if (sourceFramesNeeded > sourceDuration) {
          // Reduce duration to fit within source at this rounded speed
          newDuration = Math.floor(sourceDuration / newSpeed);
          // Adjust position if we were stretching from start
          if (handle === 'start') {
            const adjustedDurationChange = initialDuration - newDuration;
            newFrom = Math.round(initialFrom + adjustedDurationChange);
          }
        }

        // Only update store if there was actual change (compare rounded values)
        if (newDuration !== initialDuration) {
          rateStretchItem(item.id, newFrom, newDuration, newSpeed);
        }
      }

      // Clear drag state (including snap indicator)
      setDragState(null);
      prevSnapTargetRef.current = null;

      setStretchState({
        isStretching: false,
        handle: null,
        startX: 0,
        initialFrom: 0,
        initialDuration: 0,
        sourceDuration: 0,
        initialSpeed: 1,
        currentDelta: 0,
        isLoopingMedia: false,
      });
    }
  });

  // Setup and cleanup mouse event listeners
  // With useEffectEvent, we only need to depend on stretchState.isStretching
  useEffect(() => {
    if (stretchState.isStretching) {
      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);

      return () => {
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
      };
    }
  }, [stretchState.isStretching]);

  // Start stretch drag
  const handleStretchStart = useCallback(
    (e: React.MouseEvent, handle: StretchHandle) => {
      // Only respond to left mouse button
      if (e.button !== 0) return;
      if (trackLocked) return;

      // Get fresh item from store to ensure we have latest values after previous operations
      const currentItem = getItemFromStore();

      // Only works on video/audio/gif items
      const isGifImage = currentItem.type === 'image' && currentItem.label?.toLowerCase().endsWith('.gif');
      if (currentItem.type !== 'video' && currentItem.type !== 'audio' && !isGifImage) return;

      e.stopPropagation();
      e.preventDefault();

      const currentSpeed = currentItem.speed || 1;
      const isLoopingMedia = currentItem.type === 'image'; // GIFs (images) can loop infinitely

      // Use the actual available source frames for this clip
      // IMPORTANT: For split clips, use sourceEnd - sourceStart to limit rate stretch
      // to the clip's actual portion rather than the entire remaining source.
      // This makes rate stretching "per clip" - each split clip starts at speed 1 relative
      // to its own source boundaries.
      let sourceDuration: number;
      if (currentItem.sourceEnd !== undefined && currentItem.sourceStart !== undefined) {
        // For clips with defined source boundaries (including split clips),
        // use only the clip's actual portion
        sourceDuration = currentItem.sourceEnd - currentItem.sourceStart;
      } else if (currentItem.sourceDuration) {
        // For clips without explicit end, use remaining source from current position
        const sourceStart = currentItem.sourceStart ?? 0;
        sourceDuration = currentItem.sourceDuration - sourceStart;
      } else {
        // Last resort: estimate from current state
        sourceDuration = Math.round(currentItem.durationInFrames * currentSpeed);
      }

      setStretchState({
        isStretching: true,
        handle,
        startX: e.clientX,
        initialFrom: currentItem.from,
        initialDuration: currentItem.durationInFrames,
        sourceDuration,
        initialSpeed: currentSpeed,
        currentDelta: 0,
        isLoopingMedia,
      });
    },
    [trackLocked, getItemFromStore]
  );

  // Calculate visual feedback during stretch
  const getVisualFeedback = useCallback(() => {
    if (!stretchState.isStretching) return null;

    const { handle, initialFrom, initialDuration, sourceDuration, initialSpeed, currentDelta, isLoopingMedia } = stretchState;

    // For looping media (GIFs): duration and position stay the same, only speed changes
    if (isLoopingMedia) {
      const speedDelta = currentDelta / 30 * 0.1;
      // Round to 2 decimal places for consistent precision
      const previewSpeed = Math.round(Math.max(MIN_SPEED, Math.min(MAX_SPEED, initialSpeed + speedDelta)) * 100) / 100;

      return {
        from: initialFrom,
        duration: initialDuration,
        speed: previewSpeed,
      };
    }

    // For videos/audio: original behavior
    const limits = getDurationLimits(sourceDuration, isLoopingMedia);

    let newDuration: number;
    let newFrom: number;

    if (handle === 'start') {
      newDuration = Math.round(Math.max(limits.min, Math.min(limits.max, initialDuration - currentDelta)));
      const durationChange = initialDuration - newDuration;
      newFrom = Math.round(initialFrom + durationChange);
    } else {
      newDuration = Math.round(Math.max(limits.min, Math.min(limits.max, initialDuration + currentDelta)));
      newFrom = Math.round(initialFrom);
    }

    const previewSpeed = getClampedSpeed(sourceDuration, newDuration);

    // Apply same rounding fix as onMouseUp - adjust duration if rounded speed exceeds source
    const sourceFramesNeeded = Math.round(newDuration * previewSpeed);
    if (sourceFramesNeeded > sourceDuration) {
      newDuration = Math.floor(sourceDuration / previewSpeed);
      if (handle === 'start') {
        const adjustedDurationChange = initialDuration - newDuration;
        newFrom = Math.round(initialFrom + adjustedDurationChange);
      }
    }

    return {
      from: newFrom,
      duration: newDuration,
      speed: previewSpeed,
    };
  }, [stretchState]);

  return {
    isStretching: stretchState.isStretching,
    stretchHandle: stretchState.handle,
    stretchDelta: stretchState.currentDelta,
    handleStretchStart,
    getVisualFeedback,
  };
}
