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
    document.body.style.cursor = 'col-resize';

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
    document.body.style.cursor = 'col-resize';

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

  const ioHandleColor = 'var(--color-timeline-io-handle)';
  const ioLaneHeight = 14;
  const ioHitAreaHeight = ioLaneHeight + 6;
  const ioHandleWidth = 6;
  const ioHandleInset = 0;

  const renderMarker = (
    markerRef: React.RefObject<HTMLDivElement | null>,
    positionPx: number,
    onMouseDown: (e: React.MouseEvent) => void,
    side: 'in' | 'out'
  ) => (
    <div
      ref={markerRef}
      className="absolute top-0"
      style={{
        left: `${positionPx}px`,
        width: '2px',
        height: '100%',
        pointerEvents: 'none',
        zIndex: 22,
      }}
    >
      {/* Side grip handle aligned to range edge */}
        <div
          className="absolute pointer-events-none"
          style={{
            bottom: '0px',
            left: side === 'in' ? `${ioHandleInset}px` : `${-ioHandleWidth}px`,
            width: `${ioHandleWidth}px`,
            height: `${ioLaneHeight}px`,
          borderRadius: '2px',
          background: `linear-gradient(to bottom, ${ioHandleColor}, color-mix(in oklch, ${ioHandleColor} 75%, black))`,
          boxShadow: `0 0 6px color-mix(in oklch, ${ioHandleColor} 55%, transparent)`,
        }}
      />

      {/* Invisible hit area for dragging */}
      <div
        className="absolute pointer-events-auto"
        style={{
          bottom: '0px',
          height: `${ioHitAreaHeight}px`,
          left: '-8px',
          width: '18px',
          cursor: 'col-resize',
        }}
        onMouseDown={onMouseDown}
      />
    </div>
  );

  return (
    <>
      {/* In-point marker */}
      {inPoint !== null &&
        renderMarker(inMarkerRef, frameToPixels(inPoint), handleInMouseDown, 'in')}

      {/* Out-point marker */}
      {outPoint !== null &&
        renderMarker(outMarkerRef, frameToPixels(outPoint), handleOutMouseDown, 'out')}
    </>
  );
});
