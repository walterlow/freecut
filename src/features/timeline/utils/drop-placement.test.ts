import { describe, expect, it } from 'vite-plus/test'
import type { TimelineItem, TimelineTrack } from '@/types/timeline'
import { findBestCanvasDropPlacement } from './drop-placement'

function makeTrack(
  id: string,
  order: number,
  overrides: Partial<TimelineTrack> = {},
): TimelineTrack {
  return {
    id,
    name: id,
    height: 80,
    locked: false,
    visible: true,
    muted: false,
    solo: false,
    order,
    items: [],
    ...overrides,
  }
}

function makeVideoItem(
  id: string,
  trackId: string,
  from: number,
  durationInFrames: number,
): TimelineItem {
  return {
    id,
    type: 'video',
    trackId,
    from,
    durationInFrames,
    label: id,
    mediaId: `${id}-media`,
    src: 'blob:test',
  }
}

describe('findBestCanvasDropPlacement', () => {
  it('uses the active track when the playhead slot is free', () => {
    const placement = findBestCanvasDropPlacement({
      tracks: [makeTrack('track-1', 0), makeTrack('track-2', 1)],
      items: [],
      activeTrackId: 'track-2',
      proposedFrame: 120,
      durationInFrames: 60,
      itemType: 'video',
    })

    expect(placement).toEqual({
      trackId: 'track-2',
      from: 120,
      preservedTime: true,
    })
  })

  it('switches to another track before shifting time', () => {
    const placement = findBestCanvasDropPlacement({
      tracks: [makeTrack('track-1', 0), makeTrack('track-2', 1)],
      items: [makeVideoItem('busy', 'track-2', 100, 80)],
      activeTrackId: 'track-2',
      proposedFrame: 120,
      durationInFrames: 40,
      itemType: 'video',
    })

    expect(placement).toEqual({
      trackId: 'track-1',
      from: 120,
      preservedTime: true,
    })
  })

  it('falls back to the nearest available slot when every track is occupied at the playhead', () => {
    const placement = findBestCanvasDropPlacement({
      tracks: [makeTrack('track-1', 0), makeTrack('track-2', 1)],
      items: [
        makeVideoItem('track-1-busy', 'track-1', 100, 80),
        makeVideoItem('track-2-busy', 'track-2', 100, 100),
      ],
      activeTrackId: 'track-2',
      proposedFrame: 120,
      durationInFrames: 30,
      itemType: 'video',
    })

    expect(placement).toEqual({
      trackId: 'track-2',
      from: 70,
      preservedTime: false,
    })
  })

  it('allows disabled tracks when they are not locked', () => {
    const placement = findBestCanvasDropPlacement({
      tracks: [makeTrack('track-1', 0, { kind: 'video', visible: false }), makeTrack('track-2', 1)],
      items: [],
      activeTrackId: 'track-1',
      proposedFrame: 0,
      durationInFrames: 30,
      itemType: 'video',
    })

    expect(placement).toEqual({
      trackId: 'track-1',
      from: 0,
      preservedTime: true,
    })
  })

  it('never targets group header tracks', () => {
    const placement = findBestCanvasDropPlacement({
      tracks: [
        makeTrack('group-1', 0, { isGroup: true }),
        makeTrack('track-1', 1, { kind: 'video' }),
      ],
      items: [],
      activeTrackId: 'group-1',
      proposedFrame: 24,
      durationInFrames: 30,
      itemType: 'video',
    })

    expect(placement).toEqual({
      trackId: 'track-1',
      from: 24,
      preservedTime: true,
    })
  })

  it('returns null when every compatible track is locked', () => {
    const placement = findBestCanvasDropPlacement({
      tracks: [
        makeTrack('track-1', 0, { locked: true }),
        makeTrack('track-2', 1, { locked: true, muted: true }),
        makeTrack('track-3', 2, { locked: true, visible: false }),
      ],
      items: [],
      activeTrackId: 'track-1',
      proposedFrame: 0,
      durationInFrames: 30,
      itemType: 'video',
    })

    expect(placement).toBeNull()
  })

  it('keeps visual placements off audio tracks', () => {
    const placement = findBestCanvasDropPlacement({
      tracks: [
        makeTrack('track-v1', 0, { kind: 'video' }),
        makeTrack('track-a1', 1, { kind: 'audio' }),
      ],
      items: [],
      activeTrackId: 'track-a1',
      proposedFrame: 48,
      durationInFrames: 30,
      itemType: 'shape',
    })

    expect(placement).toEqual({
      trackId: 'track-v1',
      from: 48,
      preservedTime: true,
    })
  })
})
