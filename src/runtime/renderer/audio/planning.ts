/**
 * Decides what audio a composition has: segment extraction, whether the
 * windowed mixer can stream it, and whether a packet-copy passthrough is safe.
 */

import type { ResolvedAudioEqSettings } from '@/types/audio'
import type { CompositionInputProps } from '@/types/export'
import type { Keyframe as VolumeKeyframe } from '@/types/keyframe'
import type { AudioItem, CompositionItem, TimelineItem, VideoItem } from '@/types/timeline'
import type { Transition } from '@/types/transition'
import { createLogger } from '@/shared/logging/logger'
import { useCompositionsStore } from '@/runtime/renderer/deps/timeline-compositions-contract'
import { getPropertyKeyframes } from '@/runtime/renderer/deps/keyframes-contract'
import { getMediaAudioCodecById } from '@/runtime/renderer/deps/media-library-contract'
import {
  getLinkedCompositionAudioCompanion,
  isCompositionAudioItem,
} from '@/shared/utils/linked-media'
import {
  appendResolvedAudioEqSources,
  getAudioEqSettings,
  isAudioEqStageActive,
} from '@/shared/utils/audio-eq'
import { getAudioPitchShiftSemitones, isAudioPitchShiftActive } from '@/shared/utils/audio-pitch'
import type { AudioPacketPassthroughPlan, AudioSegment } from './types'
import { buildClipFadeSpan, resolveItemFadeFields } from './clip-fades'
import {
  getLinkedVideoIdsWithAudioForExport,
  getManagedLinkedAudioTransitionsForExport,
} from './linked-media'
import { appendCompositionAudioSegments } from './nested-composition'
import { buildManagedTransitionAudioSegments, type TransitionAudioEntry } from './transitions'

const log = createLogger('CanvasAudio/planning')

type AudioTrack = CompositionInputProps['tracks'][number]

/** Volume keyframes the item animates, or undefined when it has none. */
function getItemVolumeKeyframes(
  composition: CompositionInputProps,
  itemId: string,
): VolumeKeyframe[] | undefined {
  const itemKeyframes = composition.keyframes?.find((keyframe) => keyframe.itemId === itemId)
  const volumeKeyframes = getPropertyKeyframes(itemKeyframes, 'volume')
  return volumeKeyframes.length > 0 ? volumeKeyframes : undefined
}

/**
 * The entry a clip contributes to the transition planner: its own properties
 * plus the track and bus context that apply to every segment of that clip.
 */
function buildTransitionAudioEntry<TItem extends VideoItem | AudioItem>(params: {
  item: TItem
  track: AudioTrack
  type: 'video' | 'audio'
  audioCodec?: string
  busAudioEqStages: ResolvedAudioEqSettings[]
  volumeKeyframes?: VolumeKeyframe[]
}): TransitionAudioEntry<TItem> {
  const { item, track } = params
  return {
    item,
    trackId: track.id,
    muted: track.muted ?? false,
    trackVolume: track.volume ?? 0,
    trackAudioEq: track.audioEq,
    audioEqStages: params.busAudioEqStages,
    type: params.type,
    audioCodec: params.audioCodec,
    volumeKeyframes: params.volumeKeyframes,
    itemFrom: item.from,
  }
}

/**
 * Video items carry their own embedded audio — unless an explicit audio
 * companion replaces it, the track muted it, or the media is gone. Linked
 * companions are collected first, so their video root must not speak too.
 */
function collectVideoAudioEntry(params: {
  composition: CompositionInputProps
  track: AudioTrack
  videoItem: VideoItem
  linkedRootVideoIds: Set<string>
  busAudioEqStages: ResolvedAudioEqSettings[]
  videoById: Map<string, TransitionAudioEntry<VideoItem>>
}): void {
  const { composition, track, videoItem, linkedRootVideoIds, busAudioEqStages, videoById } = params
  if (linkedRootVideoIds.has(videoItem.id)) return
  if (videoItem.embeddedAudioMuted) return
  if (!videoItem.src) return
  videoById.set(
    videoItem.id,
    buildTransitionAudioEntry({
      item: videoItem,
      track,
      type: 'video',
      audioCodec: getMediaAudioCodecById(videoItem.mediaId),
      busAudioEqStages,
      volumeKeyframes: getItemVolumeKeyframes(composition, videoItem.id),
    }),
  )
}

