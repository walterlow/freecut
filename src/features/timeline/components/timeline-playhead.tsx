// React and external libraries
import { useState, useCallback, useEffect, useRef } from 'react';

// Stores and selectors
import { usePlaybackStore } from '@/features/preview/stores/playback-store';

// Utilities and hooks
import { useTimelineZoom } from '../hooks/use-timeline-zoom';

export interface TimelinePlayheadProps {
  inRuler?: boolean; // If true, shows diamond indicator for ruler
}

/**
 * Timeline Playhead Component
 *
 * Renders the playhead indicator that shows the current frame position
 * - Vertical line across all tracks
 * - Diamond indicator in ruler when inRuler=true
 * - Synchronized with playback store
 * - Draggable for scrubbing through timeline
 */
export function TimelinePlayhead({ inRuler = false }: TimelinePlayheadProps) {
  const currentFrame = usePlaybackStore((s) => s.currentFrame);
  const setCurrentFrame = usePlaybackStore((s) => s.setCurrentFrame);
  const { frameToPixels, pixelsToFrame } = useTimelineZoom();

  const [isDragging, setIsDragging] = useState(false);
  const playheadRef = useRef<HTMLDivElement>(null);

  // Use refs to avoid stale closures
  const pixelsToFrameRef = useRef(pixelsToFrame);
  const setCurrentFrameRef = useRef(setCurrentFrame);

  // Update refs when functions change
  useEffect(() => {
    pixelsToFrameRef.current = pixelsToFrame;
    setCurrentFrameRef.current = setCurrentFrame;
  }, [pixelsToFrame, setCurrentFrame]);

  const leftPosition = frameToPixels(currentFrame);

  // Handle drag start
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

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
      const frame = Math.max(0, pixelsToFrameRef.current(x));
      setCurrentFrameRef.current(frame);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      // Restore original cursor
      document.body.style.cursor = originalCursor;
    };
  }, [isDragging, inRuler]); // Stable dependencies - no stale closures

  return (
    <div
      ref={playheadRef}
      className="absolute top-0 bottom-0"
      style={{
        left: `${leftPosition}px`,
        width: '2px',
        pointerEvents: 'none',
        zIndex: 9999,
      }}
    >
      {/* Invisible wider hit area for easier grabbing - only in tracks view */}
      {!inRuler && (
        <div
          className="absolute top-0 bottom-0"
          style={{
            left: '-6px', // Center the 14px wide area on the 2px line
            width: '14px',
            cursor: isDragging ? 'grabbing' : 'grab',
            pointerEvents: 'auto',
            backgroundColor: 'transparent',
          }}
          onMouseDown={handleMouseDown}
        />
      )}

      {/* Playhead line - visible and prominent */}
      <div
        className="absolute inset-0 bg-timeline-playhead pointer-events-none"
        style={{
          boxShadow: '0 0 8px oklch(0.68 0.19 45 / 0.5)',
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
              cursor: isDragging ? 'grabbing' : 'grab',
              pointerEvents: 'auto',
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
              boxShadow: '0 0 8px oklch(0.68 0.19 45 / 0.5)',
              transform: 'translateX(-50%) rotate(45deg)',
              transformOrigin: 'center',
            }}
          />
        </>
      )}
    </div>
  );
}
