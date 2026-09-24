/**
 * Expands clips that take part in a transition into audio segments, carrying
 * the pre-roll, overlap extension and crossfade fades the transition window
 * implies.
 */

import type { AudioEqSettings, ResolvedAudioEqSettings } from '@/types/audio'
import type { Keyframe as VolumeKeyframe } from '@/types/keyframe'
import type { AudioItem, VideoItem } from '@/types/timeline'
import type { Transition } from '@/types/transition'
import { resolveTransitionWindows } from '@/shared/timeline/transitions/transition-planner'
import {
  timelineToSourceFrames,
  sourceToTimelineFrames,
} from '@/runtime/renderer/deps/timeline-frame-contract'
import {
  appendResolvedAudioEqSources,
  areAudioEqStagesEqual,
  getAudioEqSettings,
} from '@/shared/utils/audio-eq'
import { getAudioPitchShiftSemitones } from '@/shared/utils/audio-pitch'
import type { AudioSegment } from './types'
import { buildClipFadeSpan, resolveItemFadeFields } from './clip-fades'

type TransitionAudioItem = VideoItem | AudioItem

export interface TransitionAudioEntry<TItem extends TransitionAudioItem> {
  item: TItem
  trackId: string
  muted: boolean
  trackVolume: number
  trackAudioEq?: AudioEqSettings
  audioEqStages?: ResolvedAudioEqSettings[]
  type: 'video' | 'audio'
  audioCodec?: string
  volumeKeyframes?: VolumeKeyframe[]
  itemFrom: number
}

/** How far a transition reaches into each side, plus the overlap fades it implies. */
interface TransitionAudioExtension {
  before: number
  after: number
  overlapFadeOut: number
  overlapFadeIn: number
  fadeInDelay: number
  fadeOutLead: number
}

/** A resolved transition window, as far as segment planning needs it. */
interface TransitionWindowSpan {
  startFrame: number
  endFrame: number
  durationInFrames: number
  leftPortion: number
  rightPortion: number
}

/** A clip's segment carrying the extension it needs to cover its transition window. */
type ExpandedTransitionAudioSegment = AudioSegment & {
  clip: TransitionAudioItem
  beforeFrames: number
  afterFrames: number
}

type EntryInTrackOrder<TItem extends TransitionAudioItem> = {
  id: string
  trackId: string
  item: TItem
}

function getTransitionAudioTrimBefore(item: TransitionAudioItem): number {
  return item.sourceStart ?? item.trimStart ?? item.offset ?? 0
}

function hasExplicitTransitionAudioTrimStart(item: TransitionAudioItem): boolean {
  return item.sourceStart !== undefined || item.trimStart !== undefined || item.offset !== undefined
}

function isContinuousAudioTransition(
  left: TransitionAudioItem,
  right: TransitionAudioItem,
  fps: number,
): boolean {
  const leftSpeed = left.speed ?? 1
  const rightSpeed = right.speed ?? 1
  const leftSourceFps = left.sourceFps ?? fps
  if (Math.abs(leftSpeed - rightSpeed) > 0.0001) return false

  const sameMedia =
    (left.mediaId && right.mediaId && left.mediaId === right.mediaId) ||
    (!!left.src && !!right.src && left.src === right.src)
  if (!sameMedia) return false

  if (left.originId && right.originId && left.originId !== right.originId) return false

  if (Math.abs(getAudioPitchShiftSemitones(left) - getAudioPitchShiftSemitones(right)) > 0.0001)
    return false

  const expectedRightFrom = left.from + left.durationInFrames
  if (Math.abs(right.from - expectedRightFrom) > 2) return false

  const leftTrim = getTransitionAudioTrimBefore(left)
  const rightTrim = getTransitionAudioTrimBefore(right)
  const computedLeftSourceEnd =
    leftTrim + timelineToSourceFrames(left.durationInFrames, leftSpeed, fps, leftSourceFps)
  const storedLeftSourceEnd = left.sourceEnd
  const computedContinuous = Math.abs(rightTrim - computedLeftSourceEnd) <= 2
  const storedContinuous =
    storedLeftSourceEnd !== undefined ? Math.abs(rightTrim - storedLeftSourceEnd) <= 2 : false

  if (computedContinuous || storedContinuous) return true

  return !hasExplicitTransitionAudioTrimStart(right)
}