/** A clip's own audio segment, with no transition extension applied. */
function buildPlainAudioSegment(params: {
  item: AudioItem
  track: AudioTrack
  entry: TransitionAudioEntry<AudioItem>
  busAudioEqStages: ResolvedAudioEqSettings[]
  fps: number
}): AudioSegment {
  const { item, track, entry, fps } = params
  const fades = resolveItemFadeFields(item, fps)
  return {
    itemId: item.id,
    trackId: track.id,
    src: item.src,
    startFrame: item.from,
    durationFrames: item.durationInFrames,
    // Use sourceStart as primary for consistency with video items
    // This ensures split audio clips and IO markers work correctly
    sourceStartFrame: item.sourceStart ?? item.trimStart ?? 0,
    sourceFps: item.sourceFps ?? fps,
    volume: (item.volume ?? 0) + (track.volume ?? 0),
    ...fades,
    pitchShiftSemitones: getAudioPitchShiftSemitones(item),
    audioEqStages: appendResolvedAudioEqSources(
      params.busAudioEqStages,
      track.audioEq,
      getAudioEqSettings(item),
    ),
    contentStartOffsetFrames: 0,
    contentEndOffsetFrames: 0,
    fadeInDelayFrames: 0,
    fadeOutLeadFrames: 0,
    clipFadeSpans: [
      buildClipFadeSpan({
        startFrame: 0,
        durationInFrames: item.durationInFrames,
        ...fades,
      }),
    ],
    speed: item.speed ?? 1,
    isReversed: item.isReversed === true,
    muted: track.muted ?? false,
    type: 'audio',
    audioCodec: entry.audioCodec,
    volumeKeyframes: entry.volumeKeyframes,
    itemFrom: item.from,
  }
}

/**
 * Audio items split four ways: pre-comp audio expands as nested segments,
 * managed linked companions join the video transition planner, plain clips in
 * an audio transition are planned per transition, and the rest stand alone.
 */
function collectAudioTrackItem(params: {
  item: AudioItem
  track: AudioTrack
  composition: CompositionInputProps
  managedLinkedAudioIds: Set<string>
  audioTransitionItemIds: Set<string>
  audioOnlySegments: AudioSegment[]
  audioById: Map<string, TransitionAudioEntry<AudioItem>>
  managedLinkedAudioById: Map<string, TransitionAudioEntry<AudioItem>>
  busAudioEqStages: ResolvedAudioEqSettings[]
  fps: number
}): void {
  const { item, track, composition, busAudioEqStages, fps } = params
  if (isCompositionAudioItem(item)) {
    const subComp = useCompositionsStore.getState().getComposition(item.compositionId)
    if (!subComp) return
    appendCompositionAudioSegments({
      segments: params.audioOnlySegments,
      track,
      compositionItem: item,
      subComp,
      fps,
      audioEqStages: appendResolvedAudioEqSources(busAudioEqStages, track.audioEq),
    })
    return
  }
  if (!item.src) return

  const entry = buildTransitionAudioEntry<AudioItem>({
    item,
    track,
    type: 'audio',
    audioCodec: getMediaAudioCodecById(item.mediaId),
    busAudioEqStages,
    volumeKeyframes: getItemVolumeKeyframes(composition, item.id),
  })

  if (params.managedLinkedAudioIds.has(item.id)) {
    params.managedLinkedAudioById.set(item.id, entry)
    return
  }

  if (params.audioTransitionItemIds.has(item.id)) {
    params.audioById.set(item.id, entry)
    return
  }

  params.audioOnlySegments.push(
    buildPlainAudioSegment({ item, track, entry, busAudioEqStages, fps }),
  )
}

/**
 * Managed linked companions are addressed through the transition of the video
 * pair they accompany, so their ids and their per-clip transition definitions
 * are remapped onto the companion clips.
 */
function collectManagedLinkedAudioTransitions(
  timelineItems: TimelineItem[],
  transitions: Transition[],
): { managedLinkedAudioIds: Set<string>; managedLinkedAudioTransitionDefs: Transition[] } {
  const managedLinkedAudioTransitions = getManagedLinkedAudioTransitionsForExport(
    timelineItems,
    transitions,
  )
  const managedLinkedAudioIds = new Set<string>()
  const managedLinkedAudioTransitionDefs: Transition[] = []
  for (const { transition, leftAudio, rightAudio } of managedLinkedAudioTransitions) {
    managedLinkedAudioIds.add(leftAudio.id)
    managedLinkedAudioIds.add(rightAudio.id)
    managedLinkedAudioTransitionDefs.push({
      ...transition,
      leftClipId: leftAudio.id,
      rightClipId: rightAudio.id,
      trackId: leftAudio.trackId,
    })
  }
  return { managedLinkedAudioIds, managedLinkedAudioTransitionDefs }
}

