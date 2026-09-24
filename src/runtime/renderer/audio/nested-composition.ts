/**
 * Expands pre-composition audio into parent-timeline segments, mapping each
 * nested item's visible window into parent frames.
 */

import type { ResolvedAudioEqSettings } from '@/types/audio'
import type { CompositionInputProps } from '@/types/export'
import type { Keyframe as VolumeKeyframe } from '@/types/keyframe'
import type {
  AudioItem,
  CompositionItem,
  TimelineItem,
  TimelineTrack,
  VideoItem,
} from '@/types/timeline'
import {
  timelineToSourceFrames,
  sourceToTimelineFrames,
} from '@/runtime/renderer/deps/timeline-frame-contract'
import { useCompositionsStore } from '@/runtime/renderer/deps/timeline-compositions-contract'
import { getPropertyKeyframes } from '@/runtime/renderer/deps/keyframes-contract'
import { getMediaAudioCodecById } from '@/runtime/renderer/deps/media-library-contract'
import { blobUrlManager } from '@/infrastructure/browser/blob-url-manager'
import {
  getLinkedCompositionAudioCompanion,
  getLinkedVideoIdsWithAudio,
  isCompositionAudioItem,
} from '@/shared/utils/linked-media'
import { appendResolvedAudioEqSources, getAudioEqSettings } from '@/shared/utils/audio-eq'
import { getAudioPitchShiftSemitones } from '@/shared/utils/audio-pitch'
import type { AudioSegment } from './types'
import { buildClipFadeSpan } from './clip-fades'

/** The wrapper composition item's timing, resolved once per expansion. */
interface CompositionWrapperTiming {
  compFrom: number
  wrapperSpeed: number
  wrapperSourceFps: number
  sourceOffset: number
  wrapperSourceEnd: number
}

export function resolveCompositionWrapper(
  compositionItem: { from: number; durationInFrames: number } & Partial<{
    speed: number
    sourceFps: number
    sourceStart: number
    trimStart: number
    sourceEnd: number
  }>,
  fps: number,
): CompositionWrapperTiming {
  const wrapperSpeed = compositionItem.speed ?? 1
  const wrapperSourceFps = compositionItem.sourceFps ?? fps
  const sourceOffset = compositionItem.sourceStart ?? compositionItem.trimStart ?? 0
  return {
    compFrom: compositionItem.from,
    wrapperSpeed,
    wrapperSourceFps,
    sourceOffset,
    wrapperSourceEnd:
      compositionItem.sourceEnd ??
      sourceOffset +
        timelineToSourceFrames(
          compositionItem.durationInFrames,
          wrapperSpeed,
          fps,
          wrapperSourceFps,
        ),
  }
}

/** One nested item's visible window, expressed in PARENT timeline frames. */
interface NestedItemWindow {
  overlapStart: number
  overlapEnd: number
  effectiveStart: number
  effectiveEnd: number
  effectiveDuration: number
  effectiveSourceStart: number
}

/**
 * Map a sub-composition item into parent-timeline coordinates, honouring the
 * wrapper's trim, speed and source fps. Returns null when the item falls
 * entirely outside the wrapper's visible source range.
 *
 * Shared on purpose. The audio mix and the ducking-source scan both have to
 * agree on where a nested item sits, and a second implementation is how they
 * would silently drift apart — a source could be expanded into the mix while
 * not being seen as a duck source, which is precisely the bug this fixes.
 */
export function mapNestedItemWindow(
  subItem: TimelineItem,
  wrapper: CompositionWrapperTiming,
  fps: number,
): NestedItemWindow | null {
  const { compFrom, wrapperSpeed, wrapperSourceFps, sourceOffset, wrapperSourceEnd } = wrapper
  const overlapStart = Math.max(subItem.from, sourceOffset)
  const overlapEnd = Math.min(subItem.from + subItem.durationInFrames, wrapperSourceEnd)
  if (overlapEnd <= overlapStart) return null

  const effectiveStart =
    compFrom +
    sourceToTimelineFrames(overlapStart - sourceOffset, wrapperSpeed, wrapperSourceFps, fps)
  const effectiveEnd =
    compFrom +
    sourceToTimelineFrames(overlapEnd - sourceOffset, wrapperSpeed, wrapperSourceFps, fps)
  const effectiveDuration = Math.max(1, effectiveEnd - effectiveStart)

  const baseSourceStart = subItem.sourceStart ?? subItem.trimStart ?? 0
  const effectiveSourceStart =
    baseSourceStart +
    timelineToSourceFrames(
      overlapStart - subItem.from,
      subItem.speed ?? 1,
      wrapperSourceFps,
      subItem.sourceFps ?? wrapperSourceFps,
    )

  return {
    overlapStart,
    overlapEnd,
    effectiveStart,
    effectiveEnd,
    effectiveDuration,
    effectiveSourceStart,
  }
}

