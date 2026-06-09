import { describe, expect, it } from 'vite-plus/test'
import type { AudioItem, VideoItem } from '@/types/timeline'
import {
  makeTimelineAudioItem,
  makeTimelineTrack as makeTrack,
  makeTimelineVideoItem,
} from '../test-helpers'
import { getTrackKind } from './classic-tracks'
import { buildLinkedAudioForVideo, splitUnpairedVideoAudio } from './embedded-audio-split'

function makeVideoItem(overrides: Partial<VideoItem> = {}): VideoItem {
  return makeTimelineVideoItem({
    durationInFrames: 90,
    label: 'Video',
    sourceDuration: 90,
    ...overrides,
  })
}

function makeAudioItem(overrides: Partial<AudioItem> = {}): AudioItem {
  return makeTimelineAudioItem({
    durationInFrames: 90,
    label: 'Audio',
    sourceDuration: 90,
    ...overrides,
  })
}

function counterId(prefix = 'gen'): () => string {
  let n = 0
  return () => `${prefix}-${++n}`
}

const VIDEO_TRACK = makeTrack({ id: 'track-v1', name: 'V1', order: 0, kind: 'video' })
const AUDIO_TRACK = makeTrack({ id: 'track-a1', name: 'A1', order: 1, kind: 'audio' })

describe('splitUnpairedVideoAudio', () => {
  it('splits an audible video with no companion onto an existing free audio track', () => {
    const video = makeVideoItem({ trackId: 'track-v1' })
    const result = splitUnpairedVideoAudio({
      tracks: [VIDEO_TRACK, AUDIO_TRACK],
      items: [video],
      keyframes: [],
      videoHasAudioByMediaId: { 'media-1': true },
      createId: counterId(),
    })

    expect(result.changed).toBe(true)
    // No new track created — the empty A1 had room.
    expect(result.tracks).toHaveLength(2)

    const audios = result.items.filter((item): item is AudioItem => item.type === 'audio')
    expect(audios).toHaveLength(1)
    expect(audios[0]?.trackId).toBe('track-a1')
    expect(audios[0]?.mediaId).toBe('media-1')

    const repairedVideo = result.items.find((item) => item.id === 'video-1') as VideoItem
    expect(repairedVideo.linkedGroupId).toBeTruthy()
    expect(audios[0]?.linkedGroupId).toBe(repairedVideo.linkedGroupId)
  })

  it('creates a new audio track when none exists', () => {
    const result = splitUnpairedVideoAudio({
      tracks: [VIDEO_TRACK],
      items: [makeVideoItem({ trackId: 'track-v1' })],
      keyframes: [],
      videoHasAudioByMediaId: { 'media-1': true },
      createId: counterId(),
    })

    expect(result.changed).toBe(true)
    expect(result.tracks).toHaveLength(2)
    const created = result.tracks.find((track) => track.id !== 'track-v1')
    expect(created && getTrackKind(created)).toBe('audio')
    expect(created?.name).toBe('A1')

    const audio = result.items.find((item): item is AudioItem => item.type === 'audio')
    expect(audio?.trackId).toBe(created?.id)
  })

  it('does not split a video that already has a linked audio companion', () => {
    const video = makeVideoItem({ trackId: 'track-v1', linkedGroupId: 'lg-1' })
    const audio = makeAudioItem({
      id: 'audio-existing',
      trackId: 'track-a1',
      linkedGroupId: 'lg-1',
    })
    const result = splitUnpairedVideoAudio({
      tracks: [VIDEO_TRACK, AUDIO_TRACK],
      items: [video, audio],
      keyframes: [],
      videoHasAudioByMediaId: { 'media-1': true },
      createId: counterId(),
    })

    expect(result.changed).toBe(false)
    expect(result.items).toHaveLength(2)
  })

  it('does not split when embedded audio is muted', () => {
    const result = splitUnpairedVideoAudio({
      tracks: [VIDEO_TRACK, AUDIO_TRACK],
      items: [makeVideoItem({ trackId: 'track-v1', embeddedAudioMuted: true })],
      keyframes: [],
      videoHasAudioByMediaId: { 'media-1': true },
      createId: counterId(),
    })

    expect(result.changed).toBe(false)
  })

  it('does not split when the media has no audio', () => {
    const result = splitUnpairedVideoAudio({
      tracks: [VIDEO_TRACK, AUDIO_TRACK],
      items: [makeVideoItem({ trackId: 'track-v1' })],
      keyframes: [],
      videoHasAudioByMediaId: { 'media-1': false },
      createId: counterId(),
    })

    expect(result.changed).toBe(false)
  })

  it('routes overlapping videos to distinct audio tracks to avoid collisions', () => {
    const videoTrack2 = makeTrack({ id: 'track-v2', name: 'V2', order: 1, kind: 'video' })
    const audioTrack = makeTrack({ id: 'track-a1', name: 'A1', order: 2, kind: 'audio' })
    const result = splitUnpairedVideoAudio({
      tracks: [VIDEO_TRACK, videoTrack2, audioTrack],
      items: [
        makeVideoItem({ id: 'video-1', trackId: 'track-v1', mediaId: 'media-1', from: 0 }),
        makeVideoItem({ id: 'video-2', trackId: 'track-v2', mediaId: 'media-2', from: 0 }),
      ],
      keyframes: [],
      videoHasAudioByMediaId: { 'media-1': true, 'media-2': true },
      createId: counterId(),
    })

    const audios = result.items.filter((item): item is AudioItem => item.type === 'audio')
    expect(audios).toHaveLength(2)
    const trackIds = new Set(audios.map((audio) => audio.trackId))
    // One reuses A1, the other needs a freshly created audio track.
    expect(trackIds.size).toBe(2)
    expect(result.tracks).toHaveLength(4)
  })

  it('clones video volume keyframes onto the generated audio', () => {
    const result = splitUnpairedVideoAudio({
      tracks: [VIDEO_TRACK, AUDIO_TRACK],
      items: [makeVideoItem({ id: 'video-1', trackId: 'track-v1' })],
      keyframes: [
        {
          itemId: 'video-1',
          properties: [
            {
              property: 'volume',
              keyframes: [{ id: 'kf-1', frame: 0, value: -6, easing: 'linear' }],
            },
          ],
        },
      ],
      videoHasAudioByMediaId: { 'media-1': true },
      createId: counterId(),
    })

    const audio = result.items.find((item): item is AudioItem => item.type === 'audio')!
    const audioKeyframes = result.keyframes.find((entry) => entry.itemId === audio.id)
    expect(audioKeyframes?.properties[0]?.property).toBe('volume')
    expect(audioKeyframes?.properties[0]?.keyframes[0]?.value).toBe(-6)
  })
})