/** Transitions whose two clips are both plain timeline audio clips. */
function collectAudioTransitionTargets(
  timelineItems: TimelineItem[],
  transitions: Transition[],
): { audioTransitionItemIds: Set<string>; audioTransitionDefs: Transition[] } {
  const audioTransitionItemIds = new Set<string>()
  const audioTransitionDefs = transitions.filter((transition) => {
    const leftItem = timelineItems.find((item) => item.id === transition.leftClipId)
    const rightItem = timelineItems.find((item) => item.id === transition.rightClipId)
    if (leftItem?.type !== 'audio' || rightItem?.type !== 'audio') {
      return false
    }
    if (isCompositionAudioItem(leftItem) || isCompositionAudioItem(rightItem)) {
      return false
    }
    audioTransitionItemIds.add(leftItem.id)
    audioTransitionItemIds.add(rightItem.id)
    return true
  })
  return { audioTransitionItemIds, audioTransitionDefs }
}

/**
 * Extract audio segments from composition.
 *
 * @param composition - The composition with tracks
 * @returns Array of audio segments to process
 */
export function extractAudioSegments(
  composition: CompositionInputProps,
  fps: number,
): AudioSegment[] {
  const { tracks = [], transitions = [] } = composition
  const segments: AudioSegment[] = []
  const audioOnlySegments: AudioSegment[] = []
  const videoById = new Map<string, TransitionAudioEntry<VideoItem>>()
  const audioById = new Map<string, TransitionAudioEntry<AudioItem>>()
  const managedLinkedAudioById = new Map<string, TransitionAudioEntry<AudioItem>>()
  const timelineItems = tracks.flatMap((track) => track.items)
  const linkedRootVideoIds = getLinkedVideoIdsWithAudioForExport(timelineItems)
  const { managedLinkedAudioIds, managedLinkedAudioTransitionDefs } =
    collectManagedLinkedAudioTransitions(timelineItems, transitions)
  const busAudioEqStages = appendResolvedAudioEqSources(undefined, composition.busAudioEq)
  const { audioTransitionItemIds, audioTransitionDefs } = collectAudioTransitionTargets(
    timelineItems,
    transitions,
  )

  for (const track of tracks) {
    if (track.visible === false) continue

    for (const item of track.items) {
      if (item.type === 'video') {
        collectVideoAudioEntry({
          composition,
          track,
          videoItem: item as VideoItem,
          linkedRootVideoIds,
          busAudioEqStages,
          videoById,
        })
      } else if (item.type === 'audio') {
        collectAudioTrackItem({
          item: item as AudioItem,
          track,
          composition,
          managedLinkedAudioIds,
          audioTransitionItemIds,
          audioOnlySegments,
          audioById,
          managedLinkedAudioById,
          busAudioEqStages,
          fps,
        })
      }
    }
  }

  const managedVideoSegments = buildManagedTransitionAudioSegments(videoById, transitions, fps)
  const managedAudioSegments = buildManagedTransitionAudioSegments(
    audioById,
    audioTransitionDefs,
    fps,
  )
  const managedLinkedAudioSegments = buildManagedTransitionAudioSegments(
    managedLinkedAudioById,
    managedLinkedAudioTransitionDefs,
    fps,
  )

  segments.push(
    ...managedVideoSegments,
    ...managedAudioSegments,
    ...managedLinkedAudioSegments,
    ...audioOnlySegments,
  )

  appendTopLevelCompositionSegments({ tracks, timelineItems, segments, busAudioEqStages, fps })

  log.info('Extracted audio segments', {
    count: segments.length,
    videoCount: segments.filter((s) => s.type === 'video').length,
    audioCount: segments.filter((s) => s.type === 'audio').length,
  })

  return segments
}

/**
 * Extract audio from sub-compositions (pre-comps).
 *
 * Composition items reference sub-comps that may contain video/audio items with
 * audio; each sub-comp audio segment is offset by the composition item's
 * timeline position.
 */