/**
 * Rebuild a nested composition item as a wrapper expressed in PARENT coordinates.
 *
 * Shared with the duck-source scan for the same reason the window mapping is: the
 * `sourceEnd` remap in particular is easy to omit, and omitting it makes a
 * clipped intermediate composition report a different window on each side.
 */
export function buildNestedWrapper(
  subItem: TimelineItem,
  window: NestedItemWindow,
  wrapper: CompositionWrapperTiming,
): CompositionItem | (AudioItem & { compositionId: string }) {
  const { wrapperSpeed, wrapperSourceFps } = wrapper
  return {
    ...subItem,
    from: window.effectiveStart,
    durationInFrames: window.effectiveDuration,
    speed: (subItem.speed ?? 1) * wrapperSpeed,
    sourceStart: window.effectiveSourceStart,
    sourceFps: subItem.sourceFps ?? wrapperSourceFps,
    ...(subItem.sourceEnd !== undefined && {
      sourceEnd: Math.max(
        window.effectiveSourceStart + 1,
        subItem.sourceEnd -
          timelineToSourceFrames(
            subItem.from + subItem.durationInFrames - window.overlapEnd,
            subItem.speed ?? 1,
            wrapperSourceFps,
            subItem.sourceFps ?? wrapperSourceFps,
          ),
      ),
    }),
  } as CompositionItem | (AudioItem & { compositionId: string })
}

type NestedSubComposition = {
  items: TimelineItem[]
  tracks: TimelineTrack[]
  keyframes?: CompositionInputProps['keyframes']
  durationInFrames: number
}

type AppendCompositionAudioSegmentsParams = {
  segments: AudioSegment[]
  track: CompositionInputProps['tracks'][number]
  compositionItem: CompositionItem | (AudioItem & { compositionId: string })
  subComp: NestedSubComposition
  fps: number
  audioEqStages?: ResolvedAudioEqSettings[]
  audioPitchShiftSemitones?: number
  visited?: Set<string>
}

/** Everything one nested expansion resolves once and reuses for every item. */
interface NestedExpansionContext {
  segments: AudioSegment[]
  track: CompositionInputProps['tracks'][number]
  trackVolume: number
  trackMuted: boolean
  subComp: NestedSubComposition
  fps: number
  visited: Set<string>
  wrapper: CompositionWrapperTiming
  wrapperAudioEqStages: ResolvedAudioEqSettings[]
  wrapperAudioPitchShiftSemitones: number
  linkedSubCompVideoIds: Set<string>
}

/** The gain, mute state and source fps a nested item contributes to a segment. */
interface NestedItemMix {
  volume: number
  muted: boolean
  sourceFps: number
}

function resolveNestedExpansionContext(
  params: AppendCompositionAudioSegmentsParams,
): NestedExpansionContext {
  return {
    segments: params.segments,
    track: params.track,
    trackVolume: params.track.volume ?? 0,
    trackMuted: params.track.muted ?? false,
    subComp: params.subComp,
    fps: params.fps,
    visited: params.visited ?? new Set<string>(),
    wrapper: resolveCompositionWrapper(params.compositionItem, params.fps),
    wrapperAudioEqStages: appendResolvedAudioEqSources(
      params.audioEqStages,
      getAudioEqSettings(params.compositionItem),
    ),
    wrapperAudioPitchShiftSemitones:
      (params.audioPitchShiftSemitones ?? 0) + getAudioPitchShiftSemitones(params.compositionItem),
    linkedSubCompVideoIds: getLinkedVideoIdsWithAudio(params.subComp.items),
  }
}

function isNestedCompositionItem(
  subItem: TimelineItem,
): subItem is CompositionItem | (AudioItem & { compositionId: string }) {
  return subItem.type === 'composition' || isCompositionAudioItem(subItem)
}

