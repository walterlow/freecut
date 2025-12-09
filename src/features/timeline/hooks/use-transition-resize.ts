import { useState, useCallback, useRef, useEffect } from 'react';
import type { Transition } from '@/types/transition';
import { TRANSITION_CONFIGS } from '@/types/transition';
import { useTimelineStore } from '../stores/timeline-store';
import { useTimelineZoom } from './use-timeline-zoom';
import type { TimelineState, TimelineActions } from '../types';

export type ResizeHandle = 'left' | 'right';

interface ResizeState {
  isResizing: boolean;
  handle: ResizeHandle | null;
  startX: number;
  initialDuration: number;
  currentDelta: number;
}

/**
 * Hook for handling transition duration resizing via drag handles.
 *
 * Optimized approach:
 * - Visual feedback via local state during drag (no store updates)
 * - Only commit to store on mouseup (single undo entry)
 * - Smooth performance with RAF updates
 * - Respects min/max duration constraints
 */
export function useTransitionResize(transition: Transition) {
  const { pixelsToTime } = useTimelineZoom();
  const fps = useTimelineStore((s: TimelineState) => s.fps);
  const updateTransition = useTimelineStore(
    (s: TimelineActions) => s.updateTransition
  );

  const config = TRANSITION_CONFIGS[transition.type];

  const [resizeState, setResizeState] = useState<ResizeState>({
    isResizing: false,
    handle: null,
    startX: 0,
    initialDuration: 0,
    currentDelta: 0,
  });

  const resizeStateRef = useRef(resizeState);
  resizeStateRef.current = resizeState;

  // Mouse move handler - updates local state for visual feedback
  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!resizeStateRef.current.isResizing) return;

      const deltaX = e.clientX - resizeStateRef.current.startX;
      const deltaTime = pixelsToTime(deltaX);
      let deltaFrames = Math.round(deltaTime * fps);

      // When dragging left handle to the left, we're increasing duration
      // When dragging right handle to the right, we're increasing duration
      // Left handle: negative deltaX = increase duration
      // Right handle: positive deltaX = increase duration
      if (resizeStateRef.current.handle === 'left') {
        deltaFrames = -deltaFrames;
      }

      // Calculate new duration and clamp
      const newDuration = Math.max(
        config.minDuration,
        Math.min(config.maxDuration, resizeStateRef.current.initialDuration + deltaFrames)
      );
      const clampedDelta = newDuration - resizeStateRef.current.initialDuration;

      setResizeState((prev) => ({
        ...prev,
        currentDelta: clampedDelta,
      }));
    },
    [pixelsToTime, fps, config.minDuration, config.maxDuration]
  );

  // Mouse up handler - commits changes to store
  const handleMouseUp = useCallback(() => {
    if (!resizeStateRef.current.isResizing) return;

    const { initialDuration, currentDelta } = resizeStateRef.current;
    const newDuration = initialDuration + currentDelta;

    // Only update if duration actually changed
    if (currentDelta !== 0) {
      updateTransition(transition.id, { durationInFrames: newDuration });
    }

    setResizeState({
      isResizing: false,
      handle: null,
      startX: 0,
      initialDuration: 0,
      currentDelta: 0,
    });

    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }, [transition.id, updateTransition]);

  // Start resizing
  const handleResizeStart = useCallback(
    (e: React.MouseEvent, handle: ResizeHandle) => {
      e.preventDefault();
      e.stopPropagation();

      setResizeState({
        isResizing: true,
        handle,
        startX: e.clientX,
        initialDuration: transition.durationInFrames,
        currentDelta: 0,
      });

      document.body.style.cursor = 'ew-resize';
      document.body.style.userSelect = 'none';
    },
    [transition.durationInFrames]
  );

  // Add/remove global listeners
  useEffect(() => {
    if (resizeState.isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);

      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [resizeState.isResizing, handleMouseMove, handleMouseUp]);

  return {
    isResizing: resizeState.isResizing,
    resizeHandle: resizeState.handle,
    resizeDelta: resizeState.currentDelta,
    handleResizeStart,
    /** Preview duration during resize */
    previewDuration: resizeState.isResizing
      ? resizeState.initialDuration + resizeState.currentDelta
      : transition.durationInFrames,
  };
}
