import { useMemo } from 'react';
import type { TimelineItem } from '@/types/timeline';
import type { Transition } from '@/types/transition';
import { useTimelineViewportStore } from '../stores/timeline-viewport-store';
import { useZoomStore } from '../stores/zoom-store';
import { useTimelineSettingsStore } from '../stores/timeline-settings-store';
import { useItemsStore } from '../stores/items-store';
import { useTransitionsStore } from '../stores/transitions-store';

/**
 * Pixels of buffer beyond viewport edges.
 * 500px covers ~5 seconds at default zoom — enough for fast scroll and drag previews.
 */
const BUFFER_PX = 500;

/** Sentinel arrays to avoid re-renders when track has no items */
const EMPTY_ITEMS: TimelineItem[] = [];
const EMPTY_TRANSITIONS: Transition[] = [];

/**
 * Returns only the items and transitions that overlap the visible viewport + buffer
 * for a given track. Items fully outside the range are not rendered as React components.
 */
export function useVisibleItems(trackId: string) {
  const scrollLeft = useTimelineViewportStore((s) => s.scrollLeft);
  const viewportWidth = useTimelineViewportStore((s) => s.viewportWidth);
  const pixelsPerSecond = useZoomStore((s) => s.pixelsPerSecond);
  const fps = useTimelineSettingsStore((s) => s.fps);
  const items = useItemsStore((s) => s.itemsByTrackId[trackId]);
  const transitions = useTransitionsStore((s) => s.transitionsByTrackId[trackId]);

  // Convert pixel range to frame range once
  const visibleFrameRange = useMemo(() => {
    if (pixelsPerSecond <= 0 || fps <= 0) return { start: 0, end: Infinity };
    const leftPx = scrollLeft - BUFFER_PX;
    const rightPx = scrollLeft + viewportWidth + BUFFER_PX;
    const startFrame = Math.max(0, Math.floor((leftPx / pixelsPerSecond) * fps));
    const endFrame = Math.ceil((rightPx / pixelsPerSecond) * fps);
    return { start: startFrame, end: endFrame };
  }, [scrollLeft, viewportWidth, pixelsPerSecond, fps]);

  // Filter items by frame overlap
  const visibleItems = useMemo(() => {
    if (!items || items.length === 0) return EMPTY_ITEMS;
    const { start, end } = visibleFrameRange;
    const filtered = items.filter((item) => {
      const itemEnd = item.from + item.durationInFrames;
      return itemEnd > start && item.from < end;
    });
    // Return original array if nothing was filtered out (referential stability)
    return filtered.length === items.length ? items : filtered;
  }, [items, visibleFrameRange]);

  // Filter transitions — a transition is visible if either of its adjacent clips is visible
  const visibleTransitions = useMemo(() => {
    if (!transitions || transitions.length === 0) return EMPTY_TRANSITIONS;
    if (!items || items.length === 0) return EMPTY_TRANSITIONS;

    const { start, end } = visibleFrameRange;
    const visibleItemIds = new Set(visibleItems.map((item) => item.id));

    const filtered = transitions.filter((t) => {
      if (visibleItemIds.has(t.leftClipId) || visibleItemIds.has(t.rightClipId)) {
        return true;
      }
      // Fallback: check if transition spans the visible range even if both clips are outside buffer
      const leftClip = items.find((item) => item.id === t.leftClipId);
      const rightClip = items.find((item) => item.id === t.rightClipId);
      if (leftClip && rightClip) {
        const transStart = leftClip.from + leftClip.durationInFrames - t.durationInFrames;
        const transEnd = rightClip.from + t.durationInFrames;
        return transEnd > start && transStart < end;
      }
      return false;
    });

    return filtered.length === transitions.length ? transitions : filtered;
  }, [transitions, items, visibleFrameRange, visibleItems]);

  return { visibleItems, visibleTransitions };
}
