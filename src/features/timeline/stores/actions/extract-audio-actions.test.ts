// @vitest-environment node

import { beforeEach, describe, expect, it } from 'vite-plus/test'
import { makeTimelineTrack, makeTimelineVideoItem } from '../../test-helpers'
import { useItemsStore } from '../items-store'
import { useTimelineCommandStore } from '../timeline-command-store'
import { useTimelineSettingsStore } from '../timeline-settings-store'
import { extractAudioFromVideo } from './item-actions'
import type { AudioItem, VideoItem } from '@/types/timeline'

describe('extractAudioFromVideo action', () => {
  beforeEach(() => {
    useTimelineCommandStore.getState().clearHistory()
    useTimelineSettingsStore.setState({ fps: 30, isDirty: false })
    useItemsStore
      .getState()
      .setTracks([
        makeTimelineTrack({ id: 'track-v1', name: 'V1', kind: 'video', order: 0 }),
        makeTimelineTrack({ id: 'track-a1', name: 'A1', kind: 'audio', order: 1 }),
      ])
    useItemsStore.getState().setItems([
      makeTimelineVideoItem({
        id: 'video-1',
        trackId: 'track-v1',
        from: 0,
        durationInFrames: 90,
        src: 'blob:video.mp4',
        mediaId: 'media-1',
      }),
    ])
  })

  it('extracts audio from video clip into an independent audio track companion', () => {
    const audioId = extractAudioFromVideo('video-1')
    expect(audioId).toBeTruthy()

    const items = useItemsStore.getState().items
    expect(items).toHaveLength(2)

    const updatedVideo = items.find((i) => i.id === 'video-1') as VideoItem
    expect(updatedVideo.embeddedAudioMuted).toBe(true)
    expect(updatedVideo.linkedGroupId).toBeTruthy()

    const audioItem = items.find((i) => i.id === audioId) as AudioItem
    expect(audioItem).toBeDefined()
    expect(audioItem.type).toBe('audio')
    expect(audioItem.trackId).toBe('track-a1')
    expect(audioItem.from).toBe(0)
    expect(audioItem.durationInFrames).toBe(90)
    expect(audioItem.linkedGroupId).toBe(updatedVideo.linkedGroupId)
  })

  it('undo restores pre-extraction state', () => {
    const audioId = extractAudioFromVideo('video-1')
    expect(audioId).toBeTruthy()
    expect(useItemsStore.getState().items).toHaveLength(2)

    useTimelineCommandStore.getState().undo()

    const items = useItemsStore.getState().items
    expect(items).toHaveLength(1)
    const video = items[0] as VideoItem
    expect(video.embeddedAudioMuted).toBeFalsy()
  })

  it('does not duplicate companion if already extracted', () => {
    const audioId1 = extractAudioFromVideo('video-1')
    expect(audioId1).toBeTruthy()
    expect(useItemsStore.getState().items).toHaveLength(2)

    const audioId2 = extractAudioFromVideo('video-1')
    expect(audioId2).toBe(audioId1)
    expect(useItemsStore.getState().items).toHaveLength(2)
  })

  it('returns null for non-existent video', () => {
    const result = extractAudioFromVideo('does-not-exist')
    expect(result).toBeNull()
  })
})