function createTransitionAudioExtension(): TransitionAudioExtension {
  return {
    before: 0,
    after: 0,
    overlapFadeOut: 0,
    overlapFadeIn: 0,
    fadeInDelay: 0,
    fadeOutLead: 0,
  }
}

function getTransitionAudioExtension(
  extensions: Map<string, TransitionAudioExtension>,
  clipId: string,
): TransitionAudioExtension {
  const existing = extensions.get(clipId)
  if (existing) return existing
  const created = createTransitionAudioExtension()
  extensions.set(clipId, created)
  return created
}

/**
 * Raise one extension field to at least `value`. Extensions only ever grow, and
 * a non-positive value carries no extension at all.
 */
function raiseExtension(
  extensions: Map<string, TransitionAudioExtension>,
  clipId: string,
  key: 'before' | 'after' | 'overlapFadeOut' | 'overlapFadeIn' | 'fadeInDelay' | 'fadeOutLead',
  value: number,
): void {
  if (value <= 0) return
  const extension = getTransitionAudioExtension(extensions, clipId)
  extension[key] = Math.max(extension[key], value)
}

/**
 * Pre-roll and post-roll a window reaches beyond its clips: the incoming clip
 * can start early, the outgoing clip keeps playing past its own end.
 */
function accumulateRollExtensions(
  extensions: Map<string, TransitionAudioExtension>,
  left: TransitionAudioItem,
  right: TransitionAudioItem,
  window: TransitionWindowSpan,
): void {
  raiseExtension(extensions, right.id, 'before', right.from - window.startFrame)
  raiseExtension(
    extensions,
    left.id,
    'after',
    window.endFrame - (left.from + left.durationInFrames),
  )
}

/** The crossfade each side of the cut carries, and how long it holds full gain. */
function accumulateFadeExtensions(
  extensions: Map<string, TransitionAudioExtension>,
  left: TransitionAudioItem,
  right: TransitionAudioItem,
  window: TransitionWindowSpan,
): void {
  if (window.durationInFrames <= 0) return

  raiseExtension(extensions, left.id, 'overlapFadeOut', window.durationInFrames)
  raiseExtension(extensions, left.id, 'fadeOutLead', window.leftPortion)
  raiseExtension(extensions, right.id, 'overlapFadeIn', window.durationInFrames)
  raiseExtension(extensions, right.id, 'fadeInDelay', window.rightPortion)
}

/**
 * Collect the extension every clip needs across all resolved transition
 * windows. Entries that don't participate in any transition still yield plain
 * segments later (zero extensions) — bailing out on empty `transitions` would
 * silently drop the embedded audio of every video item in compositions without
 * transitions.
 */
function collectTransitionAudioExtensions<TItem extends TransitionAudioItem>(
  entriesById: Map<string, TransitionAudioEntry<TItem>>,
  transitions: Transition[],
  fps: number,
): Map<string, TransitionAudioExtension> {
  const clipsById = new Map<string, TItem>()
  for (const [id, entry] of entriesById) {
    clipsById.set(id, entry.item)
  }

  const extensions = new Map<string, TransitionAudioExtension>()
  for (const window of resolveTransitionWindows(transitions, clipsById)) {
    const leftEntry = entriesById.get(window.transition.leftClipId)
    const rightEntry = entriesById.get(window.transition.rightClipId)
    if (!leftEntry || !rightEntry) continue

    const left = leftEntry.item
    const right = rightEntry.item
    if (isContinuousAudioTransition(left, right, fps)) continue

    accumulateRollExtensions(extensions, left, right, window)
    accumulateFadeExtensions(extensions, left, right, window)
  }

  return extensions
}