describe('buildLinkedAudioForVideo', () => {
  it('reuses an existing audio track that has room', () => {
    const video = makeVideoItem({ trackId: 'track-v1' })
    const { audioItem, newTrack, updatedVideo } = buildLinkedAudioForVideo({
      video,
      tracks: [VIDEO_TRACK, AUDIO_TRACK],
      itemsByTrackId: new Map(),
      createId: counterId(),
    })

    expect(newTrack).toBeNull()
    expect(audioItem.trackId).toBe('track-a1')
    expect(updatedVideo.linkedGroupId).toBe(audioItem.linkedGroupId)
  })

  it('creates an audio track when the only audio track is occupied at that range', () => {
    const video = makeVideoItem({ trackId: 'track-v1', from: 0, durationInFrames: 90 })
    const occupant = makeAudioItem({
      id: 'other',
      trackId: 'track-a1',
      from: 30,
      durationInFrames: 90,
    })
    const { audioItem, newTrack } = buildLinkedAudioForVideo({
      video,
      tracks: [VIDEO_TRACK, AUDIO_TRACK],
      itemsByTrackId: new Map([['track-a1', [occupant]]]),
      createId: counterId(),
    })

    expect(newTrack).not.toBeNull()
    expect(getTrackKind(newTrack!)).toBe('audio')
    expect(audioItem.trackId).toBe(newTrack!.id)
  })

  it('preserves an existing linkedGroupId on the video', () => {
    const video = makeVideoItem({ trackId: 'track-v1', linkedGroupId: 'existing-lg' })
    const { audioItem, updatedVideo } = buildLinkedAudioForVideo({
      video,
      tracks: [VIDEO_TRACK, AUDIO_TRACK],
      itemsByTrackId: new Map(),
      createId: counterId(),
    })

    expect(updatedVideo).toBe(video)
    expect(audioItem.linkedGroupId).toBe('existing-lg')
  })
})
