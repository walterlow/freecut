import { describe, expect, it } from 'vite-plus/test'
import type { TimelineItem } from '@/types/timeline'
import {
  buildTimelineDensityBuckets,
  findTimelineDensityBucketItem,
} from './timeline-density-overview'
import {
  countCompactTimelineItemsAtZoom,
  getTimelineCompactCohortSignal,
} from './timeline-dom-density'

function makeItems(count: number): TimelineItem[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `clip-${index}`,
    type: 'video',
    trackId: 'track-1',
    from: index * 2,
    durationInFrames: 2,
    label: `Clip ${index}`,
    mediaId: 'media-1',
    src: 'blob:test',
  }))
}

describe('timeline density overview', () => {
  it('bounds a 30,000 clip overview without dropping bucket coverage', () => {
    const items = makeItems(30_000)
    const buckets = buildTimelineDensityBuckets(items, 1024)

    expect(buckets.length).toBeLessThanOrEqual(1024)
    expect(buckets.reduce((count, bucket) => count + bucket.items.length, 0)).toBe(30_000)
    expect(buckets[0]?.from).toBe(0)
    expect(buckets.at(-1)!.from + buckets.at(-1)!.durationInFrames).toBe(60_000)
  })

  it('resolves the hit item inside a compressed bucket', () => {
    const bucket = buildTimelineDensityBuckets(makeItems(12), 1)[0]!

    expect(findTimelineDensityBucketItem(bucket, 15).id).toBe('clip-7')
    expect(findTimelineDensityBucketItem(bucket, 200).id).toBe('clip-11')
  })

  it('builds chronological buckets when the track store order is not chronological', () => {
    const buckets = buildTimelineDensityBuckets(makeItems(12).reverse(), 3)

    expect(buckets.map((bucket) => bucket.from)).toEqual([0, 8, 16])
    expect(buckets.map((bucket) => bucket.durationInFrames)).toEqual([8, 8, 8])
  })

  it('classifies a 30,000 clip zoom cohort through the sorted duration index', () => {
    const durations = Array.from({ length: 30_000 }, (_, index) => index + 1)

    expect(countCompactTimelineItemsAtZoom(durations, 30, 30)).toBe(36)
    expect(countCompactTimelineItemsAtZoom(durations, 30, 300)).toBe(3)
  })

  it('classifies full-track compact cohorts from stable duration bounds', () => {
    const bounds = {
      itemCount: 30_000,
      minDurationInFrames: 1,
      maxDurationInFrames: 300,
    }

    expect(getTimelineCompactCohortSignal(bounds, 30, 3, false)).toBe('settled:all')
    expect(getTimelineCompactCohortSignal(bounds, 30, 2_000, false)).toBe('settled:none')
    expect(getTimelineCompactCohortSignal(bounds, 30, 30, true)).toMatch(/^interacting:mixed:/)
  })
})
