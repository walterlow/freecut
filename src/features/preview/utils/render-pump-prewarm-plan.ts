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
  touchFrameMap: Map<string, number>
  prewarmedSources: Set<string>
  prewarmedSourceOrder: string[]
  cooldownFrames: number
  maxSources: number
}

type BoundarySourcePrewarmCachePlan = {
  touched: boolean
  wasAlreadyPrewarmed: boolean
  evictedSources: string[]
  touchFrameMap: Map<string, number>
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
  if (frame < 0 || queuedFrames.has(frame) || prewarmedFrames.has(frame)) {
    return {
      enqueued: false,
      queue,
      queuedFrames,
    }
  }

  const nextQueue = [...queue]
  const nextQueuedFrames = new Set(queuedFrames)

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
  touchFrameMap,
  prewarmedSources,
  prewarmedSourceOrder,
  cooldownFrames,
  maxSources,
}: BoundarySourcePrewarmCacheInput): BoundarySourcePrewarmCachePlan {
  const wasAlreadyPrewarmed = prewarmedSources.has(src)

  const lastTouchedFrame = touchFrameMap.get(src)
  if (
    lastTouchedFrame !== undefined &&
    Math.abs(currentFrame - lastTouchedFrame) < cooldownFrames
  ) {
    return {
      touched: false,
      wasAlreadyPrewarmed,
      evictedSources: [],
      touchFrameMap,
      prewarmedSources,
      prewarmedSourceOrder,
    }
  }

  const nextTouchFrameMap = new Map(touchFrameMap)
  const nextPrewarmedSources = new Set(prewarmedSources)
  const nextPrewarmedSourceOrder = [...prewarmedSourceOrder]

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
    touchFrameMap: nextTouchFrameMap,
    prewarmedSources: nextPrewarmedSources,
    prewarmedSourceOrder: nextPrewarmedSourceOrder,
  }
}
