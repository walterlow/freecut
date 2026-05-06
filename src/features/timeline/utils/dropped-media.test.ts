import { describe, expect, it } from 'vite-plus/test'
import type { MediaMetadata } from '@/types/storage'
import {
  buildDroppedMediaTimelineItem,
  buildDroppedMediaTimelineItems,
  getDroppedMediaDurationInFrames,
} from './dropped-media'

function makeMedia(overrides: Partial<MediaMetadata> = {}): MediaMetadata {
  return {
    id: 'media-1',
    storageType: 'handle',
    fileHandle: {} as FileSystemFileHandle,
    fileName: 'clip.mp4',
    fileSize: 1024,
    fileLastModified: Date.now(),
    mimeType: 'video/mp4',
    duration: 4,
    width: 1280,
    height: 720,
    fps: 30,
    codec: 'h264',
    bitrate: 1000,
    tags: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  }
}

describe('getDroppedMediaDurationInFrames', () => {
  it('defaults still images to three seconds', () => {
    expect(getDroppedMediaDurationInFrames({ duration: 0 }, 'image', 30)).toBe(90)
  })
})

describe('buildDroppedMediaTimelineItem', () => {
  it('builds a video item with the requested placement and fitted transform', () => {
    const media = makeMedia()
    const item = buildDroppedMediaTimelineItem({
      media,
      mediaId: media.id,
      mediaType: 'video',
      label: media.fileName,
      timelineFps: 30,
      blobUrl: 'blob:test',
      thumbnailUrl: 'blob:thumb',
      canvasWidth: 1920,
      canvasHeight: 1080,
      placement: {
        trackId: 'track-1',
        from: 48,
        durationInFrames: 120,
      },
    })

    expect(item.type).toBe('video')
    expect(item.trackId).toBe('track-1')
    expect(item.from).toBe(48)
    expect(item.durationInFrames).toBe(120)
    expect(item.transform).toEqual({
      x: 0,
      y: 0,
      width: 1920,
      height: 1080,
      rotation: 0,
    })
  })

  it('builds linked video and audio items that stay in sync', () => {
    const media = makeMedia({ audioCodec: 'aac' })
    const [videoItem, audioItem] = buildDroppedMediaTimelineItems({
      media,
      mediaId: media.id,
      mediaType: 'video',
      label: media.fileName,
      timelineFps: 30,
      blobUrl: 'blob:test',
      thumbnailUrl: 'blob:thumb',
      canvasWidth: 1920,
      canvasHeight: 1080,
      linkVideoAudio: true,
      placement: {
        primary: {
          trackId: 'video-track',
          from: 48,
          durationInFrames: 120,
        },
        linkedAudio: {
          trackId: 'audio-track',
          from: 48,
          durationInFrames: 120,
        },
      },
    })

    expect(videoItem?.type).toBe('video')
    expect(audioItem?.type).toBe('audio')
    expect(videoItem?.from).toBe(audioItem?.from)
    expect(videoItem?.durationInFrames).toBe(audioItem?.durationInFrames)
    expect(videoItem?.originId).toBe(audioItem?.originId)
    expect(videoItem?.linkedGroupId).toBe(audioItem?.linkedGroupId)
  })
})
