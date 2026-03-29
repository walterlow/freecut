import { useEffect, useRef } from 'react';

import { blobUrlManager } from '@/infrastructure/browser/blob-url-manager';

import { useItemsStore } from '../stores/items-store';
import { useTimelineSettingsStore } from '../stores/timeline-settings-store';
import { useTimelineViewportStore } from '../stores/timeline-viewport-store';
import { useZoomStore } from '../stores/zoom-store';
import { waveformCache } from '../services/waveform-cache';

/**
 * Prefetch margin in pixels â€” how far ahead of the viewport to look for
 * audio/video clips that need waveforms. Larger than the visibility margin
 * (200px in useClipVisibility) so prefetch starts before clips become visible.
 */
const PREFETCH_AHEAD_PX = 800;

/**
 * Behind margin â€” less aggressive, just enough to cover reverse scroll.
 */
const PREFETCH_BEHIND_PX = 200;
const VISIBILITY_MARGIN_PX = 200;

/**
 * Prefetches waveforms for audio/video clips approaching the viewport.
 * Mount once in TimelineContent.
 *
 * - Tracks scroll direction to bias prefetch toward movement
 * - Skips clips already in the 200px visibility margin (handled by useWaveform)
 * - Uses existing waveformCache.prefetch() (fire-and-forget, queue-limited)
 */
export function useWaveformPrefetch() {
  const prevScrollLeftRef = useRef(useTimelineViewportStore.getState().scrollLeft);

  useEffect(() => {
    const prefetchVisibleWaveforms = () => {
      const { scrollLeft, viewportWidth } = useTimelineViewportStore.getState();
      const { pixelsPerSecond } = useZoomStore.getState();
      const { fps } = useTimelineSettingsStore.getState();

      if (pixelsPerSecond <= 0 || fps <= 0) {
        prevScrollLeftRef.current = scrollLeft;
        return;
      }

      const scrollDelta = scrollLeft - prevScrollLeftRef.current;
      prevScrollLeftRef.current = scrollLeft;
      const scrollingRight = scrollDelta >= 0;

      const prefetchLeftPx = scrollingRight
        ? scrollLeft - PREFETCH_BEHIND_PX
        : scrollLeft - PREFETCH_AHEAD_PX;
      const prefetchRightPx = scrollingRight
        ? scrollLeft + viewportWidth + PREFETCH_AHEAD_PX
        : scrollLeft + viewportWidth + PREFETCH_BEHIND_PX;
      const visibleLeftPx = scrollLeft - VISIBILITY_MARGIN_PX;
      const visibleRightPx = scrollLeft + viewportWidth + VISIBILITY_MARGIN_PX;

      const prefetchStartFrame = Math.max(0, Math.floor((prefetchLeftPx / pixelsPerSecond) * fps));
      const prefetchEndFrame = Math.ceil((prefetchRightPx / pixelsPerSecond) * fps);
      const visibleStartFrame = Math.max(0, Math.floor((visibleLeftPx / pixelsPerSecond) * fps));
      const visibleEndFrame = Math.ceil((visibleRightPx / pixelsPerSecond) * fps);
      const allItems = useItemsStore.getState().items;

      for (const item of allItems) {
        if (item.type !== 'video' && item.type !== 'audio') continue;

        const itemEnd = item.from + item.durationInFrames;
        if (itemEnd <= prefetchStartFrame || item.from >= prefetchEndFrame) continue;
        if (itemEnd > visibleStartFrame && item.from < visibleEndFrame) continue;
        if (!item.mediaId) continue;

        const blobUrl = blobUrlManager.get(item.mediaId);
        if (blobUrl) {
          waveformCache.prefetch(item.mediaId, blobUrl);
        }
      }
    };

    prefetchVisibleWaveforms();

    const unsubscribers = [
      useTimelineViewportStore.subscribe(prefetchVisibleWaveforms),
      useZoomStore.subscribe(prefetchVisibleWaveforms),
      useTimelineSettingsStore.subscribe(prefetchVisibleWaveforms),
      useItemsStore.subscribe(prefetchVisibleWaveforms),
    ];

    return () => {
      for (const unsubscribe of unsubscribers) {
        unsubscribe();
      }
    };
  }, []);
}
