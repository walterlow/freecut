import { describe, expect, it, vi } from 'vite-plus/test'
import type { VideoItem } from '@/types/timeline'
import type { VideoFrameSource } from './shared-video-extractor'
import { ReverseVideoFrameCache } from './reverse-video-frame-cache'

function makeVideoFrame() {
  return { close: vi.fn() } as unknown as VideoFrame
}

function makeExtractor(): VideoFrameSource & {
  captureOrder: number[]
  closedFrames: VideoFrame[]
} {
  const closedFrames: VideoFrame[] = []
  const extractor = {
    captureOrder: [] as number[],
    closedFrames,
    async init() {
      return true
    },
    async drawFrame() {
      return false
    },
    async drawFrameWithCapture() {
      return { success: false, capturedFrame: null, capturedSourceTime: null }
    },
    async captureFrame(timestamp: number) {
      extractor.captureOrder.push(Math.round(timestamp * 30))
      const frame = makeVideoFrame()
      closedFrames.push(frame)
      return { success: true, frame, sourceTime: timestamp }
    },
    getLastFailureKind() {
      return 'none' as const
    },
    getDimensions() {
      return { width: 1920, height: 1080 }
    },
    getDuration() {
      return 10
    },
    async prewarmBatch() {
      return -1
    },
    isBatchPrewarmAvailable() {
      return false
    },
    dispose() {},
  }
  return extractor
}

function makeReversedItem(overrides: Partial<VideoItem> = {}): VideoItem {
  return {
    id: 'clip-1',
    type: 'video',
    src: 'file.mp4',
    from: 0,
    durationInFrames: 10,
    sourceStart: 0,
    sourceEnd: 10,
    sourceFps: 30,
    sourceDuration: 300,
    speed: 1,
    isReversed: true,
    transform: {
      x: 0,
      y: 0,
      width: 1920,
      height: 1080,
      rotation: 0,
      opacity: 1,
    },
    ...overrides,
  } as VideoItem
}

describe('ReverseVideoFrameCache', () => {
  it('decodes a reversed export window in ascending source order', async () => {
    const cache = new ReverseVideoFrameCache()
    const extractor = makeExtractor()
    const item = makeReversedItem()

    const frame = await cache.getFrame({
      item,
      extractor,
      frame: 0,
      renderSpan: { from: 0, durationInFrames: 10, sourceStart: 0 },
      fps: 30,
      sourceFps: 30,
      speed: 1,
    })

    expect(frame).not.toBeNull()
    expect(extractor.captureOrder).toEqual([6, 7, 8, 9])

    await cache.getFrame({
      item,
      extractor,
      frame: 1,
      renderSpan: { from: 0, durationInFrames: 10, sourceStart: 0 },
      fps: 30,
      sourceFps: 30,
      speed: 1,
    })
    expect(extractor.captureOrder).toEqual([6, 7, 8, 9])

    cache.dispose()
    for (const cachedFrame of extractor.closedFrames) {
      expect(cachedFrame.close).toHaveBeenCalledTimes(1)
    }
  })
})