function isNestedMediaItem(subItem: TimelineItem): subItem is VideoItem | AudioItem {
  return subItem.type === 'video' || subItem.type === 'audio'
}

/** Volumes are dB offsets — sum them so nested levels accumulate correctly. */
function withNestedTrackMix(
  context: NestedExpansionContext,
  subTrack: TimelineTrack | undefined,
): CompositionInputProps['tracks'][number] {
  return {
    ...context.track,
    muted: context.trackMuted || (subTrack?.muted ?? false),
    volume: context.trackVolume + (subTrack?.volume ?? 0),
  }
}

function resolveNestedItemMix(
  context: NestedExpansionContext,
  subItem: VideoItem | AudioItem,
  subTrack: TimelineTrack | undefined,
): NestedItemMix {
  return {
    volume: (subItem.volume ?? 0) + context.trackVolume + (subTrack?.volume ?? 0),
    muted: context.trackMuted || (subTrack?.muted ?? false),
    sourceFps: subItem.sourceFps ?? context.fps,
  }
}

/** Volume keyframes the nested item animates, or undefined when it has none. */
function findNestedVolumeKeyframes(
  subComp: NestedSubComposition,
  itemId: string,
): VolumeKeyframe[] | undefined {
  const itemKeyframes = subComp.keyframes?.find((keyframe) => keyframe.itemId === itemId)
  const volumeKeyframes = getPropertyKeyframes(itemKeyframes, 'volume')
  return volumeKeyframes.length > 0 ? volumeKeyframes : undefined
}

/**
 * Fades are authored in the wrapper's source fps, then clipped to the visible
 * window: the part of a fade that falls outside it never plays.
 */
function resolveNestedFadeFrames(
  subItem: VideoItem | AudioItem,
  window: NestedItemWindow,
  wrapper: CompositionWrapperTiming,
  fps: number,
): { fadeInFrames: number; fadeOutFrames: number } {
  const { wrapperSpeed, wrapperSourceFps } = wrapper
  const rawFadeInFrames = sourceToTimelineFrames(
    (subItem.audioFadeIn ?? 0) * wrapperSourceFps,
    wrapperSpeed,
    wrapperSourceFps,
    fps,
  )
  const rawFadeOutFrames = sourceToTimelineFrames(
    (subItem.audioFadeOut ?? 0) * wrapperSourceFps,
    wrapperSpeed,
    wrapperSourceFps,
    fps,
  )
  const clippedStartFrames = sourceToTimelineFrames(
    window.overlapStart - subItem.from,
    wrapperSpeed,
    wrapperSourceFps,
    fps,
  )
  const clippedEndFrames = sourceToTimelineFrames(
    subItem.from + subItem.durationInFrames - window.overlapEnd,
    wrapperSpeed,
    wrapperSourceFps,
    fps,
  )
  return {
    fadeInFrames: Math.max(0, rawFadeInFrames - clippedStartFrames),
    fadeOutFrames: Math.max(0, rawFadeOutFrames - clippedEndFrames),
  }
}

/** The nested item's source, read from the pre-resolved blob URL when it has one. */
function resolveNestedItemSource(
  subItem: VideoItem | AudioItem,
  linkedSubCompVideoIds: Set<string>,
): string {
  if (subItem.type === 'video' && linkedSubCompVideoIds.has(subItem.id)) return ''
  const blobUrl = subItem.mediaId ? blobUrlManager.get(subItem.mediaId) : null
  return blobUrl ?? subItem.src ?? ''
}

function appendNestedComposition(
  context: NestedExpansionContext,
  subItem: CompositionItem | (AudioItem & { compositionId: string }),
  window: NestedItemWindow,
  subTrack: TimelineTrack | undefined,
): void {
  if (
    subItem.type === 'composition' &&
    getLinkedCompositionAudioCompanion(context.subComp.items, subItem)
  ) {
    return
  }
  if (context.visited.has(subItem.compositionId)) return

  const nestedSubComp = useCompositionsStore.getState().getComposition(subItem.compositionId)
  if (!nestedSubComp) return

  const nestedVisited = new Set(context.visited)
  nestedVisited.add(subItem.compositionId)
  appendCompositionAudioSegments({
    segments: context.segments,
    track: withNestedTrackMix(context, subTrack),
    compositionItem: buildNestedWrapper(subItem, window, context.wrapper),
    subComp: nestedSubComp,
    fps: context.fps,
    audioEqStages: appendResolvedAudioEqSources(context.wrapperAudioEqStages, subTrack?.audioEq),
    audioPitchShiftSemitones: context.wrapperAudioPitchShiftSemitones,
    visited: nestedVisited,
  })
}

