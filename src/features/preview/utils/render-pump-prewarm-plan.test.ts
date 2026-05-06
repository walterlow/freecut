import { describe, expect, it } from 'vite-plus/test'
import {
  resolveBoundarySourcePrewarmCacheUpdate,
  resolvePrewarmFrameQueueAfterEnqueue,
} from './render-pump-prewarm-plan'

describe('render pump prewarm planner helpers', () => {
  it('enqueues eligible prewarm frames and evicts oldest queued frames at the cap', () => {
    const next = resolvePrewarmFrameQueueAfterEnqueue({
      frame: 14,
      queue: [10, 11, 12],
      queuedFrames: new Set([10, 11, 12]),
      prewarmedFrames: new Set([9]),
      maxQueueSize: 3,
    })

    expect(next).toEqual({
      enqueued: true,
      queue: [11, 12, 14],
      queuedFrames: new Set([11, 12, 14]),
    })
  })

  it('does not enqueue negative, queued, or already prewarmed frames', () => {
    const base = {
      queue: [10],
      queuedFrames: new Set([10]),
      prewarmedFrames: new Set([12]),
      maxQueueSize: 3,
    }

    expect(resolvePrewarmFrameQueueAfterEnqueue({ ...base, frame: -1 }).enqueued).toBe(false)
    expect(resolvePrewarmFrameQueueAfterEnqueue({ ...base, frame: 10 }).enqueued).toBe(false)
    expect(resolvePrewarmFrameQueueAfterEnqueue({ ...base, frame: 12 }).enqueued).toBe(false)
  })

  it('preserves frame queue references when rejecting duplicate prewarm frames', () => {
    const queue = [10]
    const queuedFrames = new Set([10])
    const plan = resolvePrewarmFrameQueueAfterEnqueue({
      frame: 10,
      queue,
      queuedFrames,
      prewarmedFrames: new Set<number>(),
      maxQueueSize: 3,
    })

    expect(plan.enqueued).toBe(false)
    expect(plan.queue).toBe(queue)
    expect(plan.queuedFrames).toBe(queuedFrames)
  })

  it('touches boundary sources with LRU ordering and reports source evictions', () => {
    const next = resolveBoundarySourcePrewarmCacheUpdate({
      src: 'new.mp4',
      currentFrame: 120,
      touchFrameMap: new Map([
        ['old-a.mp4', 20],
        ['old-b.mp4', 30],
      ]),
      prewarmedSources: new Set(['old-a.mp4', 'old-b.mp4']),
      prewarmedSourceOrder: ['old-a.mp4', 'old-b.mp4'],
      cooldownFrames: 6,
      maxSources: 2,
    })

    expect(next).toEqual({
      touched: true,
      wasAlreadyPrewarmed: false,
      evictedSources: ['old-a.mp4'],
      touchFrameMap: new Map([
        ['old-b.mp4', 30],
        ['new.mp4', 120],
      ]),
      prewarmedSources: new Set(['old-b.mp4', 'new.mp4']),
      prewarmedSourceOrder: ['old-b.mp4', 'new.mp4'],
    })
  })

  it('skips boundary source touches inside the frame cooldown window', () => {
    const next = resolveBoundarySourcePrewarmCacheUpdate({
      src: 'clip.mp4',
      currentFrame: 24,
      touchFrameMap: new Map([['clip.mp4', 20]]),
      prewarmedSources: new Set(['clip.mp4']),
      prewarmedSourceOrder: ['clip.mp4'],
      cooldownFrames: 6,
      maxSources: 2,
    })

    expect(next.touched).toBe(false)
    expect(next.prewarmedSourceOrder).toEqual(['clip.mp4'])
    expect(next.evictedSources).toEqual([])
  })
})