function listEntriesInTrackOrder<TItem extends TransitionAudioItem>(
  entriesById: Map<string, TransitionAudioEntry<TItem>>,
): Array<EntryInTrackOrder<TItem>> {
  return Array.from(entriesById.entries())
    .map(([id, entry]) => ({
      id,
      trackId: entry.trackId,
      item: entry.item,
    }))
    .toSorted((a, b) => {
      if (a.trackId !== b.trackId) return a.trackId.localeCompare(b.trackId)
      if (a.item.from !== b.item.from) return a.item.from - b.item.from
      return a.id.localeCompare(b.id)
    })
}

/**
 * A clip whose predecessor plays the same source continuously has no trim of
 * its own: its source position follows on from the predecessor's.
 */
function resolveContinuityTrimBeforeById<TItem extends TransitionAudioItem>(
  entriesById: Map<string, TransitionAudioEntry<TItem>>,
  fps: number,
): Map<string, number> {
  const resolvedTrimBeforeById = new Map<string, number>()
  const previousByTrack = new Map<string, TItem>()

  for (const entry of listEntriesInTrackOrder(entriesById)) {
    const clip = entry.item
    const explicitTrimBefore = getTransitionAudioTrimBefore(clip)
    let resolvedTrimBefore = explicitTrimBefore

    if (!hasExplicitTransitionAudioTrimStart(clip)) {
      const previous = previousByTrack.get(entry.trackId)
      if (previous && isContinuousAudioTransition(previous, clip, fps)) {
        const previousTrimBefore =
          resolvedTrimBeforeById.get(previous.id) ?? getTransitionAudioTrimBefore(previous)
        resolvedTrimBefore =
          previousTrimBefore +
          timelineToSourceFrames(
            previous.durationInFrames,
            previous.speed ?? 1,
            fps,
            previous.sourceFps ?? fps,
          )
      }
    }

    resolvedTrimBeforeById.set(clip.id, resolvedTrimBefore)
    previousByTrack.set(entry.trackId, clip)
  }

  return resolvedTrimBeforeById
}

/**
 * The crossfade the segment carries: the overlap window when the transition has
 * one, otherwise whatever pre-roll or post-roll the clip gained.
 */
function resolveCrossfadeFrames(
  extension: TransitionAudioExtension,
  before: number,
  after: number,
): { crossfadeFadeInFrames: number | undefined; crossfadeFadeOutFrames: number | undefined } {
  const crossfadeFadeInFrames =
    extension.overlapFadeIn > 0 ? extension.overlapFadeIn : before > 0 ? before : undefined
  const crossfadeFadeOutFrames =
    extension.overlapFadeOut > 0 ? extension.overlapFadeOut : after > 0 ? after : undefined
  return { crossfadeFadeInFrames, crossfadeFadeOutFrames }
}

