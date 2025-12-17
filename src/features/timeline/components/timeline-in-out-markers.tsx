// React and external libraries
import { useState, useCallback, useEffect, useRef, memo } from 'react';

// Stores and selectors
import { useTimelineStore } from '../stores/timeline-store';

// Utilities and hooks
import { useTimelineZoomContext } from '../contexts/timeline-zoom-context';

/**
 * Timeline In/Out Markers Component
 *
 * Renders in and out point markers on the timeline ruler
 * - Vertical bars with 'I' and 'O' flags
 * - Draggable for adjusting marker positions
 * - Synchronized with timeline store
 */
export const TimelineInOutMarkers = memo(function TimelineInOutMarkers() {
  const inPoint = useTimelineStore((s) => s.inPoint);
  const outPoint = useTimelineStore((s) => s.outPoint);
  const setInPoint = useTimelineStore((s) => s.setInPoint);
  const setOutPoint = useTimelineStore((s) => s.setOutPoint);
  const { frameToPixels, pixelsToFrame } = useTimelineZoomContext();

  const [isDraggingIn, setIsDraggingIn] = useState(false);
  const [isDraggingOut, setIsDraggingOut] = useState(false);
  const inMarkerRef = useRef<HTMLDivElement>(null);
  const outMarkerRef = useRef<HTMLDivElement>(null);

  // Use refs to avoid stale closures
  const pixelsToFrameRef = useRef(pixelsToFrame);
  const setInPointRef = useRef(setInPoint);
  const setOutPointRef = useRef(setOutPoint);

  // Update refs when functions change
  useEffect(() => {
    pixelsToFrameRef.current = pixelsToFrame;
    setInPointRef.current = setInPoint;
    setOutPointRef.current = setOutPoint;
  }, [pixelsToFrame, setInPoint, setOutPoint]);

  // Handle drag start for in-point
  const handleInMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingIn(true);
  }, []);

  // Handle drag start for out-point
  const handleOutMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOut(true);
  }, []);

  // Handle dragging in-point
  useEffect(() => {
    if (!isDraggingIn) return;

    const originalCursor = document.body.style.cursor;
    document.body.style.cursor = 'grabbing';

    const handleMouseMove = (e: MouseEvent) => {
      const container = inMarkerRef.current?.closest('.timeline-ruler');
      if (!container) return;

      const rect = container.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const frame = Math.max(0, pixelsToFrameRef.current(x));

      // setInPoint will handle validation (moving out-point to last frame if needed)
      setInPointRef.current(frame);
    };

    const handleMouseUp = () => {
      setIsDraggingIn(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = originalCursor;
    };
  }, [isDraggingIn]);

  // Handle dragging out-point
  useEffect(() => {
    if (!isDraggingOut) return;

    const originalCursor = document.body.style.cursor;
    document.body.style.cursor = 'grabbing';

    const handleMouseMove = (e: MouseEvent) => {
      const container = outMarkerRef.current?.closest('.timeline-ruler');
      if (!container) return;

      const rect = container.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const frame = Math.max(0, pixelsToFrameRef.current(x));

      // setOutPoint will handle validation (moving in-point to frame 0 if needed)
      setOutPointRef.current(frame);
    };

    const handleMouseUp = () => {
      setIsDraggingOut(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = originalCursor;
    };
  }, [isDraggingOut]);

  return (
    <>
      {/* In-point marker */}
      {inPoint !== null && (
        <div
          ref={inMarkerRef}
          className="absolute top-0"
          style={{
            left: `${frameToPixels(inPoint)}px`,
            width: '2px',
            height: '100%',
            pointerEvents: 'none',
            zIndex: 20,
          }}
        >
          {/* Vertical line */}
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              backgroundColor: 'var(--color-timeline-in)',
              boxShadow: '0 0 4px color-mix(in oklch, var(--color-timeline-in) 40%, transparent)',
            }}
          />

          {/* Invisible hit area for dragging */}
          <div
            className="absolute pointer-events-auto"
            style={{
              top: 0,
              bottom: 0,
              left: '-5px',
              width: '12px',
              cursor: isDraggingIn ? 'grabbing' : 'grab',
            }}
            onMouseDown={handleInMouseDown}
          />
        </div>
      )}

      {/* Out-point marker */}
      {outPoint !== null && (
        <div
          ref={outMarkerRef}
          className="absolute top-0"
          style={{
            left: `${frameToPixels(outPoint)}px`,
            width: '2px',
            height: '100%',
            pointerEvents: 'none',
            zIndex: 20,
          }}
        >
          {/* Vertical line */}
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              backgroundColor: 'var(--color-timeline-out)',
              boxShadow: '0 0 4px color-mix(in oklch, var(--color-timeline-out) 40%, transparent)',
            }}
          />

          {/* Invisible hit area for dragging */}
          <div
            className="absolute pointer-events-auto"
            style={{
              top: 0,
              bottom: 0,
              left: '-5px',
              width: '12px',
              cursor: isDraggingOut ? 'grabbing' : 'grab',
            }}
            onMouseDown={handleOutMouseDown}
          />
        </div>
      )}
    </>
  );
});
