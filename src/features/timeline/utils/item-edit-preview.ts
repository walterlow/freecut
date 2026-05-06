import type { TimelineItem } from '@/types/timeline'
import { timelineToSourceFrames } from './source-calculations'

export interface PreviewItemUpdate {
  id: string
  from?: number
  durationInFrames?: number
  sourceStart?: number
  sourceEnd?: number
  speed?: number
  hidden?: boolean
}

export function applyTrimStartPreview(
  item: TimelineItem,
  trimDelta: number,
  fps: number,
): PreviewItemUpdate {
  const update: PreviewItemUpdate = {
    id: item.id,
    from: item.from + trimDelta,
    durationInFrames: item.durationInFrames - trimDelta,
  }

  if (item.type === 'video' || item.type === 'audio' || item.type === 'composition') {
    const sourceStart = item.sourceStart ?? 0
    const sourceEnd = item.sourceEnd
    const speed = item.speed ?? 1
    const sourceFps = item.sourceFps ?? fps
    const sourceFramesToTrim = timelineToSourceFrames(trimDelta, speed, fps, sourceFps)

    update.sourceStart = sourceStart + sourceFramesToTrim
    if (sourceEnd !== undefined) {
      update.sourceEnd = sourceEnd
    }
  }

  return update
}

export function applyTrimEndPreview(
  item: TimelineItem,
  trimDelta: number,
  fps: number,
): PreviewItemUpdate {
  const update: PreviewItemUpdate = {
    id: item.id,
    durationInFrames: item.durationInFrames + trimDelta,
  }

  if (item.type === 'video' || item.type === 'audio' || item.type === 'composition') {
    const sourceStart = item.sourceStart ?? 0
    const speed = item.speed ?? 1
    const sourceFps = item.sourceFps ?? fps
    const sourceFramesNeeded = timelineToSourceFrames(
      update.durationInFrames ?? item.durationInFrames,
      speed,
      fps,
      sourceFps,
    )
    update.sourceEnd = sourceStart + sourceFramesNeeded
  }

  return update
}

export function applyMovePreview(item: TimelineItem, fromDelta: number): PreviewItemUpdate {
  return {
    id: item.id,
    from: item.from + fromDelta,
  }
}

export function applySlipPreview(item: TimelineItem, slipDelta: number): PreviewItemUpdate {
  if (
    (item.type !== 'video' && item.type !== 'audio' && item.type !== 'composition') ||
    item.sourceEnd === undefined
  ) {
    return { id: item.id }
  }

  return {
    id: item.id,
    sourceStart: (item.sourceStart ?? 0) + slipDelta,
    sourceEnd: item.sourceEnd + slipDelta,
  }
}

export function applyRateStretchPreview(
  item: TimelineItem,
  newFrom: number,
  newDuration: number,
  newSpeed: number,
  timelineFps: number,
): PreviewItemUpdate {
  const update: PreviewItemUpdate = {
    id: item.id,
    from: newFrom,
    durationInFrames: newDuration,
    speed: newSpeed,
  }

  const isGif = item.type === 'image' && item.label?.toLowerCase().endsWith('.gif')
  if (item.type !== 'video' && item.type !== 'audio' && item.type !== 'composition' && !isGif) {
    return update
  }

  const hasExplicitSourceBounds =
    (item.type === 'video' || item.type === 'audio' || item.type === 'composition') &&
    item.sourceEnd !== undefined

  if (
    !hasExplicitSourceBounds &&
    (item.type === 'video' || item.type === 'audio' || item.type === 'composition')
  ) {
    const sourceStart = item.sourceStart ?? 0
    const sourceFps = item.sourceFps ?? timelineFps
    const sourceFramesNeeded = timelineToSourceFrames(newDuration, newSpeed, timelineFps, sourceFps)
    update.sourceEnd = sourceStart + sourceFramesNeeded
  }

  return update
}
