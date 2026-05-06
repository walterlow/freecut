import { beforeEach, describe, expect, it } from 'vite-plus/test'
import type { AudioItem, TimelineTrack, VideoItem } from '@/types/timeline'
import type { Transition } from '@/types/transition'
import {
  buildInsertedGapPreviewUpdatesForSyncLockedTracks,
  buildRemovedIntervalPreviewUpdatesForSyncLockedTracks,
  propagateInsertedGapToSyncLockedTracks,
  propagateRemovedIntervalsToSyncLockedTracks,
} from './sync-lock-ripple'
import { applyTransitionRepairs } from './shared'
import { useItemsStore } from '../items-store'
import { useTransitionsStore } from '../transitions-store'

function makeTrack(
  overrides: Partial<TimelineTrack> & Pick<TimelineTrack, 'id' | 'name' | 'order' | 'kind'>,
): TimelineTrack {
  return {
    height: 80,
    locked: false,
    syncLock: true,
    visible: true,
    muted: false,
    solo: false,
    volume: 0,
    items: [],
    ...overrides,
  }
}

function makeVideoItem(overrides: Partial<VideoItem> = {}): VideoItem {
  return {
    id: 'video-1',
    type: 'video',
    trackId: 'video-track',
    from: 0,
    durationInFrames: 60,
    label: 'clip.mp4',
    src: 'blob:video',
    mediaId: 'media-video',
    ...overrides,
  }
}

function makeAudioItem(overrides: Partial<AudioItem> = {}): AudioItem {
  return {
    id: 'audio-1',
    type: 'audio',
    trackId: 'audio-track',
    from: 0,
    durationInFrames: 60,
    label: 'clip.wav',
    src: 'blob:audio',
    mediaId: 'media-audio',
    ...overrides,
  }
}

function makeTransition(overrides: Partial<Transition> = {}): Transition {
  return {
    id: 'transition-1',
    type: 'crossfade',
    presentation: 'fade',
    timing: 'linear',
    leftClipId: 'video-1',
    rightClipId: 'video-2',
    trackId: 'video-track',
    durationInFrames: 10,
    ...overrides,
  }
}

