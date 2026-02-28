import { useRef, useEffect, useLayoutEffect } from 'react';
import { usePlaybackStore } from '@/shared/state/playback';
import { useSelectionStore } from '@/shared/state/selection';
import { useTimelineZoomContext } from '../contexts/timeline-zoom-context';
import { formatTimecode } from '@/utils/time-utils';

interface TimelinePreviewScrubberProps {
  inRuler?: boolean;
  maxFrame?: number;
}

/**
 * Ghost playhead that follows mouse hover position on the timeline.
 *
 * Uses the same manual subscription pattern as TimelinePlayhead:
 * - No React re-renders during updates
 * - DOM is updated directly via refs
 * - pointer-events: none so it doesn't interfere with clicks/drags
 */
export function TimelinePreviewScrubber({ inRuler = false, maxFrame }: TimelinePreviewScrubberProps) {
  const { frameToPixels, fps } = useTimelineZoomContext();
  const scrubberRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const lineRef = useRef<HTMLDivElement>(null);
  const diamondRef = useRef<HTMLDivElement>(null);
  const frameToPixelsRef = useRef(frameToPixels);
  const fpsRef = useRef(fps);
  const maxFrameRef = useRef(maxFrame);

  useEffect(() => {
    frameToPixelsRef.current = frameToPixels;
    fpsRef.current = fps;
    maxFrameRef.current = maxFrame;
  }, [frameToPixels, fps, maxFrame]);

  // Subscribe to previewFrame and update DOM directly (zero re-renders)
  useEffect(() => {
    const updatePosition = (previewFrame: number | null) => {
      if (!scrubberRef.current) return;

      if (previewFrame === null) {
        scrubberRef.current.style.display = 'none';
        return;
      }

      let clampedFrame = Math.max(0, previewFrame);
      if (maxFrameRef.current !== undefined) {
        clampedFrame = Math.min(clampedFrame, maxFrameRef.current);
      }

      const leftPosition = Math.round(frameToPixelsRef.current(clampedFrame));
      scrubberRef.current.style.display = '';
      scrubberRef.current.style.left = `${leftPosition}px`;

      // Update tooltip text
      if (tooltipRef.current) {
        tooltipRef.current.textContent = formatTimecode(clampedFrame, fpsRef.current);
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
    let clampedFrame = Math.max(0, previewFrame);
    if (maxFrame !== undefined) {
      clampedFrame = Math.min(clampedFrame, maxFrame);
    }
    const leftPosition = Math.round(frameToPixels(clampedFrame));
    scrubberRef.current.style.left = `${leftPosition}px`;
  }, [frameToPixels, maxFrame]);

  // Change color based on active tool: red for razor, purple for rate-stretch
  useEffect(() => {
    const updateColor = (tool: string) => {
      const isRazor = tool === 'razor';
      const isRateStretch = tool === 'rate-stretch';
      const lineColor = isRazor
        ? 'rgba(239, 68, 68, 0.7)'
        : isRateStretch
        ? 'rgba(168, 85, 247, 0.7)'
        : 'rgba(255, 255, 255, 0.3)';
      const diamondColor = isRazor
        ? 'rgba(239, 68, 68, 0.8)'
        : isRateStretch
        ? 'rgba(168, 85, 247, 0.8)'
        : 'rgba(255, 255, 255, 0.4)';

      if (lineRef.current) lineRef.current.style.backgroundColor = lineColor;
      if (diamondRef.current) diamondRef.current.style.backgroundColor = diamondColor;
    };

    updateColor(useSelectionStore.getState().activeTool);

    return useSelectionStore.subscribe((state, prev) => {
      if (state.activeTool !== prev.activeTool) {
        updateColor(state.activeTool);
      }
    });
  }, []);

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
      <div ref={lineRef} className="absolute inset-0 bg-white/30" />

      {/* Ruler area: diamond handle + time tooltip */}
      {inRuler && (
        <>
          {/* Small diamond */}
          <div
            ref={diamondRef}
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
