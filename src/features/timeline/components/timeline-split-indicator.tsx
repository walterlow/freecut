import { useTimelineZoomContext } from '../contexts/timeline-zoom-context';
import { usePlaybackStore } from '@/features/preview/stores/playback-store';
import { getRazorSplitPosition } from '../utils/razor-snap';

interface TimelineSplitIndicatorProps {
  /** X position in pixels relative to timeline container */
  cursorX: number | null;
  /** The hovered item element for positioning the indicator to clip height */
  hoveredElement: HTMLElement | null;
  /** Reference to the tracks container for calculating relative position */
  tracksContainerRef: React.RefObject<HTMLDivElement | null>;
}

/**
 * Timeline Split Indicator Component
 *
 * Renders a vertical red line at the cursor position when in razor mode.
 * Positioned above the playhead (z-index > 9999) so it's always visible.
 * Snaps to frame boundaries and playhead position for precise cuts.
 */
export function TimelineSplitIndicator({ cursorX, hoveredElement, tracksContainerRef }: TimelineSplitIndicatorProps) {
  const { pixelsToFrame, frameToPixels } = useTimelineZoomContext();
  // Don't subscribe to currentFrame - read from store only when needed for snap calculation
  // This prevents re-renders during playback

  if (cursorX === null || !hoveredElement || !tracksContainerRef.current) return null;

  // Read playback state directly from store (no subscription = no re-renders during playback)
  const { currentFrame, isPlaying } = usePlaybackStore.getState();

  const { snappedX } = getRazorSplitPosition({
    cursorX,
    currentFrame,
    isPlaying,
    frameToPixels,
    pixelsToFrame,
  });

  // Calculate clip position relative to tracks container
  const containerRect = tracksContainerRef.current.getBoundingClientRect();
  const elementRect = hoveredElement.getBoundingClientRect();
  const clipTop = elementRect.top - containerRect.top;
  const clipHeight = elementRect.height;

  return (
    <div
      className="absolute w-0.5 bg-red-500 pointer-events-none"
      style={{
        left: `${snappedX}px`,
        top: `${clipTop}px`,
        height: `${clipHeight}px`,
        zIndex: 10000, // Above playhead (9999)
        boxShadow: '0 0 4px rgba(239, 68, 68, 0.5)',
      }}
    />
  );
}
