import { describe, expect, it } from 'vite-plus/test'
import type { TimelineItem } from '@/types/timeline'
import {
  getTimelineItemsForFrameRange,
  getTimelineTrackItemRangeIndex,
} from './timeline-item-range-index'

function item(id: string, from: number, durationInFrames: number): TimelineItem {
  return { id, from, durationInFrames } as TimelineItem
}

describe('timeline item range index', () => {
  it('preserves source order for unsorted tracks', () => {
    const items = [item('late', 100, 20), item('early', 0, 20), item('middle', 50, 20)]

    expect(getTimelineItemsForFrameRange(items, { start: 10, end: 110 })).toEqual(items)
    expect(
      getTimelineItemsForFrameRange(items, { start: 40, end: 120 }).map(({ id }) => id),
    ).toEqual(['late', 'middle'])
  })

  it('finds a long item that begins before the queried range', () => {
    const items = [item('long', 0, 1_000), item('short', 800, 10), item('later', 1_100, 10)]

    expect(
      getTimelineItemsForFrameRange(items, { start: 900, end: 950 }).map(({ id }) => id),
    ).toEqual(['long'])
  })

  it('uses half-open overlap boundaries', () => {
    const items = [item('before', 0, 10), item('inside', 10, 10), item('after', 20, 10)]

    expect(
      getTimelineItemsForFrameRange(items, { start: 10, end: 20 }).map(({ id }) => id),
    ).toEqual(['inside'])
  })

  it('returns the original array when every item overlaps', () => {
    const items = [item('one', 0, 10), item('two', 10, 10)]

    expect(getTimelineItemsForFrameRange(items, { start: 0, end: 20 })).toBe(items)
  })

  it('caches full-track duration bounds alongside a 30k-item index', () => {
    const items = Array.from({ length: 30_000 }, (_, index) =>
      item(`clip-${index}`, index * 10, (index % 40) + 1),
    )
    const firstIndex = getTimelineTrackItemRangeIndex(items)

    expect(getTimelineTrackItemRangeIndex(items)).toBe(firstIndex)
    expect(firstIndex).toMatchObject({
      itemCount: 30_000,
      minDurationInFrames: 1,
      maxDurationInFrames: 40,
    })
    expect(firstIndex.itemById.get('clip-15')?.from).toBe(150)
    expect(
      getTimelineItemsForFrameRange(items, { start: 150_000, end: 150_100 }).length,
    ).toBeLessThan(20)
  })
})
