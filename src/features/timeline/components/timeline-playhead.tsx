// React and external libraries
import { useState, useCallback, useEffect, useRef, useLayoutEffect } from 'react';

// Stores and selectors
import { usePlaybackStore } from '@/shared/state/playback';
import { useSelectionStore } from '@/shared/state/selection';

// Utilities and hooks
import { useTimelineZoomContext } from '../contexts/timeline-zoom-context';
import { createScrubThrottleState, shouldCommitScrubFrame } from '../utils/scrub-throttle';

interface TimelinePlayheadProps {
  inRuler?: boolean; // If true, shows diamond indicator for ruler
  maxFrame?: number; // Maximum frame the playhead can be dragged to (content duration)
}

/**
 * Timeline Playhead Component
 *
 * Renders the playhead indicator that shows the current frame position
 * - Vertical line across all tracks
 * - Diamond indicator in ruler when inRuler=true
 * - Synchronized with playback store via manual subscription (no re-renders during playback)
 * - Draggable for scrubbing through timeline
 */
export function TimelinePlayhead({ inRuler = false, maxFrame }: TimelinePlayheadProps) {
  // Don't subscribe to currentFrame - use ref + manual subscription instead
  const setCurrentFrame = usePlaybackStore((s) => s.setCurrentFrame);
  const { frameToPixels, pixelsToFrame, pixelsPerSecond } = useTimelineZoomContext();

  const [isDragging, setIsDragging] = useState(false);
  const [isExternalDrag, setIsExternalDrag] = useState(false);
  const playheadRef = useRef<HTMLDivElement>(null);

  // Track activeTool via ref subscription to avoid re-renders during playback
  // This prevents mode toggle from interrupting frame updates
  const activeToolRef = useRef(useSelectionStore.getState().activeTool);
  useEffect(() => {
    return useSelectionStore.subscribe((state) => {
      activeToolRef.current = state.activeTool;
    });
  }, []);

  // Use refs to avoid stale closures
  const pixelsToFrameRef = useRef(pixelsToFrame);
  const setCurrentFrameRef = useRef(setCurrentFrame);
  const maxFrameRef = useRef(maxFrame);
  const frameToPixelsRef = useRef(frameToPixels);
  const pixelsPerSecondRef = useRef(pixelsPerSecond);

  // RAF throttling refs for smooth scrubbing without excessive state updates
  const pendingFrameRef = useRef<number | null>(null);
  const pendingPointerXRef = useRef<number | null>(null);
  const rafIdRef = useRef<number | null>(null);
  const scrubThrottleStateRef = useRef(createScrubThrottleState({
    frame: usePlaybackStore.getState().currentFrame,
    nowMs: performance.now(),
  }));
  const setPreviewFrameRef = useRef(usePlaybackStore.getState().setPreviewFrame);
  useEffect(() => {
    return usePlaybackStore.subscribe((state) => {
      setPreviewFrameRef.current = state.setPreviewFrame;
    });
  }, []);

  // Update refs when functions change
  useEffect(() => {
    pixelsToFrameRef.current = pixelsToFrame;
    setCurrentFrameRef.current = setCurrentFrame;
    maxFrameRef.current = maxFrame;
    frameToPixelsRef.current = frameToPixels;
    pixelsPerSecondRef.current = pixelsPerSecond;
  }, [pixelsToFrame, setCurrentFrame, maxFrame, frameToPixels, pixelsPerSecond]);

  // Subscribe to currentFrame changes and update position directly (no React re-renders)
  useEffect(() => {
    const updatePosition = (frame: number) => {
      if (!playheadRef.current) return;
      const leftPosition = Math.round(frameToPixelsRef.current(frame));
      playheadRef.current.style.left = `${leftPosition}px`;
    };

    // Initial update
    updatePosition(usePlaybackStore.getState().currentFrame);

    // Subscribe to store changes
    return usePlaybackStore.subscribe((state) => {
      updatePosition(state.currentFrame);
    });
  }, []);

  // Also update position when frameToPixels changes (zoom changes)
  useLayoutEffect(() => {
    if (!playheadRef.current) return;
    const frame = usePlaybackStore.getState().currentFrame;
    const leftPosition = Math.round(frameToPixels(frame));
    playheadRef.current.style.left = `${leftPosition}px`;
  }, [frameToPixels]);

  // Track external drag operations to disable pointer events on hit areas
  useEffect(() => {
    const handleDragStart = () => setIsExternalDrag(true);
    const handleDragEnd = () => setIsExternalDrag(false);

    document.addEventListener('dragstart', handleDragStart);
    document.addEventListener('dragend', handleDragEnd);
    document.addEventListener('drop', handleDragEnd);

    return () => {
      document.removeEventListener('dragstart', handleDragStart);
      document.removeEventListener('dragend', handleDragEnd);
      document.removeEventListener('drop', handleDragEnd);
    };
  }, []);

  // Handle drag start
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const container = inRuler
      ? playheadRef.current?.closest('.timeline-ruler')
      : playheadRef.current?.closest('.timeline-tracks');
    const rect = container?.getBoundingClientRect();
    const pointerX = rect ? e.clientX - rect.left : frameToPixelsRef.current(usePlaybackStore.getState().currentFrame);
    scrubThrottleStateRef.current = createScrubThrottleState({
      pointerX,
      frame: usePlaybackStore.getState().currentFrame,
      nowMs: performance.now(),
    });
    setIsDragging(true);
  }, [inRuler]);

  // Handle dragging
  useEffect(() => {
    if (!isDragging) return;

    // Apply grabbing cursor globally to prevent flickering
    const originalCursor = document.body.style.cursor;
    document.body.style.cursor = 'grabbing';

    const handleMouseMove = (e: MouseEvent) => {
      // Find the correct container based on where the playhead is rendered
      // - If in ruler: use .timeline-ruler as the container
      // - If in tracks: use .timeline-tracks as the container
      const container = inRuler
        ? playheadRef.current?.closest('.timeline-ruler')
        : playheadRef.current?.closest('.timeline-tracks');

      if (!container) return;

      const rect = container.getBoundingClientRect();
      const x = e.clientX - rect.left;

      // Convert pixel position to frame number using ref to avoid stale closure
      // Round to whole frames for pixel-perfect positioning
      // Clamp to [0, maxFrame] to keep playhead within content duration
      let frame = Math.max(0, Math.round(pixelsToFrameRef.current(x)));
      if (maxFrameRef.current !== undefined) {
        frame = Math.min(frame, maxFrameRef.current);
      }

      // RAF throttling: batch frame updates to max 60fps to reduce state updates
      pendingFrameRef.current = frame;
      pendingPointerXRef.current = x;

      if (rafIdRef.current === null) {
        rafIdRef.current = requestAnimationFrame(() => {
          rafIdRef.current = null;
          if (pendingFrameRef.current !== null && pendingPointerXRef.current !== null) {
            const targetFrame = pendingFrameRef.current;
            const pointerX = pendingPointerXRef.current;
            if (shouldCommitScrubFrame({
              state: scrubThrottleStateRef.current,
              pointerX,
              targetFrame,
              pixelsPerSecond: pixelsPerSecondRef.current,
              nowMs: performance.now(),
            })) {
              setCurrentFrameRef.current(targetFrame);
              setPreviewFrameRef.current(targetFrame);
            }
          }
        });
      }
    };

    const handleMouseUp = () => {
      const pendingFrame = pendingFrameRef.current;
      // Cancel any pending RAF before clearing preview to prevent resurrection
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }

      if (pendingFrame !== null) {
        setCurrentFrameRef.current(pendingFrame);
      }

      pendingFrameRef.current = null;
      pendingPointerXRef.current = null;
      setPreviewFrameRef.current(null);
      setIsDragging(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      // Restore original cursor
      document.body.style.cursor = originalCursor;
      // Cancel any pending RAF to prevent memory leaks
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
    };
  }, [isDragging, inRuler]); // Stable dependencies - no stale closures

  return (
    <div
      ref={playheadRef}
      className="absolute top-0 bottom-0"
      style={{
        // left is set via ref subscription in useEffect (no re-renders during playback)
        width: '2px',
        pointerEvents: 'none',
        zIndex: 9999,
      }}
    >

      {/* Playhead line - visible and prominent */}
      <div
        className="absolute inset-0 bg-timeline-playhead pointer-events-none"
        style={{
          boxShadow: '0 0 8px color-mix(in oklch, var(--color-timeline-playhead) 50%, transparent)',
        }}
      />

      {/* Diamond indicator in ruler - draggable handle */}
      {inRuler && (
        <>
          {/* Invisible larger hit area for diamond */}
          <div
            className="absolute"
            style={{
              top: '-12px',
              left: '50%',
              width: '20px',
              height: '20px',
              transform: 'translateX(-50%)',
              cursor: activeToolRef.current === 'razor' ? 'default' : isDragging ? 'grabbing' : 'grab',
              // Pass through pointer events in razor mode or during external drag operations
              pointerEvents: activeToolRef.current === 'razor' || isExternalDrag ? 'none' : 'auto',
              backgroundColor: 'transparent',
            }}
            onMouseDown={handleMouseDown}
          />
          {/* Visible diamond */}
          <div
            className="absolute bg-timeline-playhead pointer-events-none"
            style={{
              top: '-6px',
              left: '50%',
              width: '10px',
              height: '10px',
              boxShadow: '0 0 8px color-mix(in oklch, var(--color-timeline-playhead) 50%, transparent)',
              transform: 'translateX(-50%) rotate(45deg)',
              transformOrigin: 'center',
            }}
          />
        </>
      )}
    </div>
  );
}
