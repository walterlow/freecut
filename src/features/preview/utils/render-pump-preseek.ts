import { getVideoTargetTimeSeconds } from '@/features/preview/deps/composition-runtime'
import { timelineToSourceFrames } from '@/features/preview/deps/timeline-utils'
import type { CompositionItem, TimelineItem, TimelineTrack, VideoItem } from '@/types/timeline'

/** Minimal sub-composition shape preseek needs to see inside compound clips. */
export interface PreseekSubComposition {
  fps: number
  items: TimelineItem[]
}

export interface RenderPumpSourceTimeOptions {
  requireExplicitSourceFps?: boolean
  resolvedMediaFps?: number
  /**
   * Resolve a compound clip's sub-composition so collectors can recurse into
   * its video items (1 level — sub-comps cannot nest). Without it,
   * composition items are skipped, matching the old behavior.
   */
  resolveComposition?: (compositionId: string) => PreseekSubComposition | null
  /**
   * Current-session URL for a video item. Stored `src` is empty (or a stale
   * blob URL from the session that created the item) on workspace projects —
   * the live URL must be resolved by mediaId. Applies to both main-timeline
   * items and sub-comp items; falls back to the item's stored src.
   */
  resolveItemSrc?: (item: VideoItem) => string | null
}

export interface PreseekSourceTarget {
  src: string
  time: number
}

export interface PausedVariableSpeedPrewarmPlan {
  itemIds: string[]
  visibilityFrame: number
  preseekFrame: number
}

function isPreseekableVideoItem(item: TimelineItem): item is VideoItem {
  return item.type === 'video' && typeof item.src === 'string' && item.src.length > 0
}

/**
 * Resolve the URL preseek should decode for a video item. Prefers the
 * current-session URL from `resolveItemSrc` (the stored src is empty or stale
 * on workspace projects); falls back to the stored src when non-empty.
 */
function resolvePreseekVideoSrc(
  item: TimelineItem,
  options: RenderPumpSourceTimeOptions,
): string | null {
  if (item.type !== 'video') return null
  return options.resolveItemSrc?.(item) ?? (item.src || null)
}

function appendSourceTimeBySrc(bySource: Map<string, number[]>, src: string, time: number) {
  const existing = bySource.get(src)
  if (existing) {
    existing.push(time)
  } else {
    bySource.set(src, [time])
  }
}

export function getVideoItemSourceTimeSeconds(
  item: TimelineItem,
  timelineFrame: number,
  timelineFps: number,
  options: RenderPumpSourceTimeOptions = {},
): number | null {
  if (!isPreseekableVideoItem(item)) return null

  const localFrame = timelineFrame - item.from
  if (localFrame < 0 || localFrame >= item.durationInFrames) return null

  const sourceFps = options.requireExplicitSourceFps
    ? item.sourceFps
    : (item.sourceFps ?? options.resolvedMediaFps ?? timelineFps)
  if (!Number.isFinite(sourceFps) || !sourceFps || sourceFps <= 0) {
    return null
  }

  return getVideoTargetTimeSeconds(
    item.sourceStart ?? item.trimStart ?? 0,
    sourceFps,
    localFrame,
    item.speed ?? 1,
    timelineFps,
  )
}

/**
 * Map a parent-timeline frame into a compound clip's sub-composition frame
 * space, honoring the wrapper's trim (sourceStart) and speed. Mirrors
 * CompositionContent's subCompFrame math (composition-content.tsx) so preseek
 * targets land on the same frames the renderer requests. Returns null when
 * the frame falls outside the compound clip.
 */
export function mapTimelineFrameToSubCompositionFrame(
  item: CompositionItem,
  timelineFrame: number,
  timelineFps: number,
  subCompFps: number,
): number | null {
  const relativeFrame = timelineFrame - item.from
  if (relativeFrame < 0 || relativeFrame >= item.durationInFrames) return null

  const sourceOffset = item.sourceStart ?? item.trimStart ?? 0
  return (
    sourceOffset +
    timelineToSourceFrames(
      relativeFrame,
      item.speed ?? 1,
      timelineFps,
      item.sourceFps ?? subCompFps,
    )
  )
}

