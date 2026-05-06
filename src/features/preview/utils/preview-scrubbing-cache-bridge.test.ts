import { afterEach, describe, expect, it } from 'vite-plus/test'
import { ScrubbingCache } from './scrubbing-cache'
import {
  getActivePreviewScrubbingCache,
  getActivePreviewVideoFrameEntry,
  setActivePreviewScrubbingCache,
} from './preview-scrubbing-cache-bridge'

function createMockFrame(): ImageBitmap {
  return {
    close() {},
  } as unknown as ImageBitmap
}

describe('preview scrubbing cache bridge', () => {
  afterEach(() => {
    setActivePreviewScrubbingCache(null)
  })

  it('returns the active scrubbing cache instance', () => {
    const cache = new ScrubbingCache()

    setActivePreviewScrubbingCache(cache)

    expect(getActivePreviewScrubbingCache()).toBe(cache)
  })

  it('reads tier-2 video frames from the active scrubbing cache', () => {
    const cache = new ScrubbingCache()
    const frame = createMockFrame()
    cache.putVideoFrame('item-1', frame, 1)

    setActivePreviewScrubbingCache(cache)

    const entry = getActivePreviewVideoFrameEntry('item-1', 1.02, 0.05)

    expect(entry?.frame).toBe(frame)
    expect(entry?.sourceTime).toBe(1)
  })

  it('returns undefined when no scrubbing cache is active', () => {
    expect(getActivePreviewVideoFrameEntry('item-1', 1, 0.05)).toBeUndefined()
  })
})
