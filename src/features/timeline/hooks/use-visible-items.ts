import { useEffect, useState, useRef } from 'react';
import type { TimelineItem } from '@/types/timeline';
import type { Transition } from '@/types/transition';
import { useTimelineViewportStore } from '../stores/timeline-viewport-store';
import { useZoomStore } from '../stores/zoom-store';
import { useTimelineSettingsStore } from '../stores/timeline-settings-store';
import { useItemsStore } from '../stores/items-store';
import { useTransitionsStore } from '../stores/transitions-store';

/**
 * Pixels of buffer beyond viewport edges for mounting items.
 * 2000px mounts clips well before they enter the viewport, so the mount
 * jank (~100-170ms per clip) happens while the user is looking at content
 * further from the edge. Original 500px caused visible stutter when
 * scrolling into dense clip clusters.
 */
const BUFFER_PX = 2000;

/**
 * Inner buffer (pixels) — recomputation is skipped when the visible frame
 * range shifts by less than this amount. Avoids filtering items/transitions
 * on small scroll deltas that can't change the result. Must be smaller
 * than BUFFER_PX to guarantee items mount before they enter the viewport.
 */
const HYSTERESIS_PX = 800;

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

function getTrackVisibleTransitions(trackId: string): Transition[] | undefined {
  const transitionsState = useTransitionsStore.getState();
  return transitionsState.transitionsByTrackId[trackId] ?? EMPTY_TRANSITIONS;
}

function computeVisibleItemsSnapshot(trackId: string): VisibleItemsSnapshot {
  const { scrollLeft, viewportWidth } = useTimelineViewportStore.getState();
  const { pixelsPerSecond } = useZoomStore.getState();
  const { fps } = useTimelineSettingsStore.getState();
  const items = useItemsStore.getState().itemsByTrackId[trackId];
  const transitions = getTrackVisibleTransitions(trackId);
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

/**
 * Returns only the items and transitions that overlap the visible viewport + buffer
 * for a given track. Items fully outside the range are not rendered as React components.
 */
export function useVisibleItems(trackId: string) {
  const [snapshot, setSnapshot] = useState<VisibleItemsSnapshot>(() => computeVisibleItemsSnapshot(trackId));
  // Track the frame range used for the last committed result so we can skip
  // recomputation when scroll hasn't moved enough to change the item set.
  const lastRangeRef = useRef<VisibleFrameRange | null>(null);
  // Track last zoom/settings/data versions to detect non-scroll changes.
  // itemsRef/transRef use array references (not lengths) because the items
  // store preserves references for unchanged tracks — a new reference means
  // at least one item was mutated (move, trim, property change, etc.).
  const lastVersionRef = useRef<{
    pps: number;
    fps: number;
    itemsRef: TimelineItem[] | undefined;
    transRef: Transition[] | undefined;
  }>({ pps: 0, fps: 0, itemsRef: undefined, transRef: undefined });

  useEffect(() => {
    const apply = () => {
      const { pixelsPerSecond } = useZoomStore.getState();
      const { fps } = useTimelineSettingsStore.getState();
      const items = useItemsStore.getState().itemsByTrackId[trackId];
      const transitions = getTrackVisibleTransitions(trackId);
      const { scrollLeft, viewportWidth } = useTimelineViewportStore.getState();
      const newRange = getVisibleFrameRange(scrollLeft, viewportWidth, pixelsPerSecond, fps);

      // Fast path: if only scroll changed and the range shift is within
      // hysteresis, the visible item set is guaranteed unchanged.
      // Array references are compared (not lengths) so in-place mutations
      // (move, trim, property edits) that produce a new array always
      // bypass the fast path and recompute.
      const prev = lastVersionRef.current;
      const lastRange = lastRangeRef.current;
      if (
        lastRange
        && prev.pps === pixelsPerSecond
        && prev.fps === fps
        && prev.itemsRef === items
        && prev.transRef === transitions
      ) {
        const hysteresisFrames = fps > 0 && pixelsPerSecond > 0
          ? (HYSTERESIS_PX / pixelsPerSecond) * fps
          : 0;
        if (
          Math.abs(newRange.start - lastRange.start) < hysteresisFrames
          && Math.abs(newRange.end - lastRange.end) < hysteresisFrames
        ) {
          return; // Skip — too small a shift to affect results
        }
      }

      const visibleItems = getVisibleItemsForRange(items, newRange);
      const visibleTransitions = getVisibleTransitionsForRange(
        transitions,
        items,
        visibleItems,
        newRange
      );
      const next: VisibleItemsSnapshot = { visibleItems, visibleTransitions };

      lastRangeRef.current = newRange;
      lastVersionRef.current = { pps: pixelsPerSecond, fps, itemsRef: items, transRef: transitions };

      setSnapshot((prevSnap) => (areVisibleSnapshotsEqual(prevSnap, next) ? prevSnap : next));
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
