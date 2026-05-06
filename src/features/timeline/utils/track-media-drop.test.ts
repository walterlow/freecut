import { describe, expect, it } from 'vite-plus/test'
import { createDefaultClassicTracks } from './classic-tracks'
import {
  buildGhostPreviewsFromTrackMediaDropPlan,
  planTrackMediaDropPlacements,
} from './track-media-drop'

function makeTrack(params: { id: string; name: string; kind: 'video' | 'audio'; order: number }) {
  return {
    id: params.id,
    name: params.name,
    kind: params.kind,
    order: params.order,
    height: 80,
    locked: false,
    visible: true,
    muted: false,
    solo: false,
    volume: 0,
    items: [],
  }
}

describe('planTrackMediaDropPlacements', () => {
  it('plans linked video drops onto both video and audio tracks', () => {
    const tracks = createDefaultClassicTracks(80)

    const result = planTrackMediaDropPlacements({
      entries: [
        {
          payload: { id: 'media-1' },
          label: 'clip.mp4',
          mediaType: 'video',
          durationInFrames: 90,
          hasLinkedAudio: true,
        },
      ],
      dropFrame: 24,
      tracks,
      existingItems: [],
      dropTargetTrackId: 'track-1',
    })

    expect(result.plannedItems).toHaveLength(1)
    expect(result.plannedItems[0]!.placements).toEqual([
      expect.objectContaining({ trackId: 'track-1', mediaType: 'video', from: 24 }),
      expect.objectContaining({ trackId: 'track-2', mediaType: 'audio', from: 24 }),
    ])
  })

  it('maps linked video dropped on V2 to A2', () => {
    const tracks = [
      makeTrack({ id: 'v1', name: 'V1', kind: 'video', order: 0 }),
      makeTrack({ id: 'v2', name: 'V2', kind: 'video', order: 1 }),
      makeTrack({ id: 'a1', name: 'A1', kind: 'audio', order: 2 }),
      makeTrack({ id: 'a2', name: 'A2', kind: 'audio', order: 3 }),
    ]

    const result = planTrackMediaDropPlacements({
      entries: [
        {
          payload: { id: 'media-v2' },
          label: 'clip-v2.mp4',
          mediaType: 'video',
          durationInFrames: 60,
          hasLinkedAudio: true,
        },
      ],
      dropFrame: 30,
      tracks,
      existingItems: [],
      dropTargetTrackId: 'v2',
    })

    expect(result.plannedItems[0]!.placements).toEqual([
      expect.objectContaining({ trackId: 'v2', mediaType: 'video', from: 30 }),
      expect.objectContaining({ trackId: 'a2', mediaType: 'audio', from: 30 }),
    ])
  })

  it('routes linked video dropped on an audio track to the matching video/audio pair', () => {
    const tracks = [
      makeTrack({ id: 'v1', name: 'V1', kind: 'video', order: 0 }),
      makeTrack({ id: 'v2', name: 'V2', kind: 'video', order: 1 }),
      makeTrack({ id: 'a1', name: 'A1', kind: 'audio', order: 2 }),
      makeTrack({ id: 'a2', name: 'A2', kind: 'audio', order: 3 }),
    ]

    const result = planTrackMediaDropPlacements({
      entries: [
        {
          payload: { id: 'media-a2' },
          label: 'clip-a2.mp4',
          mediaType: 'video',
          durationInFrames: 60,
          hasLinkedAudio: true,
        },
      ],
      dropFrame: 42,
      tracks,
      existingItems: [],
      dropTargetTrackId: 'a2',
    })

    expect(result.plannedItems).toHaveLength(1)
    expect(result.plannedItems[0]!.placements).toEqual([
      expect.objectContaining({ trackId: 'v2', mediaType: 'video', from: 42 }),
      expect.objectContaining({ trackId: 'a2', mediaType: 'audio', from: 42 }),
    ])
  })

  it('rejects visual media dropped on an audio track', () => {
    const tracks = createDefaultClassicTracks(80)

    const result = planTrackMediaDropPlacements({
      entries: [
        {
          payload: { id: 'media-2' },
          label: 'still.png',
          mediaType: 'image',
          durationInFrames: 45,
        },
      ],
      dropFrame: 12,
      tracks,
      existingItems: [],
      dropTargetTrackId: 'track-2',
    })

    expect(result.plannedItems).toEqual([])
  })

  it('rejects audio media dropped on a video track', () => {
    const tracks = createDefaultClassicTracks(80)

    const result = planTrackMediaDropPlacements({
      entries: [
        {
          payload: { id: 'media-a1' },
          label: 'voice.wav',
          mediaType: 'audio',
          durationInFrames: 90,
        },
      ],
      dropFrame: 12,
      tracks,
      existingItems: [],
      dropTargetTrackId: 'track-1',
    })

    expect(result.plannedItems).toEqual([])
  })
})

describe('buildGhostPreviewsFromTrackMediaDropPlan', () => {
  it('builds a companion audio ghost on the linked audio track', () => {
    const tracks = createDefaultClassicTracks(80)
    const { plannedItems } = planTrackMediaDropPlacements({
      entries: [
        {
          payload: { id: 'media-1' },
          label: 'clip.mp4',
          mediaType: 'video',
          durationInFrames: 90,
          hasLinkedAudio: true,
        },
      ],
      dropFrame: 24,
      tracks,
      existingItems: [],
      dropTargetTrackId: 'track-1',
    })

    const ghosts = buildGhostPreviewsFromTrackMediaDropPlan({
      plannedItems,
      frameToPixels: (frame) => frame,
    })

    expect(ghosts).toEqual([
      expect.objectContaining({ targetTrackId: 'track-1', type: 'video', left: 24, width: 90 }),
      expect.objectContaining({ targetTrackId: 'track-2', type: 'audio', left: 24, width: 90 }),
    ])
  })
})