describe('sync-lock ripple preview helpers', () => {
  beforeEach(() => {
    useItemsStore.getState().setTracks([])
    useItemsStore.getState().setItems([])
    useTransitionsStore.getState().setTransitions([])
  })

  it('moves downstream clips on other sync-locked tracks during removed-interval preview', () => {
    const updates = buildRemovedIntervalPreviewUpdatesForSyncLockedTracks({
      items: [
        makeVideoItem(),
        makeAudioItem({ id: 'audio-after', from: 90, durationInFrames: 20 }),
      ],
      tracks: [
        makeTrack({ id: 'video-track', name: 'V1', order: 0, kind: 'video' }),
        makeTrack({ id: 'audio-track', name: 'A1', order: 1, kind: 'audio' }),
      ],
      editedTrackIds: new Set(['video-track']),
      intervals: [{ start: 50, end: 60 }],
    })

    expect(updates).toEqual([expect.objectContaining({ id: 'audio-after', from: 80 })])
  })

  it('collapses a continuous sync-locked clip and hides fully covered clips during removed-interval preview', () => {
    const updates = buildRemovedIntervalPreviewUpdatesForSyncLockedTracks({
      items: [
        makeVideoItem(),
        makeAudioItem({ id: 'music-bed', from: 0, durationInFrames: 120 }),
        makeAudioItem({ id: 'stinger', from: 52, durationInFrames: 4 }),
      ],
      tracks: [
        makeTrack({ id: 'video-track', name: 'V1', order: 0, kind: 'video' }),
        makeTrack({ id: 'audio-track', name: 'A1', order: 1, kind: 'audio' }),
      ],
      editedTrackIds: new Set(['video-track']),
      intervals: [{ start: 50, end: 60 }],
    })

    expect(updates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'music-bed', durationInFrames: 110 }),
        expect.objectContaining({ id: 'stinger', hidden: true }),
      ]),
    )
  })

  it('opens a live gap on other sync-locked tracks during inserted-gap preview', () => {
    const updates = buildInsertedGapPreviewUpdatesForSyncLockedTracks({
      items: [
        makeVideoItem(),
        makeAudioItem({ id: 'music-bed', from: 0, durationInFrames: 120 }),
        makeAudioItem({ id: 'audio-after', from: 60, durationInFrames: 20 }),
      ],
      tracks: [
        makeTrack({ id: 'video-track', name: 'V1', order: 0, kind: 'video' }),
        makeTrack({ id: 'audio-track', name: 'A1', order: 1, kind: 'audio' }),
      ],
      editedTrackIds: new Set(['video-track']),
      cutFrame: 50,
      amount: 10,
    })

    expect(updates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'music-bed', durationInFrames: 130 }),
        expect.objectContaining({ id: 'audio-after', from: 70 }),
      ]),
    )
  })

  it('skips tracks with sync lock disabled in preview helpers', () => {
    const updates = buildRemovedIntervalPreviewUpdatesForSyncLockedTracks({
      items: [
        makeVideoItem(),
        makeAudioItem({ id: 'audio-after', from: 90, durationInFrames: 20 }),
      ],
      tracks: [
        makeTrack({ id: 'video-track', name: 'V1', order: 0, kind: 'video' }),
        makeTrack({ id: 'audio-track', name: 'A1', order: 1, kind: 'audio', syncLock: false }),
      ],
      editedTrackIds: new Set(['video-track']),
      intervals: [{ start: 50, end: 60 }],
    })

    expect(updates).toEqual([])
  })

  it('preserves transitions when sync lock splits a transitioned clip', () => {
    useItemsStore
      .getState()
      .setTracks([
        makeTrack({ id: 'edited-track', name: 'Edited', order: 0, kind: 'audio' }),
        makeTrack({ id: 'video-track', name: 'V1', order: 1, kind: 'video' }),
      ])
    useItemsStore.getState().setItems([
      makeAudioItem({ id: 'edited-anchor', trackId: 'edited-track', durationInFrames: 30 }),
      makeVideoItem({
        id: 'video-1',
        trackId: 'video-track',
        durationInFrames: 60,
        sourceStart: 20,
        sourceEnd: 80,
        sourceDuration: 120,
      }),
      makeVideoItem({
        id: 'video-2',
        trackId: 'video-track',
        from: 60,
        durationInFrames: 30,
        mediaId: 'media-video-2',
        sourceStart: 20,
        sourceEnd: 50,
        sourceDuration: 120,
      }),
    ])
    useTransitionsStore.getState().setTransitions([makeTransition()])

    const result = propagateRemovedIntervalsToSyncLockedTracks({
      editedTrackIds: new Set(['edited-track']),
      intervals: [{ start: 20, end: 40 }],
    })
    applyTransitionRepairs(result.affectedIds, new Set(result.removedIds))

    const transitions = useTransitionsStore.getState().transitions
    const splitTail = useItemsStore
      .getState()
      .items.find(
        (item) => item.trackId === 'video-track' && item.id !== 'video-1' && item.id !== 'video-2',
      )

    expect(splitTail).toBeDefined()
    expect(splitTail).toMatchObject({ from: 20, durationInFrames: 20 })
    expect(transitions).toEqual([
      expect.objectContaining({
        leftClipId: splitTail?.id,
        rightClipId: 'video-2',
      }),
    ])
  })

  it('clears linked groups when sync lock splits only one clip from a linked set', () => {
    useItemsStore
      .getState()
      .setTracks([
        makeTrack({ id: 'edited-track', name: 'Edited', order: 0, kind: 'audio' }),
        makeTrack({ id: 'audio-track', name: 'A1', order: 1, kind: 'audio' }),
      ])
    useItemsStore.getState().setItems([
      makeAudioItem({ id: 'edited-anchor', trackId: 'edited-track', durationInFrames: 30 }),
      makeAudioItem({
        id: 'music-bed',
        trackId: 'audio-track',
        durationInFrames: 60,
        linkedGroupId: 'group-1',
      }),
    ])

    propagateInsertedGapToSyncLockedTracks({
      editedTrackIds: new Set(['edited-track']),
      cutFrame: 20,
      amount: 10,
    })

    const splitSegments = useItemsStore
      .getState()
      .items.filter((item) => item.trackId === 'audio-track')
      .sort((left, right) => left.from - right.from)

    expect(splitSegments).toHaveLength(2)
    expect(splitSegments[0]).toMatchObject({
      id: 'music-bed',
      from: 0,
      durationInFrames: 20,
      linkedGroupId: undefined,
    })
    expect(splitSegments[1]).toMatchObject({
      from: 30,
      durationInFrames: 40,
      linkedGroupId: undefined,
    })
  })
})
