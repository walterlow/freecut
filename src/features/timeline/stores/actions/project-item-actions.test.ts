import { beforeEach, describe, expect, it } from 'vite-plus/test'
import type { AudioItem, TimelineTrack, VideoItem } from '@/types/timeline'
import { useItemsStore } from '../items-store'
import { useTransitionsStore } from '../transitions-store'
import { useKeyframesStore } from '../keyframes-store'
import { useTimelineCommandStore } from '../timeline-command-store'
import { useTimelineSettingsStore } from '../timeline-settings-store'
import { useCompositionsStore } from '../compositions-store'
import { useCompositionNavigationStore } from '../composition-navigation-store'
import {
  getMediaDeletionImpact,
  removeProjectItems,
  updateProjectItem,
} from './project-item-actions'

function makeTrack(
  overrides: Partial<TimelineTrack> & Pick<TimelineTrack, 'id' | 'name' | 'order' | 'kind'>,
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

function makeVideoItem(overrides: Partial<VideoItem> = {}): VideoItem {
  return {
    id: 'video-1',
    type: 'video',
    trackId: 'track-v1',
    from: 0,
    durationInFrames: 60,
    label: 'clip.mp4',
    src: 'blob:video',
    mediaId: 'media-1',
    sourceStart: 0,
    sourceEnd: 60,
    sourceDuration: 120,
    sourceFps: 30,
    ...overrides,
  }
}

function makeAudioItem(overrides: Partial<AudioItem> = {}): AudioItem {
  return {
    id: 'audio-1',
    type: 'audio',
    trackId: 'track-a1',
    from: 0,
    durationInFrames: 60,
    label: 'clip.wav',
    src: 'blob:audio',
    mediaId: 'media-1',
    sourceStart: 0,
    sourceEnd: 60,
    sourceDuration: 120,
    sourceFps: 30,
    ...overrides,
  }
}

describe('project-item-actions', () => {
  beforeEach(() => {
    useItemsStore.getState().setTracks([])
    useItemsStore.getState().setItems([])
    useTransitionsStore.getState().setTransitions([])
    useKeyframesStore.getState().setKeyframes([])
    useCompositionsStore.getState().setCompositions([])
    useTimelineCommandStore.getState().clearHistory()
    useCompositionNavigationStore.getState().resetToRoot()
    useTimelineSettingsStore.getState().setFps(30)
  })

  it('removes media references across the root timeline, nested compounds, and open editor state', () => {
    useItemsStore
      .getState()
      .setTracks([makeTrack({ id: 'track-v1', name: 'V1', kind: 'video', order: 0 })])
    useItemsStore
      .getState()
      .setItems([makeVideoItem({ id: 'root-video', mediaId: 'media-delete', label: 'root.mp4' })])
    useCompositionsStore.getState().setCompositions([
      {
        id: 'comp-a',
        name: 'Comp A',
        tracks: [makeTrack({ id: 'comp-track-v1', name: 'V1', kind: 'video', order: 0 })],
        items: [
          makeVideoItem({
            id: 'nested-video',
            trackId: 'comp-track-v1',
            mediaId: 'media-delete',
            label: 'nested.mp4',
          }),
          makeVideoItem({
            id: 'nested-keep',
            trackId: 'comp-track-v1',
            from: 80,
            mediaId: 'media-keep',
            label: 'keep.mp4',
          }),
        ],
        transitions: [],
        keyframes: [],
        fps: 30,
        width: 1920,
        height: 1080,
        durationInFrames: 140,
      },
    ])

    useCompositionNavigationStore.getState().enterComposition('comp-a', 'Comp A')

    expect(getMediaDeletionImpact(['media-delete'])).toEqual({
      itemIds: ['root-video', 'nested-video'],
      rootReferenceCount: 1,
      nestedReferenceCount: 1,
      totalReferenceCount: 2,
    })

    expect(removeProjectItems(['root-video', 'nested-video'])).toBe(true)

    expect(useItemsStore.getState().items.map((item) => item.id)).toEqual(['nested-keep'])
    expect(
      useCompositionsStore
        .getState()
        .getComposition('comp-a')
        ?.items.map((item) => item.id),
    ).toEqual(['nested-keep'])

    useCompositionNavigationStore.getState().exitComposition()

    expect(useItemsStore.getState().items).toHaveLength(0)
  })

  it('updates items that live in the stashed root timeline while editing a compound clip', () => {
    useItemsStore
      .getState()
      .setTracks([makeTrack({ id: 'track-v1', name: 'V1', kind: 'video', order: 0 })])
    useItemsStore.getState().setItems([
      makeVideoItem({
        id: 'root-video',
        mediaId: 'media-old',
        label: 'old.mp4',
        src: 'blob:old',
      }),
    ])
    useCompositionsStore.getState().setCompositions([
      {
        id: 'comp-a',
        name: 'Comp A',
        tracks: [makeTrack({ id: 'comp-track-v1', name: 'V1', kind: 'video', order: 0 })],
        items: [
          makeVideoItem({ id: 'nested-video', trackId: 'comp-track-v1', mediaId: 'media-nested' }),
        ],
        transitions: [],
        keyframes: [],
        fps: 30,
        width: 1920,
        height: 1080,
        durationInFrames: 60,
      },
    ])

    useCompositionNavigationStore.getState().enterComposition('comp-a', 'Comp A')

    expect(
      updateProjectItem('root-video', {
        mediaId: 'media-new',
        label: 'new.mp4',
        src: 'blob:new',
      }),
    ).toBe(true)

    useCompositionNavigationStore.getState().exitComposition()

    expect(useItemsStore.getState().items[0]).toMatchObject({
      id: 'root-video',
      mediaId: 'media-new',
      label: 'new.mp4',
      src: 'blob:new',
    })
  })

  it('counts a linked audio-video pair as one clip while still removing both timeline items', () => {
    useItemsStore
      .getState()
      .setTracks([
        makeTrack({ id: 'track-v1', name: 'V1', kind: 'video', order: 0 }),
        makeTrack({ id: 'track-a1', name: 'A1', kind: 'audio', order: 1 }),
      ])
    useItemsStore.getState().setItems([
      makeVideoItem({
        id: 'video-ref',
        mediaId: 'media-delete',
        linkedGroupId: 'linked-ref',
      }),
      makeAudioItem({
        id: 'audio-ref',
        trackId: 'track-a1',
        mediaId: 'media-delete',
        linkedGroupId: 'linked-ref',
      }),
    ])

    expect(getMediaDeletionImpact(['media-delete'])).toEqual({
      itemIds: ['video-ref', 'audio-ref'],
      rootReferenceCount: 1,
      nestedReferenceCount: 0,
      totalReferenceCount: 1,
    })

    expect(removeProjectItems(['video-ref', 'audio-ref'])).toBe(true)
    expect(useItemsStore.getState().items).toHaveLength(0)
  })
})
