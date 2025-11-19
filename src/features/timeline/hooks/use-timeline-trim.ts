import { useState, useCallback, useRef, useEffect } from 'react';
import type { TimelineItem } from '@/types/timeline';
import { useTimelineStore } from '../stores/timeline-store';
import { useTimelineZoom } from './use-timeline-zoom';

export type TrimHandle = 'start' | 'end';

interface TrimState {
  isTrimming: boolean;
  handle: TrimHandle | null;
  startX: number;
  initialFrom: number;
  initialDuration: number;
  currentDelta: number; // Track current delta for visual feedback
}

/**
 * Hook for handling timeline item trimming
 *
 * Optimized approach:
 * - Visual feedback via local state during drag (no store updates)
 * - Only commit to store on mouseup (single undo entry)
 * - Smooth performance with RAF updates
 */
export function useTimelineTrim(item: TimelineItem, trackLocked: boolean = false) {
  const { pixelsToTime } = useTimelineZoom();
  const fps = useTimelineStore((s) => s.fps);
  const trimItemStart = useTimelineStore((s) => s.trimItemStart);
  const trimItemEnd = useTimelineStore((s) => s.trimItemEnd);

  const [trimState, setTrimState] = useState<TrimState>({
    isTrimming: false,
    handle: null,
    startX: 0,
    initialFrom: 0,
    initialDuration: 0,
    currentDelta: 0,
  });

  const trimStateRef = useRef(trimState);
  trimStateRef.current = trimState;

  // Mouse move handler - only updates local state for visual feedback
  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!trimStateRef.current.isTrimming || trackLocked) return;

      const deltaX = e.clientX - trimStateRef.current.startX;
      const deltaTime = pixelsToTime(deltaX);
      const deltaFrames = Math.round(deltaTime * fps);

      // Update local state for visual feedback (doesn't trigger re-render of component)
      if (deltaFrames !== trimStateRef.current.currentDelta) {
        setTrimState(prev => ({ ...prev, currentDelta: deltaFrames }));
      }
    },
    [pixelsToTime, fps, trackLocked]
  );

  // Mouse up handler - commits changes to store (single update)
  const handleMouseUp = useCallback(() => {
    if (trimStateRef.current.isTrimming) {
      const deltaFrames = trimStateRef.current.currentDelta;

      // Only update store if there was actual change
      if (deltaFrames !== 0) {
        if (trimStateRef.current.handle === 'start') {
          trimItemStart(item.id, deltaFrames);
        } else if (trimStateRef.current.handle === 'end') {
          trimItemEnd(item.id, -deltaFrames);
        }
      }

      setTrimState({
        isTrimming: false,
        handle: null,
        startX: 0,
        initialFrom: 0,
        initialDuration: 0,
        currentDelta: 0,
      });
    }
  }, [item.id, trimItemStart, trimItemEnd]);

  // Setup and cleanup mouse event listeners
  useEffect(() => {
    if (trimState.isTrimming) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);

      return () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [trimState.isTrimming, handleMouseMove, handleMouseUp]);

  // Start trim drag
  const handleTrimStart = useCallback(
    (e: React.MouseEvent, handle: TrimHandle) => {
      if (trackLocked) return;

      e.stopPropagation();
      e.preventDefault();

      setTrimState({
        isTrimming: true,
        handle,
        startX: e.clientX,
        initialFrom: item.from,
        initialDuration: item.durationInFrames,
        currentDelta: 0,
      });
    },
    [item.from, item.durationInFrames, trackLocked]
  );

  return {
    isTrimming: trimState.isTrimming,
    trimHandle: trimState.handle,
    trimDelta: trimState.currentDelta,
    handleTrimStart,
  };
}
