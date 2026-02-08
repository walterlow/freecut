import type { TimelineItem } from '@/types/timeline';

/**
 * Generates a stable key for timeline items that includes source timing.
 * Key changes on split/join to ensure Composition Sequence updates correctly.
 *
 * For media items: key = mediaId + originId + sourceStart + sourceEnd + speed
 * - Split: both pieces get new keys (sourceStart or sourceEnd changes)
 * - Join: merged clip gets new key (sourceEnd changes)
 * - Move/drag: key stays same (only `from` changes, not in key)
 * - Speed change: new key (playback rate affects seeking)
 */
export function generateStableKey(item: TimelineItem): string {
  if (
    item.mediaId &&
    (item.type === 'video' || item.type === 'audio' || item.type === 'image')
  ) {
    const sourceStart = item.sourceStart ?? 0;
    const sourceEnd = item.sourceEnd ?? 0;
    const origin = item.originId ?? item.id;
    const speed = item.speed ?? 1;
    return `${item.mediaId}-${origin}-${sourceStart}-${sourceEnd}-${speed}`;
  }
  return item.id;
}
