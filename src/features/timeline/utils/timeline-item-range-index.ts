import type { TimelineItem } from '@/types/timeline'

export interface TimelineItemDurationBounds {
  itemCount: number
  minDurationInFrames: number
  maxDurationInFrames: number
}

export interface TimelineItemFrameRange {
  start: number
  end: number
}

interface IndexedTimelineItem {
  item: TimelineItem
  originalIndex: number
}

export interface TimelineTrackItemRangeIndex extends TimelineItemDurationBounds {
  items: ReadonlyArray<TimelineItem>
  itemById: ReadonlyMap<string, TimelineItem>
  entriesByStart: ReadonlyArray<IndexedTimelineItem>
  prefixMaxEnd: ReadonlyArray<number>
}

const EMPTY_TIMELINE_ITEMS: TimelineItem[] = []
const rangeIndexByItems = new WeakMap<ReadonlyArray<TimelineItem>, TimelineTrackItemRangeIndex>()

export function getTimelineTrackItemRangeIndex(
  items: ReadonlyArray<TimelineItem> | undefined,
): TimelineTrackItemRangeIndex {
  const stableItems = items ?? EMPTY_TIMELINE_ITEMS
  const cached = rangeIndexByItems.get(stableItems)
  if (cached) return cached

  const entriesByStart = stableItems
    .map((item, originalIndex) => ({ item, originalIndex }))
    .sort(
      (left, right) => left.item.from - right.item.from || left.originalIndex - right.originalIndex,
    )
  const prefixMaxEnd: number[] = []
  const itemById = new Map<string, TimelineItem>()
  let maxEnd = Number.NEGATIVE_INFINITY
  let minDurationInFrames = Number.POSITIVE_INFINITY
  let maxDurationInFrames = Number.NEGATIVE_INFINITY

  for (const entry of entriesByStart) {
    const { item } = entry
    itemById.set(item.id, item)
    maxEnd = Math.max(maxEnd, item.from + item.durationInFrames)
    prefixMaxEnd.push(maxEnd)
    minDurationInFrames = Math.min(minDurationInFrames, item.durationInFrames)
    maxDurationInFrames = Math.max(maxDurationInFrames, item.durationInFrames)
  }

  const index: TimelineTrackItemRangeIndex = {
    items: stableItems,
    itemById,
    entriesByStart,
    prefixMaxEnd,
    itemCount: stableItems.length,
    minDurationInFrames: minDurationInFrames === Number.POSITIVE_INFINITY ? 0 : minDurationInFrames,
    maxDurationInFrames: maxDurationInFrames === Number.NEGATIVE_INFINITY ? 0 : maxDurationInFrames,
  }
  rangeIndexByItems.set(stableItems, index)
  return index
}

/**
 * Finds overlapping items in O(log n + k) after the per-array index is built.
 * Results retain the source array's order so callers observe the same ordering
 * as the previous Array.filter implementation.
 */
export function getTimelineItemsForFrameRange(
  items: ReadonlyArray<TimelineItem> | undefined,
  range: TimelineItemFrameRange,
): TimelineItem[] {
  if (!items || items.length === 0) return EMPTY_TIMELINE_ITEMS

  const index = getTimelineTrackItemRangeIndex(items)
  const { entriesByStart, prefixMaxEnd } = index

  let low = 0
  let high = entriesByStart.length
  while (low < high) {
    const middle = (low + high) >> 1
    if (entriesByStart[middle]!.item.from < range.end) low = middle + 1
    else high = middle
  }
  const startUpperBound = low

  low = 0
  high = startUpperBound
  while (low < high) {
    const middle = (low + high) >> 1
    if (prefixMaxEnd[middle]! <= range.start) low = middle + 1
    else high = middle
  }

  const matches: IndexedTimelineItem[] = []
  for (let indexPosition = low; indexPosition < startUpperBound; indexPosition++) {
    const entry = entriesByStart[indexPosition]!
    if (entry.item.from + entry.item.durationInFrames > range.start) matches.push(entry)
  }

  if (matches.length === items.length) return items as TimelineItem[]
  if (matches.length > 1) {
    matches.sort((left, right) => left.originalIndex - right.originalIndex)
  }
  return matches.map((entry) => entry.item)
}