function buildNestedItemAudioSegment(params: {
  context: NestedExpansionContext
  subItem: VideoItem | AudioItem
  subTrack: TimelineTrack | undefined
  window: NestedItemWindow
  src: string
  fades: { fadeInFrames: number; fadeOutFrames: number }
  speed: number
  volumeKeyframes?: VolumeKeyframe[]
}): AudioSegment {
  const { context, subItem, subTrack, window, src, fades, speed, volumeKeyframes } = params
  const mix = resolveNestedItemMix(context, subItem, subTrack)
  return {
    itemId: subItem.id,
    trackId: context.track.id,
    src,
    startFrame: window.effectiveStart,
    durationFrames: window.effectiveDuration,
    sourceStartFrame: window.effectiveSourceStart,
    sourceFps: mix.sourceFps,
    volume: mix.volume,
    fadeInFrames: fades.fadeInFrames,
    fadeOutFrames: fades.fadeOutFrames,
    fadeInCurve: subItem.audioFadeInCurve ?? 0,
    fadeOutCurve: subItem.audioFadeOutCurve ?? 0,
    fadeInCurveX: subItem.audioFadeInCurveX ?? 0.52,
    fadeOutCurveX: subItem.audioFadeOutCurveX ?? 0.52,
    pitchShiftSemitones:
      context.wrapperAudioPitchShiftSemitones + getAudioPitchShiftSemitones(subItem),
    audioEqStages: appendResolvedAudioEqSources(
      context.wrapperAudioEqStages,
      subTrack?.audioEq,
      getAudioEqSettings(subItem),
    ),
    contentStartOffsetFrames: 0,
    contentEndOffsetFrames: 0,
    fadeInDelayFrames: 0,
    fadeOutLeadFrames: 0,
    clipFadeSpans: [
      buildClipFadeSpan({
        startFrame: 0,
        durationInFrames: window.effectiveDuration,
        fadeInFrames: fades.fadeInFrames,
        fadeOutFrames: fades.fadeOutFrames,
        fadeInCurve: subItem.audioFadeInCurve,
        fadeOutCurve: subItem.audioFadeOutCurve,
        fadeInCurveX: subItem.audioFadeInCurveX,
        fadeOutCurveX: subItem.audioFadeOutCurveX,
      }),
    ],
    speed,
    isReversed: subItem.isReversed === true,
    muted: mix.muted,
    type: subItem.type as 'video' | 'audio',
    audioCodec: getMediaAudioCodecById(subItem.mediaId),
    volumeKeyframes,
    itemFrom: window.effectiveStart,
  }
}

function appendNestedMediaSegment(
  context: NestedExpansionContext,
  subItem: TimelineItem,
  window: NestedItemWindow,
  subTrack: TimelineTrack | undefined,
): void {
  if (!isNestedMediaItem(subItem)) return

  const src = resolveNestedItemSource(subItem, context.linkedSubCompVideoIds)
  if (!src) return

  context.segments.push(
    buildNestedItemAudioSegment({
      context,
      subItem,
      subTrack,
      window,
      src,
      fades: resolveNestedFadeFrames(subItem, window, context.wrapper, context.fps),
      speed: (subItem.speed ?? 1) * context.wrapper.wrapperSpeed,
      volumeKeyframes: findNestedVolumeKeyframes(context.subComp, subItem.id),
    }),
  )
}

export function appendCompositionAudioSegments(params: AppendCompositionAudioSegmentsParams): void {
  const context = resolveNestedExpansionContext(params)

  for (const subItem of context.subComp.items) {
    const subTrack = context.subComp.tracks.find((candidate) => candidate.id === subItem.trackId)
    const window = mapNestedItemWindow(subItem, context.wrapper, context.fps)
    if (!window) continue

    if (isNestedCompositionItem(subItem)) {
      appendNestedComposition(context, subItem, window, subTrack)
      continue
    }

    appendNestedMediaSegment(context, subItem, window, subTrack)
  }
}
