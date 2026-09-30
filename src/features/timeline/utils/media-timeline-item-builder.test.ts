// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import type { MediaMetadata } from '@/types/storage'
import { buildMediaTimelineItems, getMediaSourceTiming } from './media-timeline-item-builder'

function makeMedia(overrides: Partial<MediaMetadata> = {}): MediaMetadata {
  return {
    id: 'media-1',
    storageType: 'handle',
    fileHandle: {} as FileSystemFileHandle,
    fileName: 'clip.mp4',
    fileSize: 1024,
    fileLastModified: Date.now(),
    mimeType: 'video/mp4',
    duration: 10,
    width: 1280,
    height: 720,
    fps: 60,
    codec: 'h264',
    bitrate: 1000,
    tags: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  }
}

describe('getMediaSourceTiming', () => {
  it('preserves source-native FPS when converting trimmed source ranges to project duration', () => {
    expect(
      getMediaSourceTiming({
        media: makeMedia(),
        mediaType: 'video',
        projectFps: 30,
        sourceStart: 60,
        sourceEnd: 180,
      }),
    ).toEqual({
      sourceFps: 60,
      sourceStart: 60,
      sourceEnd: 180,
      sourceDuration: 600,
      durationInFrames: 60,
    })
  })

  it('uses a three-second project-FPS source duration for still images', () => {
    expect(
      getMediaSourceTiming({
        media: makeMedia({ mimeType: 'image/png', duration: 0, fps: undefined }),
        mediaType: 'image',
        projectFps: 24,
      }),
    ).toMatchObject({
      sourceFps: 24,
      sourceStart: 0,
      sourceEnd: 72,
      sourceDuration: 72,
      durationInFrames: 72,
    })
  })
})

describe('buildMediaTimelineItems', () => {
  it('builds linked source-edit video and audio items with shared origin/group IDs and trimmed source range', () => {
    const [videoItem, audioItem] = buildMediaTimelineItems({
      media: makeMedia({ audioCodec: 'aac' }),
      mediaId: 'media-1',
      mediaType: 'video',
      label: 'clip.mp4',
      projectFps: 30,
      blobUrl: 'blob:video',
      thumbnailUrl: 'blob:thumb',
      canvasWidth: 1920,
      canvasHeight: 1080,
      sourceStart: 60,
      sourceEnd: 180,
      placements: {
        primary: { trackId: 'v1', from: 12 },
        linkedAudio: { trackId: 'a1', from: 12 },
      },
      linkVideoAudio: true,
    })

    expect(videoItem?.type).toBe('video')
    expect(audioItem?.type).toBe('audio')
    expect(videoItem?.durationInFrames).toBe(60)
    expect(audioItem?.durationInFrames).toBe(60)
    expect(videoItem?.sourceStart).toBe(60)
    expect(videoItem?.sourceEnd).toBe(180)
    expect(videoItem?.sourceDuration).toBe(600)
    expect(videoItem?.sourceFps).toBe(60)
    expect(videoItem?.originId).toBe(audioItem?.originId)
    expect(videoItem?.linkedGroupId).toBe(audioItem?.linkedGroupId)
  })

  it('can preserve a linked group id on source video even when only video is emitted', () => {
    const [videoItem] = buildMediaTimelineItems({
      media: makeMedia({ audioCodec: 'aac' }),
      mediaId: 'media-1',
      mediaType: 'video',
      label: 'clip.mp4',
      projectFps: 30,
      blobUrl: 'blob:video',
      thumbnailUrl: 'blob:thumb',
      canvasWidth: 1920,
      canvasHeight: 1080,
      placements: { primary: { trackId: 'v1', from: 12, durationInFrames: 60 } },
      createLinkedGroupId: true,
    })

    expect(videoItem?.type).toBe('video')
    expect(videoItem?.linkedGroupId).toEqual(expect.any(String))
  })

  it('keeps standalone audio unlinked', () => {
    const [audioItem] = buildMediaTimelineItems({
      media: makeMedia({
        mimeType: 'audio/wav',
        fps: undefined,
        width: undefined,
        height: undefined,
      }),
      mediaId: 'audio-1',
      mediaType: 'audio',
      label: 'clip.wav',
      projectFps: 30,
      blobUrl: 'blob:audio',
      canvasWidth: 1920,
      canvasHeight: 1080,
      placements: { primary: { trackId: 'a1', from: 0, durationInFrames: 90 } },
    })

    expect(audioItem?.type).toBe('audio')
    expect(audioItem?.linkedGroupId).toBeUndefined()
    expect(audioItem?.sourceFps).toBe(30)
    expect(audioItem?.sourceEnd).toBe(90)
  })

  it('automatically sets projection360 on 2:1 equirectangular or Insta360 media', () => {
    const [pano360] = buildMediaTimelineItems({
      media: makeMedia({ width: 5760, height: 2880 }),
      mediaId: 'pano-1',
      mediaType: 'video',
      label: 'drone_360.insv',
      projectFps: 30,
      blobUrl: 'blob:video',
      canvasWidth: 1920,
      canvasHeight: 1080,
      placements: { primary: { trackId: 'v1', from: 0, durationInFrames: 90 } },
    })

    expect(pano360?.projection360).toBeDefined()
    expect(pano360?.projection360?.enabled).toBe(true)
    expect(pano360?.projection360?.preset).toBe('linear')
    expect(pano360?.projection360?.fov).toBe(78)
  })
})
