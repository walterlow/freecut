import { describe, expect, it } from 'vite-plus/test'
import type { AudioItem, TimelineTrack, VideoItem } from '@/types/timeline'
import {
  buildTrackContentCreateTrackMovePlan,
  buildTrackContentMoveUpdates,
  resolveTrackContentDragPlan,
} from './track-content-drag'

function makeTrack(
  overrides: Partial<TimelineTrack> & Pick<TimelineTrack, 'id' | 'name' | 'order'>,
): TimelineTrack {
  return {
    height: 80,
    locked: false,
    visible: true,
    muted: false,
    solo: false,
    volume: 0,
    items: [],
    ...overrides,
  }
}

function makeVideoItem(id: string, trackId: string): VideoItem {
  return {
    id,
    type: 'video',
    trackId,
    from: 0,
    durationInFrames: 30,
    label: id,
    mediaId: `${id}-media`,
    src: `blob:${id}`,
    sourceStart: 0,
    sourceDuration: 30,
    sourceFps: 30,
  } as VideoItem
}

function makeAudioItem(id: string, trackId: string): AudioItem {
  return {
    id,
    type: 'audio',
    trackId,
    from: 0,
    durationInFrames: 30,
    label: id,
    mediaId: `${id}-media`,
    src: `blob:${id}`,
    sourceStart: 0,
    sourceDuration: 30,
    sourceFps: 30,
  } as AudioItem
}

describe('track content drag', () => {
  it('limits drag plans to the anchor section and ignores mixed A/V selections', () => {
    const tracks = [
      makeTrack({ id: 'v3', name: 'V3', kind: 'video', order: 0 }),
      makeTrack({ id: 'v2', name: 'V2', kind: 'video', order: 1 }),
      makeTrack({ id: 'v1', name: 'V1', kind: 'video', order: 2 }),
      makeTrack({ id: 'a1', name: 'A1', kind: 'audio', order: 3 }),
      makeTrack({ id: 'a2', name: 'A2', kind: 'audio', order: 4 }),
    ]

    expect(
      resolveTrackContentDragPlan({
        tracks,
        anchorTrackId: 'v1',
        selectedTrackIds: ['v1', 'a2'],
      }),
    ).toEqual({
      kind: 'video',
      sectionTrackIds: ['v3', 'v2', 'v1'],
      draggedTrackIds: ['v1'],
    })

    expect(
      resolveTrackContentDragPlan({
        tracks,
        anchorTrackId: 'a2',
        selectedTrackIds: ['v1', 'a2'],
      }),
    ).toEqual({
      kind: 'audio',
      sectionTrackIds: ['a1', 'a2'],
      draggedTrackIds: ['a2'],
    })
  })

  it('moves video contents through fixed V lanes instead of reordering track headers', () => {
    const items = [
      makeVideoItem('clip-v3', 'v3'),
      makeVideoItem('clip-v2', 'v2'),
      makeVideoItem('clip-v1', 'v1'),
      makeAudioItem('clip-a1', 'a1'),
    ]

    expect(
      buildTrackContentMoveUpdates({
        sectionTrackIds: ['v3', 'v2', 'v1'],
        draggedTrackIds: ['v1'],
        items,
        insertIndex: 0,
      }),
    ).toEqual([
      { id: 'clip-v3', from: 0, trackId: 'v2' },
      { id: 'clip-v2', from: 0, trackId: 'v1' },
      { id: 'clip-v1', from: 0, trackId: 'v3' },
    ])
  })

  it('keeps multi-track moves ordered within the section', () => {
    const items = [
      makeVideoItem('clip-v4', 'v4'),
      makeVideoItem('clip-v3', 'v3'),
      makeVideoItem('clip-v2', 'v2'),
      makeVideoItem('clip-v1', 'v1'),
    ]

    expect(
      buildTrackContentMoveUpdates({
        sectionTrackIds: ['v4', 'v3', 'v2', 'v1'],
        draggedTrackIds: ['v2', 'v1'],
        items,
        insertIndex: 0,
      }),
    ).toEqual([
      { id: 'clip-v4', from: 0, trackId: 'v2' },
      { id: 'clip-v3', from: 0, trackId: 'v1' },
      { id: 'clip-v2', from: 0, trackId: 'v4' },
      { id: 'clip-v1', from: 0, trackId: 'v3' },
    ])
  })

  it('returns no updates when the dragged contents stay in place', () => {
    const items = [
      makeVideoItem('clip-v3', 'v3'),
      makeVideoItem('clip-v2', 'v2'),
      makeVideoItem('clip-v1', 'v1'),
    ]

    expect(
      buildTrackContentMoveUpdates({
        sectionTrackIds: ['v3', 'v2', 'v1'],
        draggedTrackIds: ['v2'],
        items,
        insertIndex: 2,
      }),
    ).toEqual([])
  })

  it('creates a new top video track and moves dragged contents into it', () => {
    const tracks = [
      makeTrack({ id: 'v2', name: 'V2', kind: 'video', order: 0 }),
      makeTrack({ id: 'v1', name: 'V1', kind: 'video', order: 1 }),
      makeTrack({ id: 'a1', name: 'A1', kind: 'audio', order: 2 }),
    ]
    const items = [makeVideoItem('clip-v2', 'v2'), makeVideoItem('clip-v1', 'v1')]

    expect(
      buildTrackContentCreateTrackMovePlan({
        tracks,
        items,
        kind: 'video',
        draggedTrackIds: ['v1'],
      }),
    ).toMatchObject({
      tracks: [
        { id: 'v2', name: 'V2' },
        { id: 'v1', name: 'V1' },
        { id: 'a1', name: 'A1' },
        { name: 'V3', kind: 'video' },
      ],
      updates: [{ id: 'clip-v1', from: 0 }],
    })

    const plan = buildTrackContentCreateTrackMovePlan({
      tracks,
      items,
      kind: 'video',
      draggedTrackIds: ['v1'],
    })
    const createdTrack = plan?.tracks.find((track) => track.name === 'V3')
    expect(plan?.updates).toEqual([{ id: 'clip-v1', from: 0, trackId: createdTrack?.id }])
  })

  it('creates matching new tracks for multi-lane drags in the new-track zone', () => {
    const tracks = [
      makeTrack({ id: 'v4', name: 'V4', kind: 'video', order: 0 }),
      makeTrack({ id: 'v3', name: 'V3', kind: 'video', order: 1 }),
      makeTrack({ id: 'v2', name: 'V2', kind: 'video', order: 2 }),
      makeTrack({ id: 'v1', name: 'V1', kind: 'video', order: 3 }),
      makeTrack({ id: 'a1', name: 'A1', kind: 'audio', order: 4 }),
    ]
    const items = [
      makeVideoItem('clip-v4', 'v4'),
      makeVideoItem('clip-v3', 'v3'),
      makeVideoItem('clip-v2', 'v2'),
      makeVideoItem('clip-v1', 'v1'),
    ]

    const plan = buildTrackContentCreateTrackMovePlan({
      tracks,
      items,
      kind: 'video',
      draggedTrackIds: ['v2', 'v1'],
    })

    const createdTracks = plan?.tracks
      .filter((track) => track.name === 'V5' || track.name === 'V6')
      .sort((left, right) => left.order - right.order)
    expect(createdTracks?.map((track) => track.name)).toEqual(['V6', 'V5'])
    expect(plan?.updates).toEqual([
      { id: 'clip-v2', from: 0, trackId: createdTracks?.[0]?.id },
      { id: 'clip-v1', from: 0, trackId: createdTracks?.[1]?.id },
    ])
  })
})
