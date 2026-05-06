import { describe, expect, it } from 'vite-plus/test'
import type { ItemKeyframes } from '@/types/keyframe'
import type { AdjustmentItem, AudioItem, TimelineTrack, VideoItem } from '@/types/timeline'
import { needsLegacyAvTrackLayoutRepair, repairLegacyAvTrackLayout } from './legacy-av-track-repair'

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

function makeVideoItem(overrides: Partial<VideoItem> = {}): VideoItem {
  return {
    id: 'video-1',
    type: 'video',
    trackId: 'track-1',
    from: 0,
    durationInFrames: 90,
    label: 'Video',
    mediaId: 'media-1',
    src: 'blob:video',
    sourceStart: 0,
    sourceDuration: 90,
    sourceFps: 30,
    ...overrides,
  } as VideoItem
}

function makeAudioItem(overrides: Partial<AudioItem> = {}): AudioItem {
  return {
    id: 'audio-1',
    type: 'audio',
    trackId: 'track-a1',
    from: 0,
    durationInFrames: 90,
    label: 'Audio',
    mediaId: 'media-1',
    src: 'blob:audio',
    sourceStart: 0,
    sourceDuration: 90,
    sourceFps: 30,
    ...overrides,
  } as AudioItem
}

describe('repairLegacyAvTrackLayout', () => {
  it('splits legacy video audio onto paired tracks and preserves standalone audio tracks', () => {
    const result = repairLegacyAvTrackLayout({
      tracks: [
        makeTrack({ id: 'track-v1', name: 'Track 1', order: 0 }),
        makeTrack({ id: 'track-v2', name: 'Track 2', order: 1 }),
        makeTrack({ id: 'track-music', name: 'Track 3', order: 2 }),
      ],
      items: [
        makeVideoItem({ id: 'video-1', trackId: 'track-v1', mediaId: 'media-1', label: 'Clip 1' }),
        makeVideoItem({ id: 'video-2', trackId: 'track-v2', mediaId: 'media-2', label: 'Clip 2' }),
        makeAudioItem({
          id: 'music-1',
          trackId: 'track-music',
          mediaId: 'music-1',
          label: 'Music Bed',
        }),
      ],
      keyframes: [],
      fps: 30,
      videoHasAudioByMediaId: {
        'media-1': true,
        'media-2': false,
      },
      createId: (() => {
        let counter = 0
        return () => `generated-${++counter}`
      })(),
    })

    expect(result.changed).toBe(true)
    expect(result.tracks.map((track) => `${track.name}:${track.kind}`)).toEqual([
      'V2:video',
      'V1:video',
      'A1:audio',
      'A2:audio',
    ])
    expect(result.items.filter((item) => item.type === 'audio')).toHaveLength(2)

    const a1Track = result.tracks.find((track) => track.name === 'A1')
    const a2Track = result.tracks.find((track) => track.name === 'A2')
    const generatedAudio = result.items.find(
      (item) => item.type === 'audio' && item.mediaId === 'media-1',
    ) as AudioItem | undefined
    const music = result.items.find((item) => item.id === 'music-1') as AudioItem | undefined
    expect(generatedAudio?.trackId).toBe(a1Track?.id)
    expect(music?.trackId).toBe(a2Track?.id)
    expect(result.items.find((item) => item.id === 'video-1')).toMatchObject({
      linkedGroupId: generatedAudio?.linkedGroupId,
    })
  })

  it('moves existing companion audio to the matching paired lane and clones volume keyframes for generated audio', () => {
    const volumeKeyframes: ItemKeyframes[] = [
      {
        itemId: 'video-1',
        properties: [
          {
            property: 'volume',
            keyframes: [{ id: 'kf-1', frame: 0, value: -6, easing: 'linear' }],
          },
        ],
      },
      {
        itemId: 'video-2',
        properties: [
          {
            property: 'volume',
            keyframes: [{ id: 'kf-2', frame: 0, value: -3, easing: 'linear' }],
          },
        ],
      },
    ]

    const result = repairLegacyAvTrackLayout({
      tracks: [
        makeTrack({ id: 'track-v1', name: 'Track 1', order: 0 }),
        makeTrack({ id: 'track-v2', name: 'Track 2', order: 1 }),
        makeTrack({ id: 'track-a-loose', name: 'Track 3', order: 2 }),
      ],
      items: [
        makeVideoItem({
          id: 'video-1',
          trackId: 'track-v2',
          mediaId: 'media-1',
          from: 15,
          durationInFrames: 45,
        }),
        makeAudioItem({
          id: 'audio-1',
          trackId: 'track-a-loose',
          mediaId: 'media-1',
          from: 15,
          durationInFrames: 45,
        }),
        makeVideoItem({
          id: 'video-2',
          trackId: 'track-v1',
          mediaId: 'media-2',
          from: 0,
          durationInFrames: 30,
        }),
      ],
      keyframes: volumeKeyframes,
      fps: 30,
      videoHasAudioByMediaId: {
        'media-1': true,
        'media-2': true,
      },
      createId: (() => {
        let counter = 0
        return () => `generated-${++counter}`
      })(),
    })

    const v1Track = result.tracks.find((track) => track.name === 'V1')
    const a1Track = result.tracks.find((track) => track.name === 'A1')
    const a2Track = result.tracks.find((track) => track.name === 'A2')
    const existingAudio = result.items.find((item) => item.id === 'audio-1') as
      | AudioItem
      | undefined
    const generatedAudio = result.items.find(
      (item) => item.type === 'audio' && item.id !== 'audio-1',
    ) as AudioItem | undefined

    expect(result.items.find((item) => item.id === 'video-1')?.trackId).toBe(v1Track?.id)
    expect(existingAudio?.trackId).toBe(a1Track?.id)
    expect(generatedAudio).toBeDefined()
    expect(generatedAudio?.trackId).toBe(a2Track?.id)
    expect(result.keyframes.some((entry) => entry.itemId === generatedAudio?.id)).toBe(true)
  })

  it('repairs non-video timelines so visual layers stay on video tracks', () => {
    const tracks = [
      makeTrack({ id: 'track-audio', name: 'Track 1', order: 0 }),
      makeTrack({ id: 'track-fx', name: 'A1', kind: 'audio', order: 1 }),
    ]
    const items = [
      makeAudioItem({
        id: 'audio-1',
        trackId: 'track-audio',
        mediaId: 'music-1',
        label: 'Music Bed',
      }),
      {
        id: 'adj-1',
        type: 'adjustment',
        trackId: 'track-fx',
        from: 0,
        durationInFrames: 60,
        label: 'Adjustment Layer',
      } satisfies AdjustmentItem,
    ]

    expect(needsLegacyAvTrackLayoutRepair({ tracks, items })).toBe(true)

    const result = repairLegacyAvTrackLayout({
      tracks,
      items,
      keyframes: [],
      fps: 30,
      videoHasAudioByMediaId: {},
    })

    expect(result.tracks.map((track) => `${track.name}:${track.kind}`)).toEqual([
      'V1:video',
      'A1:audio',
    ])

    const videoTrackId = result.tracks.find((track) => track.kind === 'video')?.id
    const audioTrackId = result.tracks.find((track) => track.kind === 'audio')?.id
    expect(result.items.find((item) => item.id === 'adj-1')).toMatchObject({
      trackId: videoTrackId,
    })
    expect(result.items.find((item) => item.id === 'audio-1')).toMatchObject({
      trackId: audioTrackId,
    })
  })
})
