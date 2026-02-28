import { useEffect, useRef } from 'react';
import { useTimelineViewportStore } from '../stores/timeline-viewport-store';
import { useZoomStore } from '../stores/zoom-store';
import { useTimelineSettingsStore } from '../stores/timeline-settings-store';
import { useItemsStore } from '../stores/items-store';
import { blobUrlManager } from '@/infrastructure/browser/blob-url-manager';
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

/**
 * Prefetches waveforms for audio/video clips approaching the viewport.
 * Mount once in TimelineContent.
 *
 * - Tracks scroll direction to bias prefetch toward movement
 * - Skips clips already in the 200px visibility margin (handled by useWaveform)
 * - Uses existing waveformCache.prefetch() (fire-and-forget, queue-limited)
 */
export function useWaveformPrefetch() {
  const scrollLeft = useTimelineViewportStore((s) => s.scrollLeft);
  const viewportWidth = useTimelineViewportStore((s) => s.viewportWidth);
  const pixelsPerSecond = useZoomStore((s) => s.pixelsPerSecond);
  const fps = useTimelineSettingsStore((s) => s.fps);

  const prevScrollLeftRef = useRef(scrollLeft);

  useEffect(() => {
    if (pixelsPerSecond <= 0 || fps <= 0) return;

    // Determine scroll direction
    const scrollDelta = scrollLeft - prevScrollLeftRef.current;
    prevScrollLeftRef.current = scrollLeft;
    const scrollingRight = scrollDelta >= 0;

    // Calculate directional prefetch range in pixels
    const prefetchLeftPx = scrollingRight
      ? scrollLeft - PREFETCH_BEHIND_PX
      : scrollLeft - PREFETCH_AHEAD_PX;
    const prefetchRightPx = scrollingRight
      ? scrollLeft + viewportWidth + PREFETCH_AHEAD_PX
      : scrollLeft + viewportWidth + PREFETCH_BEHIND_PX;

    // Visibility margin matches useClipVisibility's PREFETCH_MARGIN_PX
    const visibilityMarginPx = 200;
    const visibleLeftPx = scrollLeft - visibilityMarginPx;
    const visibleRightPx = scrollLeft + viewportWidth + visibilityMarginPx;

    // Convert to frames
    const prefetchStartFrame = Math.max(0, Math.floor((prefetchLeftPx / pixelsPerSecond) * fps));
    const prefetchEndFrame = Math.ceil((prefetchRightPx / pixelsPerSecond) * fps);
    const visibleStartFrame = Math.max(0, Math.floor((visibleLeftPx / pixelsPerSecond) * fps));
    const visibleEndFrame = Math.ceil((visibleRightPx / pixelsPerSecond) * fps);

    // Scan items for audio/video clips in prefetch range but outside visibility range
    const allItems = useItemsStore.getState().items;

    for (const item of allItems) {
      if (item.type !== 'video' && item.type !== 'audio') continue;

      const itemEnd = item.from + item.durationInFrames;

      // Must be in prefetch range
      if (itemEnd <= prefetchStartFrame || item.from >= prefetchEndFrame) continue;

      // Skip if already in visibility range (useWaveform handles these)
      if (itemEnd > visibleStartFrame && item.from < visibleEndFrame) continue;

      // Prefetch this clip's waveform if a blob URL is already available
      if (!item.mediaId) continue;
      const blobUrl = blobUrlManager.get(item.mediaId);
      if (blobUrl) {
        waveformCache.prefetch(item.mediaId, blobUrl);
      }
    }
  }, [scrollLeft, viewportWidth, pixelsPerSecond, fps]);
}

