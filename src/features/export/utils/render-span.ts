import type { TimelineItem } from '@/types/timeline'
import type { ActiveTransition } from './canvas-transitions'
import { timelineToSourceFrames } from '@/features/export/deps/timeline-frame'

/**
 * Linear source-time ramp applied during a transition window.
 *
 * Pinned at one boundary (the `anchor`) so the rendered source matches the
 * natural source time there — that's where the clip continues to exist outside
 * the transition, so any mismatch would show as a hard jump. At the opposite
 * boundary, the rendered source is offset by `slope * windowDuration` source
 * frames. Used by A-A continuous-split transitions to break the
 * left==right-source-frame symmetry that makes them invisible.
 */
export interface SourceTimeRamp {
  anchor: 'start' | 'end'
  /** Extra source frames added per timeline frame within the window. */
  slope: number
  /** Timeline frame where the ramp begins (inclusive). */
  rampStart: number
  /** Timeline frame where the ramp ends (inclusive). */
  rampEnd: number
}

export interface RenderTimelineSpan {
  from: number
  durationInFrames: number
  sourceStart?: number
  sourceTimeRamp?: SourceTimeRamp
}

interface TransitionParticipantFrameWindow {
  from: number
  durationInFrames: number
}

function isSourceTimedItem(item: TimelineItem): item is TimelineItem & {
  type: 'video' | 'audio' | 'composition'
  sourceStart?: number
  trimStart?: number
  offset?: number
  sourceFps?: number
  speed?: number
} {
  return item.type === 'video' || item.type === 'audio' || item.type === 'composition'
}

function getSourceTimedItemStart(
  item: TimelineItem & {
    sourceStart?: number
    trimStart?: number
    offset?: number
  },
): number {
  return item.sourceStart ?? item.trimStart ?? item.offset ?? 0
}

export function getItemRenderTimelineSpan(item: TimelineItem): RenderTimelineSpan {
  return {
    from: item.from,
    durationInFrames: item.durationInFrames,
    ...(isSourceTimedItem(item) ? { sourceStart: getSourceTimedItemStart(item) } : {}),
  }
}

export function getRenderTimelineSourceStart(
  item: TimelineItem,
  span?: RenderTimelineSpan,
): number {
  if (!isSourceTimedItem(item)) {
    return 0
  }
  return span?.sourceStart ?? getSourceTimedItemStart(item)
}

export function applyRenderTimelineSpan<TItem extends TimelineItem>(
  item: TItem,
  span?: RenderTimelineSpan,
): TItem {
  if (!span) {
    return item
  }

  const hasSameTimelineWindow =
    item.from === span.from && item.durationInFrames === span.durationInFrames
  const nextSourceStart = getRenderTimelineSourceStart(item, span)
  const currentSourceStart = isSourceTimedItem(item) ? getSourceTimedItemStart(item) : undefined
  const hasSameSourceAnchor = currentSourceStart === nextSourceStart

  if (hasSameTimelineWindow && hasSameSourceAnchor) {
    return item
  }

  return {
    ...item,
    from: span.from,
    durationInFrames: span.durationInFrames,
    ...(isSourceTimedItem(item) ? { sourceStart: nextSourceStart } : {}),
  }
}

function resolveTransitionParticipantFrameWindow<TItem extends TimelineItem>(
  clip: TItem,
  activeTransition: Pick<ActiveTransition, 'transitionStart' | 'transitionEnd'>,
): TransitionParticipantFrameWindow {
  const beforeFrames = Math.max(0, clip.from - activeTransition.transitionStart)
  const clipEnd = clip.from + clip.durationInFrames
  const afterFrames = Math.max(0, activeTransition.transitionEnd - clipEnd)

  return {
    from: clip.from - beforeFrames,
    durationInFrames: clip.durationInFrames + beforeFrames + afterFrames,
  }
}

function getTransitionParticipantSourceStart<TItem extends TimelineItem>(
  clip: TItem,
  transitionWindow: TransitionParticipantFrameWindow,
  fps: number,
): number | undefined {
  if (!isSourceTimedItem(clip)) {
    return undefined
  }

  const beforeFrames = Math.max(0, clip.from - transitionWindow.from)
  if (beforeFrames <= 0) {
    return getSourceTimedItemStart(clip)
  }

  const sourceStart = getSourceTimedItemStart(clip)
  const speed = clip.speed ?? 1
  const sourceFps = clip.sourceFps ?? fps
  const prerollSourceFrames = timelineToSourceFrames(beforeFrames, speed, fps, sourceFps)
  return Math.max(0, sourceStart - prerollSourceFrames)
}