function appendTopLevelCompositionSegments(params: {
  tracks: CompositionInputProps['tracks']
  timelineItems: TimelineItem[]
  segments: AudioSegment[]
  busAudioEqStages: ResolvedAudioEqSettings[]
  fps: number
}): void {
  const { tracks, timelineItems, segments, busAudioEqStages, fps } = params
  for (const track of tracks) {
    if (track.visible === false) continue
    for (const item of track.items) {
      if (item.type !== 'composition') continue
      const compItem = item as CompositionItem
      if (getLinkedCompositionAudioCompanion(timelineItems, compItem)) continue
      const subComp = useCompositionsStore.getState().getComposition(compItem.compositionId)
      if (!subComp) continue
      appendCompositionAudioSegments({
        segments,
        track,
        compositionItem: compItem,
        subComp,
        fps,
        audioEqStages: appendResolvedAudioEqSources(busAudioEqStages, track.audioEq),
      })
    }
  }
}

export function supportsWindowedAudioSegment(segment: AudioSegment): boolean {
  return (
    Math.abs(segment.speed - 1) <= 0.0001 &&
    !segment.isReversed &&
    !isAudioPitchShiftActive(segment.pitchShiftSemitones) &&
    !segment.audioEqStages?.some(isAudioEqStageActive)
  )
}

/**
 * Long, ordinary clips can be mixed in bounded windows. Stateful DSP paths
 * retain the full-segment implementation so speed/pitch/EQ continuity remains
 * identical to preview.
 */
export function supportsWindowedAudioProcessing(composition: CompositionInputProps): boolean {
  const segments = extractAudioSegments(composition, composition.fps).filter(
    (segment) => !segment.muted,
  )
  return segments.length > 0 && segments.every(supportsWindowedAudioSegment)
}

function hasPacketCopyTimingChanges(segment: AudioSegment, durationInFrames: number): boolean {
  return (
    segment.startFrame !== 0 ||
    segment.durationFrames !== durationInFrames ||
    segment.sourceStartFrame !== 0 ||
    Math.abs(segment.speed - 1) > 0.0001 ||
    segment.isReversed
  )
}

function hasPacketCopyGainChanges(segment: AudioSegment): boolean {
  return (
    segment.volume !== 0 ||
    Boolean(segment.volumeKeyframes?.length) ||
    segment.fadeInFrames !== 0 ||
    segment.fadeOutFrames !== 0 ||
    (segment.crossfadeFadeInFrames ?? 0) !== 0 ||
    (segment.crossfadeFadeOutFrames ?? 0) !== 0
  )
}

function hasPacketCopyContentOffsets(segment: AudioSegment): boolean {
  return (
    (segment.contentStartOffsetFrames ?? 0) !== 0 ||
    (segment.contentEndOffsetFrames ?? 0) !== 0 ||
    (segment.fadeInDelayFrames ?? 0) !== 0 ||
    (segment.fadeOutLeadFrames ?? 0) !== 0
  )
}

function hasPacketCopyFadeSpans(segment: AudioSegment, durationInFrames: number): boolean {
  if ((segment.clipFadeSpans?.length ?? 0) > 1) return true
  return Boolean(
    segment.clipFadeSpans?.some(
      (span) =>
        span.startFrame !== 0 ||
        span.durationInFrames !== durationInFrames ||
        span.fadeInFrames !== 0 ||
        span.fadeOutFrames !== 0,
    ),
  )
}

function hasPacketCopyEffects(segment: AudioSegment): boolean {
  return (
    isAudioPitchShiftActive(segment.pitchShiftSemitones) ||
    segment.audioEqStages.some(isAudioEqStageActive)
  )
}

/**
 * Return a packet-copy plan only when the composition's audio is one continuous,
 * untouched source starting at timestamp zero. Any gain, fade, DSP, speed,
 * reverse, trim-at-start, overlap, or master-bus change requires PCM processing.
 */
export function getAudioPacketPassthroughPlan(
  composition: CompositionInputProps,
): AudioPacketPassthroughPlan | null {
  const durationInFrames = composition.durationInFrames ?? 0
  if (durationInFrames <= 0 || composition.fps <= 0 || (composition.masterBusDb ?? 0) !== 0) {
    return null
  }

  // Ducking needs no guard here: passthrough requires exactly ONE audible
  // segment, and a lone duck source has nothing to duck.
  const segments = extractAudioSegments(composition, composition.fps).filter(
    (segment) => !segment.muted,
  )
  if (segments.length !== 1) return null

  const segment = segments[0]!
  const hasProcessing = [
    hasPacketCopyTimingChanges(segment, durationInFrames),
    hasPacketCopyGainChanges(segment),
    hasPacketCopyContentOffsets(segment),
    hasPacketCopyFadeSpans(segment, durationInFrames),
    hasPacketCopyEffects(segment),
  ].some(Boolean)

  if (hasProcessing) return null
  return { src: segment.src, durationSeconds: durationInFrames / composition.fps }
}