function collectSubCompositionVideoSourceTimes(
  bySource: Map<string, number[]>,
  item: CompositionItem,
  timelineFrame: number,
  timelineFps: number,
  options: RenderPumpSourceTimeOptions,
): void {
  const subComp = options.resolveComposition?.(item.compositionId)
  if (!subComp || !Number.isFinite(subComp.fps) || subComp.fps <= 0) return

  const subCompFrame = mapTimelineFrameToSubCompositionFrame(
    item,
    timelineFrame,
    timelineFps,
    subComp.fps,
  )
  if (subCompFrame === null) return

  for (const subItem of subComp.items) {
    if (subItem.type !== 'video') continue
    const src = resolvePreseekVideoSrc(subItem, options)
    if (!src) continue

    const sourceTime = getVideoItemSourceTimeSeconds(
      { ...subItem, src },
      subCompFrame,
      subComp.fps,
      options,
    )
    if (sourceTime === null) continue
    appendSourceTimeBySrc(bySource, src, sourceTime)
  }
}

export function collectVisibleTrackVideoSourceTimesBySrc(
  tracks: TimelineTrack[],
  timelineFrame: number,
  timelineFps: number,
  options: RenderPumpSourceTimeOptions & {
    filter?: (item: VideoItem) => boolean
  } = {},
): Map<string, number[]> {
  const bySource = new Map<string, number[]>()

  for (const track of tracks) {
    for (const item of track.items) {
      if (item.type === 'composition') {
        collectSubCompositionVideoSourceTimes(bySource, item, timelineFrame, timelineFps, options)
        continue
      }
      if (item.type !== 'video') continue
      const src = resolvePreseekVideoSrc(item, options)
      if (!src) continue
      if (options.filter && !options.filter(item)) continue

      const sourceTime = getVideoItemSourceTimeSeconds(
        { ...item, src },
        timelineFrame,
        timelineFps,
        options,
      )
      if (sourceTime === null) continue
      appendSourceTimeBySrc(bySource, src, sourceTime)
    }
  }

  return bySource
}

export function collectClipVideoSourceTimesBySrcForFrame(
  items: TimelineItem[],
  timelineFrame: number,
  timelineFps: number,
  options: RenderPumpSourceTimeOptions = {},
): Map<string, number[]> {
  const bySource = new Map<string, number[]>()

  for (const item of items) {
    if (!isPreseekableVideoItem(item)) continue

    const sourceTime = getVideoItemSourceTimeSeconds(item, timelineFrame, timelineFps, options)
    if (sourceTime === null) continue
    appendSourceTimeBySrc(bySource, item.src, sourceTime)
  }

  return bySource
}

export function collectClipVideoSourceTimesBySrcForFrameRange(
  items: TimelineItem[],
  startFrame: number,
  frameCount: number,
  timelineFps: number,
  options: RenderPumpSourceTimeOptions = {},
): Map<string, number[]> {
  const bySource = new Map<string, number[]>()
  const safeFrameCount = Math.max(0, Math.floor(frameCount))

  for (const item of items) {
    if (!isPreseekableVideoItem(item)) continue
    for (let offset = 0; offset < safeFrameCount; offset += 1) {
      const sourceTime = getVideoItemSourceTimeSeconds(
        item,
        startFrame + offset,
        timelineFps,
        options,
      )
      if (sourceTime === null) continue
      appendSourceTimeBySrc(bySource, item.src, sourceTime)
    }
  }

  return bySource
}

export function collectPlaybackStartVariableSpeedPrewarmItemIds(
  tracks: TimelineTrack[],
  timelineFrame: number,
): string[] {
  const itemIds: string[] = []

  for (const track of tracks) {
    for (const item of track.items) {
      if (!isPreseekableVideoItem(item)) continue
      if (timelineFrame < item.from || timelineFrame >= item.from + item.durationInFrames) continue

      const speed = item.speed ?? 1
      if (Math.abs(speed - 1) < 0.01) continue

      const framesIntoClip = timelineFrame - item.from
      if (framesIntoClip <= 2) {
        itemIds.push(item.id)
      }
    }
  }

  return itemIds
}

