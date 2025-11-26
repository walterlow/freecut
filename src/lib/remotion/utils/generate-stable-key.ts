import type { TimelineItem } from '@/types/timeline';

/**
 * Generates a stable key for timeline items that survives split operations.
 *
 * For media items (video/audio/image): key = mediaId + originId + sourceStart
 * - Left piece of split keeps same key (no remount)
 * - Right piece gets predictable key based on new sourceStart
 * - Independent clips have different originIds (no collision)
 *
 * For non-media items (text/shape): falls back to item.id
 */
export function generateStableKey(item: TimelineItem): string {
  if (
    item.mediaId &&
    (item.type === 'video' || item.type === 'audio' || item.type === 'image')
  ) {
    const sourceStart = item.sourceStart ?? 0;
    const origin = item.originId ?? item.id;
    // Include speed in key to force remount when playback rate changes
    const speed = item.speed ?? 1;
    return `${item.mediaId}-${origin}-${sourceStart}-${speed}`;
  }
  return item.id;
}
