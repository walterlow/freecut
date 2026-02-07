import { useRef, useEffect, useLayoutEffect } from 'react';
import { usePlaybackStore } from '@/features/preview/stores/playback-store';
import { useTimelineZoomContext } from '../contexts/timeline-zoom-context';
import { formatTimecode } from '@/utils/time-utils';

export interface TimelinePreviewScrubberProps {
  inRuler?: boolean;
}

/**
 * Ghost playhead that follows mouse hover position on the timeline.
 *
 * Uses the same manual subscription pattern as TimelinePlayhead:
 * - No React re-renders during updates
 * - DOM is updated directly via refs
 * - pointer-events: none so it doesn't interfere with clicks/drags
 */
export function TimelinePreviewScrubber({ inRuler = false }: TimelinePreviewScrubberProps) {
  const { frameToPixels, fps } = useTimelineZoomContext();
  const scrubberRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const frameToPixelsRef = useRef(frameToPixels);
  const fpsRef = useRef(fps);

  useEffect(() => {
    frameToPixelsRef.current = frameToPixels;
    fpsRef.current = fps;
  }, [frameToPixels, fps]);

  // Subscribe to previewFrame and update DOM directly (zero re-renders)
  useEffect(() => {
    const updatePosition = (previewFrame: number | null) => {
      if (!scrubberRef.current) return;

      if (previewFrame === null) {
        scrubberRef.current.style.display = 'none';
        return;
      }

      const leftPosition = Math.round(frameToPixelsRef.current(previewFrame));
      scrubberRef.current.style.display = '';
      scrubberRef.current.style.left = `${leftPosition}px`;

      // Update tooltip text
      if (tooltipRef.current) {
        tooltipRef.current.textContent = formatTimecode(previewFrame, fpsRef.current);
      }
    };

    // Initial state
    updatePosition(usePlaybackStore.getState().previewFrame);

    return usePlaybackStore.subscribe((state) => {
      updatePosition(state.previewFrame);
    });
  }, []);

  // Reposition on zoom changes
  useLayoutEffect(() => {
    if (!scrubberRef.current) return;
    const previewFrame = usePlaybackStore.getState().previewFrame;
    if (previewFrame === null) return;
    const leftPosition = Math.round(frameToPixels(previewFrame));
    scrubberRef.current.style.left = `${leftPosition}px`;
  }, [frameToPixels]);

  return (
    <div
      ref={scrubberRef}
      className="absolute top-0 bottom-0"
      style={{
        display: 'none', // Hidden by default, shown via ref subscription
        width: '1px',
        pointerEvents: 'none',
        zIndex: 20,
      }}
    >
      {/* Ghost line */}
      <div className="absolute inset-0 bg-white/30" />

      {/* Ruler area: diamond handle + time tooltip */}
      {inRuler && (
        <>
          {/* Small diamond */}
          <div
            className="absolute bg-white/40"
            style={{
              top: '-5px',
              left: '50%',
              width: '8px',
              height: '8px',
              transform: 'translateX(-50%) rotate(45deg)',
              transformOrigin: 'center',
            }}
          />

          {/* Time tooltip */}
          <div
            ref={tooltipRef}
            className="absolute bg-black/80 text-white font-mono rounded px-1.5 py-0.5 whitespace-nowrap"
            style={{
              top: '-22px',
              left: '50%',
              transform: 'translateX(-50%)',
              fontSize: '10px',
              lineHeight: '12px',
            }}
          />
        </>
      )}
    </div>
  );
}