export function resolveTransitionRenderTimelineSpan<TItem extends TimelineItem>(
  clip: TItem,
  activeTransition: Pick<ActiveTransition, 'transitionStart' | 'transitionEnd'>,
  fps: number,
  sourceTimeRamp?: SourceTimeRamp,
): RenderTimelineSpan {
  const transitionWindow = resolveTransitionParticipantFrameWindow(clip, activeTransition)
  const sourceStart = getTransitionParticipantSourceStart(clip, transitionWindow, fps)
  return {
    from: transitionWindow.from,
    durationInFrames: transitionWindow.durationInFrames,
    ...(sourceStart !== undefined ? { sourceStart } : {}),
    ...(sourceTimeRamp ? { sourceTimeRamp } : {}),
  }
}

/**
 * Default ramp slope for A-A continuous-split transitions. Slope of 0.5 means
 * each clip plays at +0.5 extra source frames per timeline frame during the
 * transition, i.e. 1.5× decode rate. With both clips ramping in opposite
 * directions, midpoint left↔right separation is `windowDuration / 2` source
 * frames — still visibly distinct but with half the decode pressure (and
 * fewer preview repeat-frame stalls) of a slope-1 ramp. Bumping toward 1
 * sharpens the visible effect at the cost of more in-window decode work.
 */
const A_A_DEFAULT_RAMP_SLOPE = 0.5

/**
 * Detect whether two clips form an A-A continuous split: same source media
 * and the right clip's source starts exactly where the left clip's source
 * ends. This is the case that produces invisible transitions because the
 * symmetric handle expansion makes both clips render identical source frames
 * across the entire transition window.
 */
export function isAAContinuousSplit(
  leftClip: TimelineItem,
  rightClip: TimelineItem,
  fps: number,
): boolean {
  if (leftClip.type !== 'video' || rightClip.type !== 'video') return false
  if (!leftClip.mediaId || leftClip.mediaId !== rightClip.mediaId) return false
  if (leftClip.isReversed || rightClip.isReversed) return false
  const leftSourceStart = leftClip.sourceStart ?? leftClip.trimStart ?? leftClip.offset ?? 0
  const rightSourceStart = rightClip.sourceStart ?? rightClip.trimStart ?? rightClip.offset ?? 0
  const speed = leftClip.speed ?? 1
  const sourceFps = leftClip.sourceFps ?? fps
  const leftSourceFrames = (leftClip.durationInFrames * speed * sourceFps) / fps
  const leftNaturalSourceEnd = leftSourceStart + leftSourceFrames
  return Math.abs(leftNaturalSourceEnd - rightSourceStart) < 0.5
}

/**
 * Build the per-side source-time ramps for an A-A continuous-split
 * transition. Left anchors at the transition start (it exists naturally
 * before that point); right anchors at the transition end. Symmetric slopes
 * keep the perceived total source advancement equal to natural — the ramps
 * only spread the *displayed* source frames so left and right show different
 * content during the overlap.
 */
export function resolveAATransitionRamps(
  leftClip: TimelineItem,
  rightClip: TimelineItem,
  activeTransition: Pick<ActiveTransition, 'transitionStart' | 'transitionEnd'>,
  fps: number,
): { left: SourceTimeRamp; right: SourceTimeRamp } | null {
  if (!isAAContinuousSplit(leftClip, rightClip, fps)) return null
  const common = {
    slope: A_A_DEFAULT_RAMP_SLOPE,
    rampStart: activeTransition.transitionStart,
    rampEnd: activeTransition.transitionEnd,
  }
  return {
    left: { anchor: 'start', ...common },
    right: { anchor: 'end', ...common },
  }
}

/**
 * Compute the extra source-frame offset contributed by a ramp at a given
 * timeline frame. Returns 0 when the frame is outside the ramp window so
 * callers don't need to guard.
 */
export function getSourceFrameRampOffset(ramp: SourceTimeRamp, frame: number): number {
  if (frame < ramp.rampStart || frame > ramp.rampEnd) return 0
  const t = ramp.anchor === 'start' ? frame - ramp.rampStart : frame - ramp.rampEnd
  return ramp.slope * t
}

/**
 * True iff the frame falls inside an active ramp window. Used by renderers to
 * decide whether the DOM-video zero-copy path is valid — when the ramp is
 * active the rendered source time diverges from the element's natural
 * playback, so we must take the decode path.
 */
export function isFrameInsideSourceTimeRamp(ramp: SourceTimeRamp, frame: number): boolean {
  return frame >= ramp.rampStart && frame <= ramp.rampEnd
}
