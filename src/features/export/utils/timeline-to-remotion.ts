import type { TimelineTrack, TimelineItem } from '@/types/timeline';
import type { RemotionInputProps } from '@/types/export';

/**
 * Convert timeline data to Remotion input props
 *
 * Calculates duration from the rightmost timeline item and includes
 * resolution settings from export dialog.
 */
export function convertTimelineToRemotion(
  tracks: TimelineTrack[],
  items: TimelineItem[],
  fps: number,
  width: number,
  height: number
): RemotionInputProps {
  // Populate each track with its items
  const tracksWithItems: TimelineTrack[] = tracks.map(track => ({
    ...track,
    items: items.filter(item => item.trackId === track.id),
  }));

  // Calculate duration from the rightmost item
  // Find the maximum end frame (from + durationInFrames) across all items
  const maxEndFrame = items.length > 0
    ? Math.max(...items.map(item => item.from + item.durationInFrames))
    : fps * 10; // Default to 10 seconds if no items

  // Ensure minimum duration of 1 second
  const durationInFrames = Math.max(maxEndFrame, fps);

  return {
    fps,
    durationInFrames,
    width,
    height,
    tracks: tracksWithItems,
  };
}
