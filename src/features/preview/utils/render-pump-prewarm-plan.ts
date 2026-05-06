type ScrubPrewarmFrameQueueInput = {
  frame: number
  queue: number[]
  queuedFrames: Set<number>
  prewarmedFrames: Set<number>
  maxQueueSize: number
}

type ScrubPrewarmFrameQueuePlan = {
  enqueued: boolean
  queue: number[]
  queuedFrames: Set<number>
}

type BoundarySourcePrewarmCacheInput = {
  src: string
  currentFrame: number
  touchFrameEntries: Array<[string, number]>
  prewarmedSources: Set<string>
  prewarmedSourceOrder: string[]
  cooldownFrames: number
  maxSources: number
}

type BoundarySourcePrewarmCachePlan = {
  touched: boolean
  wasAlreadyPrewarmed: boolean
  evictedSources: string[]
  touchFrameEntries: Array<[string, number]>
  prewarmedSources: Set<string>
  prewarmedSourceOrder: string[]
}

export function resolvePrewarmFrameQueueAfterEnqueue({
  frame,
  queue,
  queuedFrames,
  prewarmedFrames,
  maxQueueSize,
}: ScrubPrewarmFrameQueueInput): ScrubPrewarmFrameQueuePlan {
  const nextQueue = [...queue]
  const nextQueuedFrames = new Set(queuedFrames)

  if (frame < 0 || nextQueuedFrames.has(frame) || prewarmedFrames.has(frame)) {
    return {
      enqueued: false,
      queue: nextQueue,
      queuedFrames: nextQueuedFrames,
    }
  }

  nextQueuedFrames.add(frame)
  nextQueue.push(frame)

  while (nextQueue.length > maxQueueSize) {
    const dropped = nextQueue.shift()
    if (dropped !== undefined) {
      nextQueuedFrames.delete(dropped)
    }
  }

  return {
    enqueued: true,
    queue: nextQueue,
    queuedFrames: nextQueuedFrames,
  }
}

export function resolveBoundarySourcePrewarmCacheUpdate({
  src,
  currentFrame,
  touchFrameEntries,
  prewarmedSources,
  prewarmedSourceOrder,
  cooldownFrames,
  maxSources,
}: BoundarySourcePrewarmCacheInput): BoundarySourcePrewarmCachePlan {
  const nextTouchFrameMap = new Map(touchFrameEntries)
  const nextPrewarmedSources = new Set(prewarmedSources)
  const nextPrewarmedSourceOrder = [...prewarmedSourceOrder]
  const wasAlreadyPrewarmed = nextPrewarmedSources.has(src)

  const lastTouchedFrame = nextTouchFrameMap.get(src)
  if (
    lastTouchedFrame !== undefined &&
    Math.abs(currentFrame - lastTouchedFrame) < cooldownFrames
  ) {
    return {
      touched: false,
      wasAlreadyPrewarmed,
      evictedSources: [],
      touchFrameEntries: Array.from(nextTouchFrameMap.entries()),
      prewarmedSources: nextPrewarmedSources,
      prewarmedSourceOrder: nextPrewarmedSourceOrder,
    }
  }

  nextTouchFrameMap.set(src, currentFrame)
  const existingIndex = nextPrewarmedSourceOrder.indexOf(src)
  if (existingIndex >= 0) {
    nextPrewarmedSourceOrder.splice(existingIndex, 1)
  } else {
    nextPrewarmedSources.add(src)
  }
  nextPrewarmedSourceOrder.push(src)

  const evictedSources: string[] = []
  while (nextPrewarmedSourceOrder.length > maxSources) {
    const evicted = nextPrewarmedSourceOrder.shift()
    if (evicted === undefined) break
    if (nextPrewarmedSources.delete(evicted)) {
      nextTouchFrameMap.delete(evicted)
      evictedSources.push(evicted)
    }
  }

  return {
    touched: true,
    wasAlreadyPrewarmed,
    evictedSources,
    touchFrameEntries: Array.from(nextTouchFrameMap.entries()),
    prewarmedSources: nextPrewarmedSources,
    prewarmedSourceOrder: nextPrewarmedSourceOrder,
  }
}