function expandTransitionEntry<TItem extends TransitionAudioItem>(params: {
  entry: TransitionAudioEntry<TItem>
  extensions: Map<string, TransitionAudioExtension>
  resolvedTrimBeforeById: Map<string, number>
  fps: number
}): ExpandedTransitionAudioSegment {
  const { entry, extensions, resolvedTrimBeforeById, fps } = params
  const item = entry.item
  const speed = item.speed ?? 1
  const sourceFps = item.sourceFps ?? fps
  const baseTrimBefore = resolvedTrimBeforeById.get(item.id) ?? getTransitionAudioTrimBefore(item)
  const extension = extensions.get(item.id) ?? createTransitionAudioExtension()
  const maxBeforeBySource =
    speed > 0 ? sourceToTimelineFrames(baseTrimBefore, speed, sourceFps, fps) : 0
  const before = Math.max(0, Math.min(extension.before, maxBeforeBySource))
  const after = Math.max(0, extension.after)
  const { crossfadeFadeInFrames, crossfadeFadeOutFrames } = resolveCrossfadeFrames(
    extension,
    before,
    after,
  )
  const fades = resolveItemFadeFields(item, fps)

  return {
    itemId: item.id,
    trackId: entry.trackId,
    clip: item,
    src: item.src,
    startFrame: item.from - before,
    durationFrames: item.durationInFrames + before + after,
    sourceStartFrame: baseTrimBefore - timelineToSourceFrames(before, speed, fps, sourceFps),
    sourceFps,
    volume: (item.volume ?? 0) + entry.trackVolume,
    ...fades,
    pitchShiftSemitones: getAudioPitchShiftSemitones(item),
    contentStartOffsetFrames: before,
    contentEndOffsetFrames: after,
    fadeInDelayFrames: extension.fadeInDelay,
    fadeOutLeadFrames: extension.fadeOutLead,
    clipFadeSpans: [
      buildClipFadeSpan({
        startFrame: before,
        durationInFrames: item.durationInFrames,
        ...fades,
      }),
    ],
    crossfadeFadeInFrames,
    crossfadeFadeOutFrames,
    speed,
    isReversed: item.isReversed === true,
    muted: entry.muted,
    type: entry.type,
    audioCodec: entry.audioCodec,
    audioEqStages: appendResolvedAudioEqSources(
      entry.audioEqStages,
      entry.trackAudioEq,
      getAudioEqSettings(item),
    ),
    beforeFrames: before,
    afterFrames: after,
    volumeKeyframes: entry.volumeKeyframes,
    itemFrom: entry.itemFrom,
  }
}

/** The two clips play the same source back to back, so their audio can merge. */
function haveSameSourceForMerge(
  left: ExpandedTransitionAudioSegment,
  right: ExpandedTransitionAudioSegment,
  fps: number,
): boolean {
  if (!isContinuousAudioTransition(left.clip, right.clip, fps)) return false
  if (left.src !== right.src) return false
  if (Math.abs(left.speed - right.speed) > 0.0001) return false
  return left.isReversed === right.isReversed
}

/** Gain, mute and EQ agree, so neither side colours the merged audio differently. */
function haveSameMixForMerge(
  left: ExpandedTransitionAudioSegment,
  right: ExpandedTransitionAudioSegment,
): boolean {
  if (Math.abs(left.volume - right.volume) > 0.0001) return false
  if (left.muted !== right.muted) return false
  if (!areAudioEqStagesEqual(left.audioEqStages, right.audioEqStages)) return false
  return Math.abs(left.pitchShiftSemitones - right.pitchShiftSemitones) <= 0.0001
}

/** Neither clip extends past the cut, and no keyframed volume needs its own item. */
function haveMergeableBoundaries(
  left: ExpandedTransitionAudioSegment,
  right: ExpandedTransitionAudioSegment,
): boolean {
  if (left.afterFrames !== 0 || right.beforeFrames !== 0) return false
  return !left.volumeKeyframes && !right.volumeKeyframes
}

function canMergeContinuousBoundary(
  left: ExpandedTransitionAudioSegment,
  right: ExpandedTransitionAudioSegment,
  fps: number,
): boolean {
  return (
    haveSameSourceForMerge(left, right, fps) &&
    haveSameMixForMerge(left, right) &&
    haveMergeableBoundaries(left, right)
  )
}

