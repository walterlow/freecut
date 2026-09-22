// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import type { TimelineItem } from '@/types/timeline'
import type { ExportableSequence } from '../deps/timeline-compositions'
import {
  findDominantVideoMediaId,
  getExportRange,
  getQueueRange,
  getSegmentWindow,
  getTimelineDurationFrames,
  hasInOutRange,
} from './export-range'

function videoItem(id: string, from: number, durationInFrames: number, mediaId?: string) {
  return {
    id,
    trackId: 'track-1',
    type: 'video',
    from,
    durationInFrames,
    label: id,
    src: `blob://${id}.mp4`,
    mediaId,
  } satisfies Extract<TimelineItem, { type: 'video' }>
}

function audioItem(id: string, from: number, durationInFrames: number) {
  return {
    id,
    trackId: 'track-1',
    type: 'audio',
    from,
    durationInFrames,
    label: id,
    src: `blob://${id}.wav`,
  } satisfies Extract<TimelineItem, { type: 'audio' }>
}

function sequence(overrides: Partial<ExportableSequence> = {}): ExportableSequence {
  return {
    id: null,
    name: 'Main Timeline',
    tracks: [],
    items: [],
    transitions: [],
    keyframes: [],
    fps: 30,
    width: 1920,
    height: 1080,
    masterBusDb: 0,
    durationFrames: 300,
    inPoint: null,
    outPoint: null,
    markers: [],
    ...overrides,
  }
}

describe('getTimelineDurationFrames', () => {
  it('is zero for an empty timeline', () => {
    expect(getTimelineDurationFrames([])).toBe(0)
  })

  it('ends at the furthest item, counting from its start offset', () => {
    expect(getTimelineDurationFrames([videoItem('a', 0, 30), videoItem('b', 120, 45)])).toBe(165)
  })

  it('counts audio-only timelines', () => {
    expect(getTimelineDurationFrames([audioItem('a', 10, 20)])).toBe(30)
  })
})

describe('findDominantVideoMediaId', () => {
  it('returns the media id of the longest video clip', () => {
    expect(
      findDominantVideoMediaId([
        videoItem('a', 0, 30, 'media-a'),
        videoItem('b', 0, 90, 'media-b'),
        videoItem('c', 0, 60, 'media-c'),
      ]),
    ).toBe('media-b')
  })

  it('keeps the first clip when two are equally long', () => {
    expect(
      findDominantVideoMediaId([videoItem('a', 0, 60, 'media-a'), videoItem('b', 0, 60, 'media-b')]),
    ).toBe('media-a')
  })

  it('ignores non-video clips and video clips without a media id', () => {
    expect(
      findDominantVideoMediaId([
        audioItem('a', 0, 300),
        videoItem('b', 0, 30),
        videoItem('c', 0, 45, 'media-c'),
      ]),
    ).toBe('media-c')
  })

  it('reports no source for a timeline without video media', () => {
    expect(findDominantVideoMediaId([])).toBeUndefined()
    expect(findDominantVideoMediaId([audioItem('a', 0, 300)])).toBeUndefined()
  })
})

describe('hasInOutRange', () => {
  it('needs both points, with out after in', () => {
    expect(hasInOutRange(10, 40)).toBe(true)
    expect(hasInOutRange(null, 40)).toBe(false)
    expect(hasInOutRange(10, null)).toBe(false)
    expect(hasInOutRange(null, null)).toBe(false)
    expect(hasInOutRange(40, 10)).toBe(false)
    expect(hasInOutRange(20, 20)).toBe(false)
  })
})

describe('getExportRange', () => {
  it('covers the whole timeline when no in/out range is set', () => {
    expect(
      getExportRange({
        renderWholeProject: false,
        inPoint: null,
        outPoint: null,
        timelineDurationFrames: 300,
      }),
    ).toEqual({ start: 0, end: 300, duration: 300 })
  })

  it('renders only the in/out range when one is set', () => {
    expect(
      getExportRange({
        renderWholeProject: false,
        inPoint: 30,
        outPoint: 120,
        timelineDurationFrames: 300,
      }),
    ).toEqual({ start: 30, end: 120, duration: 90 })
  })

  it('ignores the in/out range while rendering the whole project', () => {
    expect(
      getExportRange({
        renderWholeProject: true,
        inPoint: 30,
        outPoint: 120,
        timelineDurationFrames: 300,
      }),
    ).toEqual({ start: 0, end: 300, duration: 300 })
  })

  it('ignores an inverted or empty range', () => {
    expect(
      getExportRange({
        renderWholeProject: false,
        inPoint: 120,
        outPoint: 30,
        timelineDurationFrames: 300,
      }),
    ).toEqual({ start: 0, end: 300, duration: 300 })
    expect(
      getExportRange({
        renderWholeProject: false,
        inPoint: 120,
        outPoint: 120,
        timelineDurationFrames: 300,
      }),
    ).toEqual({ start: 0, end: 300, duration: 300 })
  })
})

describe('getQueueRange', () => {
  it('queues the whole timeline for a sequence without in/out points', () => {
    expect(getQueueRange(sequence(), false)).toEqual({ inPoint: null, outPoint: null })
  })

  it('queues the sequence in/out range when it has one', () => {
    expect(getQueueRange(sequence({ inPoint: 30, outPoint: 90 }), false)).toEqual({
      inPoint: 30,
      outPoint: 90,
    })
  })

  it('queues the whole timeline when the user asked for the whole project', () => {
    expect(getQueueRange(sequence({ inPoint: 30, outPoint: 90 }), true)).toEqual({
      inPoint: null,
      outPoint: null,
    })
  })

  it('queues the whole timeline when the range is empty or inverted', () => {
    expect(getQueueRange(sequence({ inPoint: 90, outPoint: 90 }), false)).toEqual({
      inPoint: null,
      outPoint: null,
    })
    expect(getQueueRange(sequence({ inPoint: 90, outPoint: 30 }), false)).toEqual({
      inPoint: null,
      outPoint: null,
    })
  })
})

describe('getSegmentWindow', () => {
  it('splits over the whole sequence when no in/out range is queued', () => {
    expect(getSegmentWindow(sequence({ durationFrames: 480 }), false)).toEqual({
      start: 0,
      end: 480,
    })
  })

  it('splits over the queued in/out range', () => {
    expect(
      getSegmentWindow(sequence({ durationFrames: 480, inPoint: 60, outPoint: 240 }), false),
    ).toEqual({ start: 60, end: 240 })
  })
})
