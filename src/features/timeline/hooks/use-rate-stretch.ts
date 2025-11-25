import { useState, useCallback, useRef, useEffect } from 'react';
import type { TimelineItem } from '@/types/timeline';
import { useTimelineStore } from '../stores/timeline-store';
import { useTimelineZoom } from './use-timeline-zoom';

export type StretchHandle = 'start' | 'end';

// Speed limits
export const MIN_SPEED = 0.1;
export const MAX_SPEED = 10.0;

interface StretchState {
  isStretching: boolean;
  handle: StretchHandle | null;
  startX: number;
  initialFrom: number;
  initialDuration: number;
  sourceDuration: number;
  initialSpeed: number;
  currentDelta: number; // Track current delta for visual feedback
}

/**
 * Calculate duration limits based on speed constraints
 */
function getDurationLimits(sourceDuration: number): { min: number; max: number } {
  return {
    min: Math.max(1, Math.ceil(sourceDuration / MAX_SPEED)),
    max: Math.floor(sourceDuration / MIN_SPEED),
  };
}

/**
 * Calculate speed from source duration and timeline duration
 */
function calculateSpeed(sourceDuration: number, timelineDuration: number): number {
  if (timelineDuration <= 0) return 1;
  const speed = sourceDuration / timelineDuration;
  return Math.max(MIN_SPEED, Math.min(MAX_SPEED, speed));
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
 */
export function useRateStretch(item: TimelineItem, trackLocked: boolean = false) {
  const { pixelsToTime } = useTimelineZoom();
  const fps = useTimelineStore((s) => s.fps);
  const rateStretchItem = useTimelineStore((s) => s.rateStretchItem);

  const [stretchState, setStretchState] = useState<StretchState>({
    isStretching: false,
    handle: null,
    startX: 0,
    initialFrom: 0,
    initialDuration: 0,
    sourceDuration: 0,
    initialSpeed: 1,
    currentDelta: 0,
  });

  const stretchStateRef = useRef(stretchState);
  stretchStateRef.current = stretchState;

  // Mouse move handler - only updates local state for visual feedback
  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!stretchStateRef.current.isStretching || trackLocked) return;

      const deltaX = e.clientX - stretchStateRef.current.startX;
      const deltaTime = pixelsToTime(deltaX);
      const deltaFrames = Math.round(deltaTime * fps);

      // Update local state for visual feedback
      if (deltaFrames !== stretchStateRef.current.currentDelta) {
        setStretchState(prev => ({ ...prev, currentDelta: deltaFrames }));
      }
    },
    [pixelsToTime, fps, trackLocked]
  );

  // Mouse up handler - commits changes to store (single update)
  const handleMouseUp = useCallback(() => {
    if (stretchStateRef.current.isStretching) {
      const { handle, initialFrom, initialDuration, sourceDuration, currentDelta } = stretchStateRef.current;
      const limits = getDurationLimits(sourceDuration);

      let newDuration: number;
      let newFrom: number;

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

      const newSpeed = calculateSpeed(sourceDuration, newDuration);

      // Only update store if there was actual change (compare rounded values)
      if (newDuration !== initialDuration) {
        rateStretchItem(item.id, newFrom, newDuration, newSpeed);
      }

      setStretchState({
        isStretching: false,
        handle: null,
        startX: 0,
        initialFrom: 0,
        initialDuration: 0,
        sourceDuration: 0,
        initialSpeed: 1,
        currentDelta: 0,
      });
    }
  }, [item.id, rateStretchItem]);

  // Setup and cleanup mouse event listeners
  useEffect(() => {
    if (stretchState.isStretching) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);

      return () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [stretchState.isStretching, handleMouseMove, handleMouseUp]);

  // Start stretch drag
  const handleStretchStart = useCallback(
    (e: React.MouseEvent, handle: StretchHandle) => {
      if (trackLocked) return;

      // Only works on video/audio items
      if (item.type !== 'video' && item.type !== 'audio') return;

      e.stopPropagation();
      e.preventDefault();

      // Calculate the "at normal speed" source duration
      // This is the content duration that will be preserved regardless of speed
      const currentSpeed = item.speed || 1;
      const sourceDuration = item.durationInFrames * currentSpeed;

      setStretchState({
        isStretching: true,
        handle,
        startX: e.clientX,
        initialFrom: item.from,
        initialDuration: item.durationInFrames,
        sourceDuration,
        initialSpeed: currentSpeed,
        currentDelta: 0,
      });
    },
    [item, trackLocked]
  );

  // Calculate visual feedback during stretch
  const getVisualFeedback = useCallback(() => {
    if (!stretchState.isStretching) return null;

    const { handle, initialFrom, initialDuration, sourceDuration, currentDelta } = stretchState;
    const limits = getDurationLimits(sourceDuration);

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

    const previewSpeed = calculateSpeed(sourceDuration, newDuration);

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