function mergeContinuationIntoActive(
  active: ExpandedTransitionAudioSegment,
  segment: ExpandedTransitionAudioSegment,
): void {
  const activeStartFrame = active.startFrame
  const mergedEnd = segment.startFrame + segment.durationFrames
  active.durationFrames = mergedEnd - active.startFrame
  active.fadeOutFrames = segment.fadeOutFrames
  active.fadeOutCurve = segment.fadeOutCurve
  active.fadeOutCurveX = segment.fadeOutCurveX
  active.contentEndOffsetFrames = segment.contentEndOffsetFrames
  active.fadeOutLeadFrames = segment.fadeOutLeadFrames
  active.crossfadeFadeOutFrames = segment.crossfadeFadeOutFrames
  active.clipFadeSpans = [
    ...(active.clipFadeSpans ?? []),
    ...(segment.clipFadeSpans ?? []).map((span) => ({
      ...span,
      startFrame: span.startFrame + (segment.startFrame - activeStartFrame),
    })),
  ]
  active.clip = segment.clip
  active.afterFrames = segment.afterFrames
}

function toAudioSegment(segment: ExpandedTransitionAudioSegment): AudioSegment {
  return {
    itemId: segment.itemId,
    trackId: segment.trackId,
    src: segment.src,
    startFrame: segment.startFrame,
    durationFrames: segment.durationFrames,
    sourceStartFrame: segment.sourceStartFrame,
    sourceFps: segment.sourceFps,
    volume: segment.volume,
    fadeInFrames: segment.fadeInFrames,
    fadeOutFrames: segment.fadeOutFrames,
    fadeInCurve: segment.fadeInCurve,
    fadeOutCurve: segment.fadeOutCurve,
    fadeInCurveX: segment.fadeInCurveX,
    fadeOutCurveX: segment.fadeOutCurveX,
    pitchShiftSemitones: segment.pitchShiftSemitones,
    audioEqStages: segment.audioEqStages,
    contentStartOffsetFrames: segment.contentStartOffsetFrames,
    contentEndOffsetFrames: segment.contentEndOffsetFrames,
    fadeInDelayFrames: segment.fadeInDelayFrames,
    fadeOutLeadFrames: segment.fadeOutLeadFrames,
    clipFadeSpans: segment.clipFadeSpans,
    crossfadeFadeInFrames: segment.crossfadeFadeInFrames,
    crossfadeFadeOutFrames: segment.crossfadeFadeOutFrames,
    speed: segment.speed,
    isReversed: segment.isReversed,
    muted: segment.muted,
    type: segment.type,
    audioCodec: segment.audioCodec,
    volumeKeyframes: segment.volumeKeyframes,
    itemFrom: segment.itemFrom,
  }
}

/** Clips play in timeline order, so a continuous cut merges into one segment. */
function mergeContinuationSegments(
  sortedSegments: ExpandedTransitionAudioSegment[],
  fps: number,
): AudioSegment[] {
  const mergedSegments: AudioSegment[] = []
  let active: ExpandedTransitionAudioSegment | null = null

  for (const segment of sortedSegments) {
    if (!active) {
      active = { ...segment }
      continue
    }

    if (canMergeContinuousBoundary(active, segment, fps)) {
      mergeContinuationIntoActive(active, segment)
      continue
    }

    mergedSegments.push(toAudioSegment(active))
    active = { ...segment }
  }

  if (active) {
    mergedSegments.push(toAudioSegment(active))
  }

  return mergedSegments
}

export function buildManagedTransitionAudioSegments<TItem extends TransitionAudioItem>(
  entriesById: Map<string, TransitionAudioEntry<TItem>>,
  transitions: Transition[],
  fps: number,
): AudioSegment[] {
  if (entriesById.size === 0) return []

  const extensions = collectTransitionAudioExtensions(entriesById, transitions, fps)
  const resolvedTrimBeforeById = resolveContinuityTrimBeforeById(entriesById, fps)
  const expandedSegments = Array.from(entriesById.values(), (entry) =>
    expandTransitionEntry({ entry, extensions, resolvedTrimBeforeById, fps }),
  )

  const sortedSegments = expandedSegments.toSorted((a, b) => {
    if (a.startFrame !== b.startFrame) return a.startFrame - b.startFrame
    return a.itemId.localeCompare(b.itemId)
  })

  return mergeContinuationSegments(sortedSegments, fps)
}
