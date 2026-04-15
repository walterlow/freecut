import type { TimelineTrack } from '@/types/timeline';

export function hasVisibleVideoAtFrame(
  tracks: TimelineTrack[],
  frame: number,
): boolean {
  return tracks.some((track) => {
    if (!track.visible) return false;
    return track.items.some((item) =>
      item.type === 'video'
      && frame >= item.from
      && frame < (item.from + item.durationInFrames),
    );
  });
}
