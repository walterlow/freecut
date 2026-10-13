import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import {
  acquireSharedPreviewVideoExtractorPool,
  SharedVideoExtractorPool,
} from './shared-video-extractor'

const extractorState = vi.hoisted(() => ({
  instances: [] as Array<{
    src: string
    init: ReturnType<typeof vi.fn>
    drawFrame: ReturnType<typeof vi.fn>
    drawFrameWithCapture: ReturnType<typeof vi.fn>
    captureFrame: ReturnType<typeof vi.fn>
    getLastFailureKind: ReturnType<typeof vi.fn>
    getDimensions: ReturnType<typeof vi.fn>
    getDuration: ReturnType<typeof vi.fn>
    prewarmBatch: ReturnType<typeof vi.fn>
    isBatchPrewarmAvailable: ReturnType<typeof vi.fn>
    dispose: ReturnType<typeof vi.fn>
  }>,
}))

vi.mock('./canvas-video-extractor', () => ({
  VideoFrameExtractor: vi.fn(function VideoFrameExtractorMock(
    this: Record<string, unknown>,
    src: string,
  ) {
    const instance = {
      src,
      init: vi.fn(async () => true),
      drawFrame: vi.fn(async () => true),
      drawFrameWithCapture: vi.fn(async () => ({
        success: true,
        capturedFrame: null,
        capturedSourceTime: 0,
      })),
      captureFrame: vi.fn(async () => ({ success: true, frame: null, sourceTime: 0 })),
      getLastFailureKind: vi.fn(() => 'none'),
      getDimensions: vi.fn(() => ({ width: 1920, height: 1080 })),
      getDuration: vi.fn(() => 120),
      prewarmBatch: vi.fn(async () => 1),
      isBatchPrewarmAvailable: vi.fn(() => true),
      dispose: vi.fn(),
    }
    extractorState.instances.push(instance)
    Object.assign(this, instance)
  }),
}))

describe('SharedVideoExtractorPool', () => {
  beforeEach(() => {
    extractorState.instances = []
  })

  it('disposes source lanes after the last item using that source is released', async () => {
    const pool = new SharedVideoExtractorPool({ maxLanesPerSource: 2 })
    const ctx = {} as CanvasRenderingContext2D

    const first = pool.getOrCreateItemExtractor('item-1', 'blob:source')
    const second = pool.getOrCreateItemExtractor('item-2', 'blob:source')

    await first.drawFrame(ctx, 0, 0, 0, 1, 1)
    await second.drawFrame(ctx, 1, 0, 0, 1, 1)

    expect(extractorState.instances).toHaveLength(2)

    pool.releaseItem('item-1')

    expect(extractorState.instances[0]!.dispose).not.toHaveBeenCalled()
    expect(extractorState.instances[1]!.dispose).not.toHaveBeenCalled()

    pool.releaseItem('item-2')

    expect(extractorState.instances[0]!.dispose).toHaveBeenCalledTimes(1)
    expect(extractorState.instances[1]!.dispose).toHaveBeenCalledTimes(1)
  })

  it('keeps registered sources allocation-free until one is initialized', async () => {
    const pool = new SharedVideoExtractorPool({ maxActiveSources: 2 })
    const first = pool.getOrCreateItemExtractor('item-1', 'blob:first')
    pool.getOrCreateItemExtractor('item-2', 'blob:second')
    pool.getOrCreateItemExtractor('item-3', 'blob:third')

    expect(extractorState.instances).toHaveLength(0)
    expect(pool.getStats()).toEqual(
      expect.objectContaining({
        registeredBindings: 3,
        sourceStates: 3,
        initializedSources: 0,
        lanes: 0,
        activeOperations: 0,
      }),
    )

    await first.init()

    expect(extractorState.instances).toHaveLength(1)
    expect(extractorState.instances[0]!.src).toBe('blob:first')
    expect(pool.getStats().initializedSources).toBe(1)
  })

  it('evicts least-recently-used decoder lanes beyond the active source bound', async () => {
    const pool = new SharedVideoExtractorPool({ maxActiveSources: 2 })
    const first = pool.getOrCreateItemExtractor('item-1', 'blob:first')
    const second = pool.getOrCreateItemExtractor('item-2', 'blob:second')
    const third = pool.getOrCreateItemExtractor('item-3', 'blob:third')

    await first.init()
    await second.init()
    await third.init()

    expect(extractorState.instances).toHaveLength(3)
    const disposed = extractorState.instances.filter(
      (instance) => instance.dispose.mock.calls.length > 0,
    )
    expect(disposed).toHaveLength(1)
    const wrapperBySource = new Map([
      ['blob:first', first],
      ['blob:second', second],
      ['blob:third', third],
    ])
    expect(wrapperBySource.get(disposed[0]!.src)?.getDuration()).toBe(120)
    expect(wrapperBySource.get(disposed[0]!.src)?.getDimensions()).toEqual({
      width: 1920,
      height: 1080,
    })
    expect(pool.getStats()).toEqual(
      expect.objectContaining({
        initializedSources: 2,
        lanes: 2,
        peakInitializedSources: 2,
        sourceEvictions: 1,
      }),
    )

    const ctx = {} as CanvasRenderingContext2D
    await wrapperBySource.get(disposed[0]!.src)!.drawFrame(ctx, 42.25, 0, 0, 1, 1)
    const reopened = extractorState.instances.findLast(
      (instance) => instance.src === disposed[0]!.src,
    )
    expect(reopened).not.toBe(disposed[0])
    expect(reopened?.drawFrame).toHaveBeenCalledWith(ctx, 42.25, 0, 0, 1, 1)
    expect(pool.getStats().initializedSources).toBe(2)
    expect(pool.getStats().sourceEvictions).toBe(2)
  })

  it('shares preview bindings across renderer leases until the final consumer releases them', async () => {
    const firstLease = acquireSharedPreviewVideoExtractorPool()
    const secondLease = acquireSharedPreviewVideoExtractorPool()
    const first = firstLease.pool.getOrCreateItemExtractor('item-1', 'blob:shared')
    const second = secondLease.pool.getOrCreateItemExtractor('item-1', 'blob:shared')

    expect(first).toBe(second)
    expect(extractorState.instances).toHaveLength(0)

    await first.init()
    expect(extractorState.instances).toHaveLength(1)

    firstLease.pool.releaseItem('item-1', 'blob:shared')
    firstLease.release()
    expect(extractorState.instances[0]!.dispose).not.toHaveBeenCalled()

    secondLease.pool.releaseItem('item-1', 'blob:shared')
    expect(extractorState.instances[0]!.dispose).toHaveBeenCalledTimes(1)
    secondLease.release()
  })
})
