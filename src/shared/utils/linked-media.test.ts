import { describe, expect, it } from 'vite-plus/test'
import type { AudioItem, VideoItem } from '@/types/timeline'
import {
  getLinkedAudioCompanion,
  getLinkedVideoIdsWithAudio,
  hasLinkedAudioCompanion,
} from './linked-media'

function makeVideoItem(overrides: Partial<VideoItem> = {}): VideoItem {
  return {
    id: 'video-1',
    type: 'video',
    trackId: 'track-v1',
    from: 0,
    durationInFrames: 90,
    src: 'video.mp4',
    mediaId: 'media-1',
    label: 'Video',
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
    src: 'audio.mp4',
    mediaId: 'media-1',
    label: 'Audio',
    ...overrides,
  } as AudioItem
}

describe('linked-media', () => {
  it('finds linked audio companions by linkedGroupId', () => {
    const video = makeVideoItem({ linkedGroupId: 'group-1' })
    const audio = makeAudioItem({ linkedGroupId: 'group-1', trackId: 'track-a2' })

    expect(getLinkedAudioCompanion([video, audio], video)?.id).toBe(audio.id)
    expect(hasLinkedAudioCompanion([video, audio], video)).toBe(true)
  })

  it('falls back to legacy media pairing when linkedGroupId is missing', () => {
    const video = makeVideoItem({ originId: 'origin-1' })
    const audio = makeAudioItem({ originId: 'origin-1', trackId: 'track-a2' })

    expect(getLinkedAudioCompanion([video, audio], video)?.id).toBe(audio.id)
  })

  it('does not treat unrelated audio as a linked companion', () => {
    const video = makeVideoItem({ linkedGroupId: 'group-1' })
    const audio = makeAudioItem({ linkedGroupId: 'group-2', trackId: 'track-a2' })

    expect(getLinkedAudioCompanion([video, audio], video)).toBeNull()
    expect(hasLinkedAudioCompanion([video, audio], video)).toBe(false)
  })

  it('collects only video ids that own linked audio companions', () => {
    const pairedVideo = makeVideoItem({ id: 'video-paired', linkedGroupId: 'group-1' })
    const pairedAudio = makeAudioItem({ id: 'audio-paired', linkedGroupId: 'group-1' })
    const standaloneVideo = makeVideoItem({
      id: 'video-standalone',
      linkedGroupId: undefined,
      mediaId: 'media-2',
    })

    expect(
      Array.from(getLinkedVideoIdsWithAudio([pairedVideo, pairedAudio, standaloneVideo])),
    ).toEqual(['video-paired'])
  })
})
