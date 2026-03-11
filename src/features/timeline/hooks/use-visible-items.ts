import { useEffect, useState } from 'react';
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

interface VisibleFrameRange {
  start: number;
  end: number;
}

interface VisibleItemsSnapshot {
  visibleItems: TimelineItem[];
  visibleTransitions: Transition[];
}

/**
 * Returns only the items and transitions that overlap the visible viewport + buffer
 * for a given track. Items fully outside the range are not rendered as React components.
 */
export function useVisibleItems(trackId: string) {
  const [snapshot, setSnapshot] = useState<VisibleItemsSnapshot>(() => computeVisibleItemsSnapshot(trackId));

  useEffect(() => {
    const apply = () => {
      const next = computeVisibleItemsSnapshot(trackId);
      setSnapshot((prev) => (areVisibleSnapshotsEqual(prev, next) ? prev : next));
    };

    apply();

    const unsubscribers = [
      useTimelineViewportStore.subscribe(apply),
      useZoomStore.subscribe(apply),
      useTimelineSettingsStore.subscribe(apply),
      useItemsStore.subscribe(apply),
      useTransitionsStore.subscribe(apply),
    ];

    return () => {
      for (const unsubscribe of unsubscribers) {
        unsubscribe();
      }
    };
  }, [trackId]);

  return snapshot;
}

function computeVisibleItemsSnapshot(trackId: string): VisibleItemsSnapshot {
  const { scrollLeft, viewportWidth } = useTimelineViewportStore.getState();
  const { pixelsPerSecond } = useZoomStore.getState();
  const { fps } = useTimelineSettingsStore.getState();
  const items = useItemsStore.getState().itemsByTrackId[trackId];
  const transitions = useTransitionsStore.getState().transitionsByTrackId[trackId];
  const visibleFrameRange = getVisibleFrameRange(scrollLeft, viewportWidth, pixelsPerSecond, fps);
  const visibleItems = getVisibleItemsForRange(items, visibleFrameRange);
  const visibleTransitions = getVisibleTransitionsForRange(
    transitions,
    items,
    visibleItems,
    visibleFrameRange
  );

  return { visibleItems, visibleTransitions };
}

function getVisibleFrameRange(
  scrollLeft: number,
  viewportWidth: number,
  pixelsPerSecond: number,
  fps: number
): VisibleFrameRange {
  if (pixelsPerSecond <= 0 || fps <= 0) {
    return { start: 0, end: Infinity };
  }

  const leftPx = scrollLeft - BUFFER_PX;
  const rightPx = scrollLeft + viewportWidth + BUFFER_PX;
  const startFrame = Math.max(0, Math.floor((leftPx / pixelsPerSecond) * fps));
  const endFrame = Math.ceil((rightPx / pixelsPerSecond) * fps);

  return { start: startFrame, end: endFrame };
}

function getVisibleItemsForRange(
  items: TimelineItem[] | undefined,
  visibleFrameRange: VisibleFrameRange
): TimelineItem[] {
  if (!items || items.length === 0) {
    return EMPTY_ITEMS;
  }

  const { start, end } = visibleFrameRange;
  const filtered = items.filter((item) => {
    const itemEnd = item.from + item.durationInFrames;
    return itemEnd > start && item.from < end;
  });

  return filtered.length === items.length ? items : filtered;
}

function getVisibleTransitionsForRange(
  transitions: Transition[] | undefined,
  items: TimelineItem[] | undefined,
  visibleItems: TimelineItem[],
  visibleFrameRange: VisibleFrameRange
): Transition[] {
  if (!transitions || transitions.length === 0) {
    return EMPTY_TRANSITIONS;
  }

  if (!items || items.length === 0) {
    return EMPTY_TRANSITIONS;
  }

  const { start, end } = visibleFrameRange;
  const visibleItemIds = new Set(visibleItems.map((item) => item.id));

  const filtered = transitions.filter((transition) => {
    if (visibleItemIds.has(transition.leftClipId) || visibleItemIds.has(transition.rightClipId)) {
      return true;
    }

    const leftClip = items.find((item) => item.id === transition.leftClipId);
    const rightClip = items.find((item) => item.id === transition.rightClipId);
    if (!leftClip || !rightClip) {
      return false;
    }

    const transitionStart = leftClip.from + leftClip.durationInFrames - transition.durationInFrames;
    const transitionEnd = rightClip.from + transition.durationInFrames;
    return transitionEnd > start && transitionStart < end;
  });

  return filtered.length === transitions.length ? transitions : filtered;
}

function areVisibleSnapshotsEqual(
  prev: VisibleItemsSnapshot,
  next: VisibleItemsSnapshot
): boolean {
  return areArraysShallowEqual(prev.visibleItems, next.visibleItems)
    && areArraysShallowEqual(prev.visibleTransitions, next.visibleTransitions);
}

function areArraysShallowEqual<T>(prev: T[], next: T[]): boolean {
  if (prev === next) {
    return true;
  }

  if (prev.length !== next.length) {
    return false;
  }

  for (let index = 0; index < prev.length; index++) {
    if (prev[index] !== next[index]) {
      return false;
    }
  }

  return true;
}