export function collectPlaybackStartVariableSpeedPreseekTargets(
  tracks: TimelineTrack[],
  timelineFrame: number,
  timelineFps: number,
  lookaheadFrames: number,
): PreseekSourceTarget[] {
  const targets: PreseekSourceTarget[] = []

  for (const track of tracks) {
    for (const item of track.items) {
      if (!isPreseekableVideoItem(item)) continue

      const speed = item.speed ?? 1
      if (Math.abs(speed - 1) < 0.01) continue

      const itemEnd = item.from + item.durationInFrames
      if (item.from > timelineFrame + lookaheadFrames || itemEnd <= timelineFrame) continue

      const targetFrame = Math.min(timelineFrame + lookaheadFrames, itemEnd - 1)
      const sourceTime = getVideoItemSourceTimeSeconds(item, targetFrame, timelineFps)
      if (sourceTime === null) continue

      targets.push({
        src: item.src,
        time: sourceTime,
      })
    }
  }

  return targets
}

export function resolvePausedVariableSpeedPrewarmPlan(
  tracks: TimelineTrack[],
  timelineFrame: number,
  lookaheadFrames: number,
): PausedVariableSpeedPrewarmPlan | null {
  const candidateItemIds: string[] = []
  const candidateIdSet = new Set<string>()

  for (const track of tracks) {
    for (const item of track.items) {
      if (!isPreseekableVideoItem(item)) continue

      const speed = item.speed ?? 1
      if (Math.abs(speed - 1) < 0.01) continue

      if (item.from > timelineFrame && item.from <= timelineFrame + lookaheadFrames) {
        candidateItemIds.push(item.id)
        candidateIdSet.add(item.id)
      }
    }
  }

  if (candidateItemIds.length === 0) {
    return null
  }

  let visibilityFrame = timelineFrame
  let hasCandidate = false

  for (const track of tracks) {
    const varItem = track.items.find((item) => candidateIdSet.has(item.id))
    if (!varItem) continue

    const varTrackOrder = track.order ?? 0
    let latestOccluderEnd = timelineFrame
    for (const otherTrack of tracks) {
      const otherOrder = otherTrack.order ?? 0
      if (otherOrder >= varTrackOrder) continue
      for (const otherItem of otherTrack.items) {
        if (otherItem.type === 'audio' || otherItem.type === 'adjustment') continue
        const otherEnd = otherItem.from + otherItem.durationInFrames
        if (otherItem.from <= timelineFrame + lookaheadFrames && otherEnd > timelineFrame) {
          latestOccluderEnd = Math.max(latestOccluderEnd, otherEnd)
        }
      }
    }
    if (!hasCandidate) {
      visibilityFrame = latestOccluderEnd
      hasCandidate = true
    } else {
      visibilityFrame = Math.min(visibilityFrame, latestOccluderEnd)
    }
  }

  return {
    itemIds: candidateItemIds,
    visibilityFrame,
    preseekFrame: Math.max(timelineFrame, visibilityFrame - 1),
  }
}

/**
 * Seconds of forward jump below which mediabunny's sequential advance is fast
 * enough (~1ms/frame) that a background worker preseek isn't worth queuing.
 */
const JUMP_PRESEEK_FORWARD_THRESHOLD_SECONDS = 3
/**
 * Seconds of backward jump above which a worker preseek is queued. Backward
 * jumps can't ride sequential advance — mediabunny must seek to the previous
 * keyframe and decode forward (300-600ms), so the threshold is much smaller
 * than the forward one.
 */
const JUMP_PRESEEK_BACKWARD_THRESHOLD_SECONDS = 0.5

/**
 * Decide whether a paused playhead jump should queue a background worker
 * preseek for the visible sources at the target frame. Direction-aware: only
 * large forward jumps need worker help, but most backward jumps do.
 */
export function shouldRunJumpPreseek(input: {
  prevFrame: number
  nextFrame: number
  fps: number
  isPlaying: boolean
}): boolean {
  if (input.isPlaying) return false
  const deltaFrames = input.nextFrame - input.prevFrame
  if (deltaFrames === 0) return false
  const thresholdSeconds =
    deltaFrames > 0
      ? JUMP_PRESEEK_FORWARD_THRESHOLD_SECONDS
      : JUMP_PRESEEK_BACKWARD_THRESHOLD_SECONDS
  const thresholdFrames = Math.max(1, Math.round(input.fps * thresholdSeconds))
  return Math.abs(deltaFrames) >= thresholdFrames
}
