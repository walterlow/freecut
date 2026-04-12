/**
 * Canvas Audio Processing System
 *
 * Handles audio extraction, processing, mixing, and encoding for client-side export.
 * Supports audio from video items and standalone audio items.
 */

import type { CompositionInputProps } from '@/types/export';
import type { VideoItem, AudioItem, CompositionItem, TimelineItem, TimelineTrack } from '@/types/timeline';
import type { Keyframe as VolumeKeyframe } from '@/types/keyframe';
import type { Transition } from '@/types/transition';
import { createLogger } from '@/shared/logging/logger';
import { resolveTransitionWindows } from '@/domain/timeline/transitions/transition-planner';
import {
  timelineToSourceFrames,
  sourceToTimelineFrames,
  useCompositionsStore,
  collectReachableCompositionIdsFromTracks,
} from '@/features/export/deps/timeline';
import {
  getPropertyKeyframes,
  interpolatePropertyValue,
} from '@/features/export/deps/keyframes';
import { blobUrlManager } from '@/infrastructure/browser/blob-url-manager';
import { getMediaAudioCodecById, resolveMediaUrl } from '@/features/export/deps/media-library';
import { ensureAc3DecoderRegistered, isAc3AudioCodec } from '@/shared/media/ac3-decoder';
import {
  getLinkedAudioCompanion,
  getLinkedCompositionAudioCompanion,
  getLinkedVideoIdsWithAudio,
  isCompositionAudioItem,
} from '@/shared/utils/linked-media';
import { evaluateAudioFadeInCurve, evaluateAudioFadeOutCurve, type AudioClipFadeSpan } from '@/shared/utils/audio-fade-curve';
import { createMediabunnyInputSource } from '@/infrastructure/browser/mediabunny-input-source';

const log = createLogger('CanvasAudio');

// =============================================================================
// PERFORMANCE OPTIMIZATION: Audio Decode Cache
// =============================================================================

/**
 * Cache for decoded audio to avoid re-decoding the same source file.
 * Key: source URL, Value: decoded audio data
 */
const audioDecodeCache = new Map<string, DecodedAudio>();

/**
 * Clear the audio decode cache (call after export completes)
 */
export function clearAudioDecodeCache(): void {
  audioDecodeCache.clear();
  log.debug('Audio decode cache cleared');
}

/**
 * Audio segment representing a timeline item's audio
 */
interface AudioSegment {
  itemId: string;
  trackId: string;
  src: string;
  startFrame: number;        // Timeline position
  durationFrames: number;
  sourceStartFrame: number;  // In source media (for trim) â€” in source-native FPS frames
  sourceFps: number;         // Source media FPS (sourceStartFrame is in these frames)
  volume: number;            // -60 to +12 dB
  fadeInFrames: number;
  fadeOutFrames: number;
  fadeInCurve: number;
  fadeOutCurve: number;
  fadeInCurveX: number;
  fadeOutCurveX: number;
  contentStartOffsetFrames?: number;
  contentEndOffsetFrames?: number;
  fadeInDelayFrames?: number;
  fadeOutLeadFrames?: number;
  clipFadeSpans?: AudioClipFadeSpan[];
  crossfadeFadeInFrames?: number;
  crossfadeFadeOutFrames?: number;
  speed: number;             // Playback rate
  muted: boolean;
  type: 'video' | 'audio';
  audioCodec?: string;                  // Audio codec for lazy AC-3 decoder registration
  volumeKeyframes?: VolumeKeyframe[];  // Animated volume keyframes
  itemFrom: number;                     // Item's timeline start frame (for keyframe offset)
}

type TransitionAudioItem = VideoItem | AudioItem;

interface TransitionAudioEntry<TItem extends TransitionAudioItem> {
  item: TItem;
  trackId: string;
  muted: boolean;
  trackVolume: number;
  type: 'video' | 'audio';
  audioCodec?: string;
  volumeKeyframes?: VolumeKeyframe[];
  itemFrom: number;
}

function isMediaPair(left: TimelineItem, right: TimelineItem): boolean {
  return (left.type === 'video' && right.type === 'audio')
    || (left.type === 'audio' && right.type === 'video');
}

function getHeuristicTrimStart(item: TimelineItem): number | null {
  const timelineItem = item as TimelineItem & { offset?: number };
  return timelineItem.sourceStart ?? timelineItem.trimStart ?? timelineItem.offset ?? null;
}

function isImportedLegacyLinkedPair(anchor: TimelineItem, candidate: TimelineItem): boolean {
  if (!isMediaPair(anchor, candidate)) return false;
  if (anchor.linkedGroupId || candidate.linkedGroupId) return false;
  if (anchor.originId || candidate.originId) return false;
  if (!anchor.mediaId || anchor.mediaId !== candidate.mediaId) return false;
  if (anchor.from !== candidate.from) return false;
  if (anchor.durationInFrames !== candidate.durationInFrames) return false;
  if (getHeuristicTrimStart(anchor) !== getHeuristicTrimStart(candidate)) return false;
  if ((anchor.sourceEnd ?? null) !== (candidate.sourceEnd ?? null)) return false;
  return (anchor.speed ?? 1) === (candidate.speed ?? 1);
}

function getLinkedAudioCompanionForExport(items: TimelineItem[], anchor: TimelineItem): AudioItem | null {
  const linked = getLinkedAudioCompanion(items, anchor);
  if (linked) return linked;
  if (anchor.type !== 'video') return null;
  return (items.find((candidate) => (
    candidate.type === 'audio'
    && isImportedLegacyLinkedPair(anchor, candidate)
  )) as AudioItem | undefined) ?? null;
}

function getLinkedVideoIdsWithAudioForExport(items: TimelineItem[]): Set<string> {
  const linkedVideoIds = new Set<string>();

  for (const item of items) {
    if (item.type !== 'video') continue;
    if (getLinkedAudioCompanionForExport(items, item)) {
      linkedVideoIds.add(item.id);
    }
  }

  return linkedVideoIds;
}

function getManagedLinkedAudioTransitionsForExport(
  items: TimelineItem[],
  transitions: Transition[],
): Array<{ transition: Transition; leftAudio: AudioItem; rightAudio: AudioItem }> {
  const itemById = new Map(items.map((item) => [item.id, item]));
  const managed: Array<{ transition: Transition; leftAudio: AudioItem; rightAudio: AudioItem }> = [];

  for (const transition of transitions) {
    const leftClip = itemById.get(transition.leftClipId);
    const rightClip = itemById.get(transition.rightClipId);
    if (leftClip?.type !== 'video' || rightClip?.type !== 'video') continue;

    const leftAudio = getLinkedAudioCompanionForExport(items, leftClip);
    const rightAudio = getLinkedAudioCompanionForExport(items, rightClip);
    if (!leftAudio || !rightAudio) continue;
    if (leftAudio.trackId !== rightAudio.trackId) continue;
    if (leftAudio.from !== leftClip.from || rightAudio.from !== rightClip.from) continue;
    if (leftAudio.durationInFrames !== leftClip.durationInFrames || rightAudio.durationInFrames !== rightClip.durationInFrames) continue;

    managed.push({ transition, leftAudio, rightAudio });
  }

  return managed;
}

function buildClipFadeSpan(params: {
  startFrame: number;
  durationInFrames: number;
  fadeInFrames?: number;
  fadeOutFrames?: number;
  fadeInCurve?: number;
  fadeOutCurve?: number;
  fadeInCurveX?: number;
  fadeOutCurveX?: number;
}): AudioClipFadeSpan {
  return {
    startFrame: params.startFrame,
    durationInFrames: params.durationInFrames,
    fadeInFrames: params.fadeInFrames ?? 0,
    fadeOutFrames: params.fadeOutFrames ?? 0,
    fadeInCurve: params.fadeInCurve ?? 0,
    fadeOutCurve: params.fadeOutCurve ?? 0,
    fadeInCurveX: params.fadeInCurveX ?? 0.52,
    fadeOutCurveX: params.fadeOutCurveX ?? 0.52,
  };
}

function getTransitionAudioTrimBefore(item: TransitionAudioItem): number {
  return item.sourceStart ?? item.trimStart ?? item.offset ?? 0;
}

function hasExplicitTransitionAudioTrimStart(item: TransitionAudioItem): boolean {
  return item.sourceStart !== undefined || item.trimStart !== undefined || item.offset !== undefined;
}

function isContinuousAudioTransition(
  left: TransitionAudioItem,
  right: TransitionAudioItem,
  fps: number,
): boolean {
  const leftSpeed = left.speed ?? 1;
  const rightSpeed = right.speed ?? 1;
  const leftSourceFps = left.sourceFps ?? fps;
  if (Math.abs(leftSpeed - rightSpeed) > 0.0001) return false;

  const sameMedia = (left.mediaId && right.mediaId && left.mediaId === right.mediaId)
    || (!!left.src && !!right.src && left.src === right.src);
  if (!sameMedia) return false;

  if (left.originId && right.originId && left.originId !== right.originId) return false;

  const expectedRightFrom = left.from + left.durationInFrames;
  if (Math.abs(right.from - expectedRightFrom) > 2) return false;

  const leftTrim = getTransitionAudioTrimBefore(left);
  const rightTrim = getTransitionAudioTrimBefore(right);
  const computedLeftSourceEnd = leftTrim + timelineToSourceFrames(
    left.durationInFrames,
    leftSpeed,
    fps,
    leftSourceFps,
  );
  const storedLeftSourceEnd = left.sourceEnd;
  const computedContinuous = Math.abs(rightTrim - computedLeftSourceEnd) <= 2;
  const storedContinuous = storedLeftSourceEnd !== undefined
    ? Math.abs(rightTrim - storedLeftSourceEnd) <= 2
    : false;

  if (computedContinuous || storedContinuous) return true;

  return !hasExplicitTransitionAudioTrimStart(right);
}

function buildManagedTransitionAudioSegments<TItem extends TransitionAudioItem>(
  entriesById: Map<string, TransitionAudioEntry<TItem>>,
  transitions: Transition[],
  fps: number,
): AudioSegment[] {
  if (entriesById.size === 0 || transitions.length === 0) return [];

  const extensionByClipId = new Map<string, { before: number; after: number; overlapFadeOut: number; overlapFadeIn: number; fadeInDelay: number; fadeOutLead: number }>();
  const ensureExtension = (clipId: string): { before: number; after: number; overlapFadeOut: number; overlapFadeIn: number; fadeInDelay: number; fadeOutLead: number } => {
    const existing = extensionByClipId.get(clipId);
    if (existing) return existing;
    const created = { before: 0, after: 0, overlapFadeOut: 0, overlapFadeIn: 0, fadeInDelay: 0, fadeOutLead: 0 };
    extensionByClipId.set(clipId, created);
    return created;
  };

  const clipsById = new Map<string, TItem>();
  for (const [id, entry] of entriesById) {
    clipsById.set(id, entry.item);
  }

  const resolvedWindows = resolveTransitionWindows(transitions, clipsById);
  for (const window of resolvedWindows) {
    const leftEntry = entriesById.get(window.transition.leftClipId);
    const rightEntry = entriesById.get(window.transition.rightClipId);
    if (!leftEntry || !rightEntry) continue;

    const left = leftEntry.item;
    const right = rightEntry.item;
    if (isContinuousAudioTransition(left, right, fps)) continue;

    const rightPreRoll = Math.max(0, right.from - window.startFrame);
    const leftPostRoll = Math.max(0, window.endFrame - (left.from + left.durationInFrames));

    if (rightPreRoll > 0) {
      const rightExt = ensureExtension(right.id);
      rightExt.before = Math.max(rightExt.before, rightPreRoll);
    }

    if (leftPostRoll > 0) {
      const leftExt = ensureExtension(left.id);
      leftExt.after = Math.max(leftExt.after, leftPostRoll);
    }

    if (window.durationInFrames > 0) {
      const leftExt = ensureExtension(left.id);
      leftExt.overlapFadeOut = Math.max(leftExt.overlapFadeOut, window.durationInFrames);
      leftExt.fadeOutLead = Math.max(leftExt.fadeOutLead, window.leftPortion);
      const rightExt = ensureExtension(right.id);
      rightExt.overlapFadeIn = Math.max(rightExt.overlapFadeIn, window.durationInFrames);
      rightExt.fadeInDelay = Math.max(rightExt.fadeInDelay, window.rightPortion);
    }
  }

  const resolvedTrimBeforeById = new Map<string, number>();
  const sortedByTrackAndTime = Array.from(entriesById.entries()).map(([id, entry]) => ({
    id,
    trackId: entry.trackId,
    item: entry.item,
  })).toSorted((a, b) => {
    if (a.trackId !== b.trackId) return a.trackId.localeCompare(b.trackId);
    if (a.item.from !== b.item.from) return a.item.from - b.item.from;
    return a.id.localeCompare(b.id);
  });

  const previousByTrack = new Map<string, TItem>();
  for (const entry of sortedByTrackAndTime) {
    const clip = entry.item;
    const explicitTrimBefore = getTransitionAudioTrimBefore(clip);
    let resolvedTrimBefore = explicitTrimBefore;

    if (!hasExplicitTransitionAudioTrimStart(clip)) {
      const previous = previousByTrack.get(entry.trackId);
      if (previous && isContinuousAudioTransition(previous, clip, fps)) {
        const previousTrimBefore = resolvedTrimBeforeById.get(previous.id) ?? getTransitionAudioTrimBefore(previous);
        resolvedTrimBefore = previousTrimBefore + timelineToSourceFrames(
          previous.durationInFrames,
          previous.speed ?? 1,
          fps,
          previous.sourceFps ?? fps,
        );
      }
    }

    resolvedTrimBeforeById.set(clip.id, resolvedTrimBefore);
    previousByTrack.set(entry.trackId, clip);
  }

  type ExpandedTransitionAudioSegment = AudioSegment & {
    clip: TransitionAudioItem;
    beforeFrames: number;
    afterFrames: number;
  };

  const expandedSegments: ExpandedTransitionAudioSegment[] = [];
  for (const [, entry] of entriesById) {
    const item = entry.item;
    const speed = item.speed ?? 1;
    const sourceFps = item.sourceFps ?? fps;
    const baseTrimBefore = resolvedTrimBeforeById.get(item.id) ?? getTransitionAudioTrimBefore(item);
    const extension = extensionByClipId.get(item.id) ?? { before: 0, after: 0, overlapFadeOut: 0, overlapFadeIn: 0, fadeInDelay: 0, fadeOutLead: 0 };
    const maxBeforeBySource = speed > 0
      ? sourceToTimelineFrames(baseTrimBefore, speed, sourceFps, fps)
      : 0;
    const before = Math.max(0, Math.min(extension.before, maxBeforeBySource));
    const after = Math.max(0, extension.after);
    const crossfadeFadeInFrames = extension.overlapFadeIn > 0
      ? extension.overlapFadeIn
      : (before > 0 ? before : undefined);
    const crossfadeFadeOutFrames = extension.overlapFadeOut > 0
      ? extension.overlapFadeOut
      : (after > 0 ? after : undefined);

    expandedSegments.push({
      itemId: item.id,
      trackId: entry.trackId,
      clip: item,
      src: item.src,
      startFrame: item.from - before,
      durationFrames: item.durationInFrames + before + after,
      sourceStartFrame: baseTrimBefore - timelineToSourceFrames(before, speed, fps, sourceFps),
      sourceFps,
      volume: (item.volume ?? 0) + entry.trackVolume,
      fadeInFrames: (item.audioFadeIn ?? 0) * fps,
      fadeOutFrames: (item.audioFadeOut ?? 0) * fps,
      fadeInCurve: item.audioFadeInCurve ?? 0,
      fadeOutCurve: item.audioFadeOutCurve ?? 0,
      fadeInCurveX: item.audioFadeInCurveX ?? 0.52,
      fadeOutCurveX: item.audioFadeOutCurveX ?? 0.52,
      contentStartOffsetFrames: before,
      contentEndOffsetFrames: after,
      fadeInDelayFrames: extension.fadeInDelay,
      fadeOutLeadFrames: extension.fadeOutLead,
      clipFadeSpans: [buildClipFadeSpan({
        startFrame: before,
        durationInFrames: item.durationInFrames,
        fadeInFrames: (item.audioFadeIn ?? 0) * fps,
        fadeOutFrames: (item.audioFadeOut ?? 0) * fps,
        fadeInCurve: item.audioFadeInCurve,
        fadeOutCurve: item.audioFadeOutCurve,
        fadeInCurveX: item.audioFadeInCurveX,
        fadeOutCurveX: item.audioFadeOutCurveX,
      })],
      crossfadeFadeInFrames,
      crossfadeFadeOutFrames,
      speed,
      muted: entry.muted,
      type: entry.type,
      audioCodec: entry.audioCodec,
      beforeFrames: before,
      afterFrames: after,
      volumeKeyframes: entry.volumeKeyframes,
      itemFrom: entry.itemFrom,
    });
  }

  const sortedSegments = expandedSegments.toSorted((a, b) => {
    if (a.startFrame !== b.startFrame) return a.startFrame - b.startFrame;
    return a.itemId.localeCompare(b.itemId);
  });

  const mergedSegments: AudioSegment[] = [];
  let active: ExpandedTransitionAudioSegment | null = null;

  const canMergeContinuousBoundary = (
    left: ExpandedTransitionAudioSegment,
    right: ExpandedTransitionAudioSegment,
  ): boolean => {
    if (!isContinuousAudioTransition(left.clip, right.clip, fps)) return false;
    if (left.src !== right.src) return false;
    if (Math.abs(left.speed - right.speed) > 0.0001) return false;
    if (Math.abs(left.volume - right.volume) > 0.0001) return false;
    if (left.muted !== right.muted) return false;
    if (left.afterFrames !== 0 || right.beforeFrames !== 0) return false;
    if (left.volumeKeyframes || right.volumeKeyframes) return false;
    return true;
  };

  const toAudioSegment = (segment: ExpandedTransitionAudioSegment): AudioSegment => ({
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
    contentStartOffsetFrames: segment.contentStartOffsetFrames,
    contentEndOffsetFrames: segment.contentEndOffsetFrames,
    fadeInDelayFrames: segment.fadeInDelayFrames,
    fadeOutLeadFrames: segment.fadeOutLeadFrames,
    clipFadeSpans: segment.clipFadeSpans,
    crossfadeFadeInFrames: segment.crossfadeFadeInFrames,
    crossfadeFadeOutFrames: segment.crossfadeFadeOutFrames,
    speed: segment.speed,
    muted: segment.muted,
    type: segment.type,
    audioCodec: segment.audioCodec,
    volumeKeyframes: segment.volumeKeyframes,
    itemFrom: segment.itemFrom,
  });

  for (const segment of sortedSegments) {
    if (!active) {
      active = { ...segment };
      continue;
    }

    if (canMergeContinuousBoundary(active, segment)) {
      const activeStartFrame = active.startFrame;
      const mergedEnd = segment.startFrame + segment.durationFrames;
      active.durationFrames = mergedEnd - active.startFrame;
      active.fadeOutFrames = segment.fadeOutFrames;
      active.fadeOutCurve = segment.fadeOutCurve;
      active.fadeOutCurveX = segment.fadeOutCurveX;
      active.contentEndOffsetFrames = segment.contentEndOffsetFrames;
      active.fadeOutLeadFrames = segment.fadeOutLeadFrames;
      active.crossfadeFadeOutFrames = segment.crossfadeFadeOutFrames;
      active.clipFadeSpans = [...(active.clipFadeSpans ?? []), ...((segment.clipFadeSpans ?? []).map((span) => ({
        ...span,
        startFrame: span.startFrame + (segment.startFrame - activeStartFrame),
      })))];
      active.clip = segment.clip;
      active.afterFrames = segment.afterFrames;
      continue;
    }

    mergedSegments.push(toAudioSegment(active));
    active = { ...segment };
  }

  if (active) {
    mergedSegments.push(toAudioSegment(active));
  }

  return mergedSegments;
}

/**
 * Decoded audio data
 */
interface DecodedAudio {
  itemId: string;
  sampleRate: number;
  channels: number;
  samples: Float32Array[];   // Per-channel samples
  duration: number;          // Duration in seconds
}

/**
 * Audio processing configuration
 */
interface AudioProcessingConfig {
  sampleRate: number;
  channels: number;
  fps: number;
  totalFrames: number;
}

function appendCompositionAudioSegments(params: {
  segments: AudioSegment[];
  track: CompositionInputProps['tracks'][number];
  compositionItem: CompositionItem | (AudioItem & { compositionId: string });
  subComp: {
    items: TimelineItem[];
    tracks: TimelineTrack[];
    keyframes?: CompositionInputProps['keyframes'];
    durationInFrames: number;
  };
  fps: number;
  visited?: Set<string>;
}): void {
  const { segments, track, compositionItem, subComp, fps } = params;
  const visited = params.visited ?? new Set<string>();
  const linkedSubCompVideoIds = getLinkedVideoIdsWithAudio(subComp.items);
  const compFrom = compositionItem.from;
  const wrapperSpeed = compositionItem.speed ?? 1;
  const wrapperSourceFps = compositionItem.sourceFps ?? fps;
  const sourceOffset = compositionItem.sourceStart ?? compositionItem.trimStart ?? 0;
  const wrapperSourceEnd = compositionItem.sourceEnd
    ?? (sourceOffset + timelineToSourceFrames(compositionItem.durationInFrames, wrapperSpeed, fps, wrapperSourceFps));
  const trackMuted = track.muted ?? false;

  for (const subItem of subComp.items) {
    const subTrack = subComp.tracks.find((candidate) => candidate.id === subItem.trackId);
    const subTrackMuted = subTrack?.muted ?? false;
    const overlapStart = Math.max(subItem.from, sourceOffset);
    const overlapEnd = Math.min(subItem.from + subItem.durationInFrames, wrapperSourceEnd);
    if (overlapEnd <= overlapStart) continue;

    const effectiveStart = compFrom + sourceToTimelineFrames(overlapStart - sourceOffset, wrapperSpeed, wrapperSourceFps, fps);
    const effectiveEnd = compFrom + sourceToTimelineFrames(overlapEnd - sourceOffset, wrapperSpeed, wrapperSourceFps, fps);
    const effectiveDuration = Math.max(1, effectiveEnd - effectiveStart);
    if (effectiveDuration <= 0) continue;

    const subItemClipStart = overlapStart - subItem.from;
    const baseSourceStart = subItem.sourceStart ?? subItem.trimStart ?? 0;
    const speed = (subItem.speed ?? 1) * wrapperSpeed;
    const effectiveSourceStart = baseSourceStart + timelineToSourceFrames(
      subItemClipStart,
      subItem.speed ?? 1,
      wrapperSourceFps,
      subItem.sourceFps ?? wrapperSourceFps,
    );

    if (subItem.type === 'composition' || isCompositionAudioItem(subItem)) {
      if (subItem.type === 'composition' && getLinkedCompositionAudioCompanion(subComp.items, subItem)) continue;
      if (visited.has(subItem.compositionId)) continue;

      const nestedSubComp = useCompositionsStore.getState().getComposition(subItem.compositionId);
      if (!nestedSubComp) continue;

      const nestedWrapper = {
        ...subItem,
        from: effectiveStart,
        durationInFrames: effectiveDuration,
        speed: (subItem.speed ?? 1) * wrapperSpeed,
        sourceStart: effectiveSourceStart,
        sourceFps: subItem.sourceFps ?? wrapperSourceFps,
        ...(subItem.sourceEnd !== undefined && {
          sourceEnd: Math.max(
            effectiveSourceStart + 1,
            subItem.sourceEnd - timelineToSourceFrames(
              (subItem.from + subItem.durationInFrames) - overlapEnd,
              subItem.speed ?? 1,
              wrapperSourceFps,
              subItem.sourceFps ?? wrapperSourceFps,
            ),
          ),
        }),
      } as CompositionItem | (AudioItem & { compositionId: string });

      // Volumes are dB offsets — sum them so nested levels accumulate correctly.
      const nestedVisited = new Set(visited);
      nestedVisited.add(subItem.compositionId);
      appendCompositionAudioSegments({
        segments,
        track: {
          ...track,
          muted: trackMuted || subTrackMuted,
          volume: (track.volume ?? 0) + (subTrack?.volume ?? 0),
        },
        compositionItem: nestedWrapper,
        subComp: nestedSubComp,
        fps,
        visited: nestedVisited,
      });
      continue;
    }

    if (subItem.type !== 'video' && subItem.type !== 'audio') continue;
    if (subItem.type === 'video' && linkedSubCompVideoIds.has(subItem.id)) continue;
    const src = (subItem.mediaId ? blobUrlManager.get(subItem.mediaId) : null)
      ?? (subItem as VideoItem | AudioItem).src ?? '';
    if (!src) continue;

    const subItemKeyframes = subComp.keyframes?.find((keyframe) => keyframe.itemId === subItem.id);
    const subVolumeKfs = getPropertyKeyframes(subItemKeyframes, 'volume');

    const rawFadeInFrames = sourceToTimelineFrames((subItem.audioFadeIn ?? 0) * wrapperSourceFps, wrapperSpeed, wrapperSourceFps, fps);
    const rawFadeOutFrames = sourceToTimelineFrames((subItem.audioFadeOut ?? 0) * wrapperSourceFps, wrapperSpeed, wrapperSourceFps, fps);
    const clippedStartFrames = sourceToTimelineFrames(overlapStart - subItem.from, wrapperSpeed, wrapperSourceFps, fps);
    const clippedEndFrames = sourceToTimelineFrames((subItem.from + subItem.durationInFrames) - overlapEnd, wrapperSpeed, wrapperSourceFps, fps);
    const adjustedFadeInFrames = Math.max(0, rawFadeInFrames - clippedStartFrames);
    const adjustedFadeOutFrames = Math.max(0, rawFadeOutFrames - clippedEndFrames);

    segments.push({
      itemId: subItem.id,
      trackId: track.id,
      src,
      startFrame: effectiveStart,
      durationFrames: effectiveDuration,
      sourceStartFrame: effectiveSourceStart,
      sourceFps: subItem.sourceFps ?? fps,
      volume: (subItem.volume ?? 0) + (track.volume ?? 0) + (subTrack?.volume ?? 0),
      fadeInFrames: adjustedFadeInFrames,
      fadeOutFrames: adjustedFadeOutFrames,
      fadeInCurve: subItem.audioFadeInCurve ?? 0,
      fadeOutCurve: subItem.audioFadeOutCurve ?? 0,
      fadeInCurveX: subItem.audioFadeInCurveX ?? 0.52,
      fadeOutCurveX: subItem.audioFadeOutCurveX ?? 0.52,
      contentStartOffsetFrames: 0,
      contentEndOffsetFrames: 0,
      fadeInDelayFrames: 0,
      fadeOutLeadFrames: 0,
      clipFadeSpans: [buildClipFadeSpan({
        startFrame: 0,
        durationInFrames: effectiveDuration,
        fadeInFrames: adjustedFadeInFrames,
        fadeOutFrames: adjustedFadeOutFrames,
        fadeInCurve: subItem.audioFadeInCurve,
        fadeOutCurve: subItem.audioFadeOutCurve,
        fadeInCurveX: subItem.audioFadeInCurveX,
        fadeOutCurveX: subItem.audioFadeOutCurveX,
      })],
      speed,
      muted: trackMuted || subTrackMuted,
      type: subItem.type as 'video' | 'audio',
      audioCodec: getMediaAudioCodecById(subItem.mediaId),
      volumeKeyframes: subVolumeKfs.length > 0 ? subVolumeKfs : undefined,
      itemFrom: effectiveStart,
    });
  }
}

/**
 * Extract audio segments from composition.
 *
 * @param composition - The composition with tracks
 * @returns Array of audio segments to process
 */
export function extractAudioSegments(composition: CompositionInputProps, fps: number): AudioSegment[] {
  const { tracks = [], transitions = [] } = composition;
  const segments: AudioSegment[] = [];
  const audioOnlySegments: AudioSegment[] = [];
  const videoById = new Map<string, TransitionAudioEntry<VideoItem>>();
  const audioById = new Map<string, TransitionAudioEntry<AudioItem>>();
  const managedLinkedAudioById = new Map<string, TransitionAudioEntry<AudioItem>>();
  const timelineItems = tracks.flatMap((track) => track.items);
  const linkedRootVideoIds = getLinkedVideoIdsWithAudioForExport(timelineItems);
  const managedLinkedAudioTransitions = getManagedLinkedAudioTransitionsForExport(timelineItems, transitions);
  const managedLinkedAudioIds = new Set<string>();
  for (const managed of managedLinkedAudioTransitions) {
    managedLinkedAudioIds.add(managed.leftAudio.id);
    managedLinkedAudioIds.add(managed.rightAudio.id);
  }
  const managedLinkedAudioTransitionDefs: Transition[] = managedLinkedAudioTransitions.map(
    ({ transition, leftAudio, rightAudio }) => ({
      ...transition,
      leftClipId: leftAudio.id,
      rightClipId: rightAudio.id,
      trackId: leftAudio.trackId,
    }),
  );
  const audioTransitionItemIds = new Set<string>();
  const audioTransitionDefs: Transition[] = transitions.filter((transition) => {
    const leftItem = timelineItems.find((item) => item.id === transition.leftClipId);
    const rightItem = timelineItems.find((item) => item.id === transition.rightClipId);
    if (leftItem?.type !== 'audio' || rightItem?.type !== 'audio') {
      return false;
    }
    if (isCompositionAudioItem(leftItem) || isCompositionAudioItem(rightItem)) {
      return false;
    }
    audioTransitionItemIds.add(leftItem.id);
    audioTransitionItemIds.add(rightItem.id);
    return true;
  });

  for (const track of tracks) {
    if (track.visible === false) continue;

    for (const item of track.items) {
      if (item.type === 'video') {
        const videoItem = item as VideoItem;
        if (linkedRootVideoIds.has(videoItem.id)) continue;
        if (videoItem.embeddedAudioMuted) continue;
        if (!videoItem.src) continue;
        videoById.set(item.id, {
          item: videoItem,
          trackId: track.id,
          muted: track.muted ?? false,
          trackVolume: track.volume ?? 0,
          type: 'video',
          audioCodec: getMediaAudioCodecById(videoItem.mediaId),
          volumeKeyframes: (() => {
            const videoItemKeyframes = composition.keyframes?.find((k) => k.itemId === item.id);
            const videoVolumeKfs = getPropertyKeyframes(videoItemKeyframes, 'volume');
            return videoVolumeKfs.length > 0 ? videoVolumeKfs : undefined;
          })(),
          itemFrom: videoItem.from,
        });
      } else if (item.type === 'audio') {
        const audioItem = item as AudioItem;
        if (isCompositionAudioItem(audioItem)) {
          const subComp = useCompositionsStore.getState().getComposition(audioItem.compositionId);
          if (!subComp) continue;
          appendCompositionAudioSegments({
            segments: audioOnlySegments,
            track,
            compositionItem: audioItem,
            subComp,
            fps,
          });
          continue;
        }
        if (!audioItem.src) continue;

        // Use sourceStart as primary for consistency with video items
        // This ensures split audio clips and IO markers work correctly
        const audioItemKeyframes = composition.keyframes?.find((k) => k.itemId === item.id);
        const audioVolumeKfs = getPropertyKeyframes(audioItemKeyframes, 'volume');
        const audioEntry: TransitionAudioEntry<AudioItem> = {
          item: audioItem,
          trackId: track.id,
          muted: track.muted ?? false,
          trackVolume: track.volume ?? 0,
          type: 'audio',
          audioCodec: getMediaAudioCodecById(item.mediaId),
          volumeKeyframes: audioVolumeKfs.length > 0 ? audioVolumeKfs : undefined,
          itemFrom: item.from,
        };

        if (managedLinkedAudioIds.has(item.id)) {
          managedLinkedAudioById.set(item.id, audioEntry);
          continue;
        }

        if (audioTransitionItemIds.has(item.id)) {
          audioById.set(item.id, audioEntry);
          continue;
        }

        audioOnlySegments.push({
          itemId: item.id,
          trackId: track.id,
          src: audioItem.src,
          startFrame: item.from,
          durationFrames: item.durationInFrames,
          sourceStartFrame: audioItem.sourceStart ?? item.trimStart ?? 0,
          sourceFps: audioItem.sourceFps ?? fps,
          volume: (item.volume ?? 0) + (track.volume ?? 0),
          fadeInFrames: (item.audioFadeIn ?? 0) * fps,
          fadeOutFrames: (item.audioFadeOut ?? 0) * fps,
          fadeInCurve: item.audioFadeInCurve ?? 0,
          fadeOutCurve: item.audioFadeOutCurve ?? 0,
          fadeInCurveX: item.audioFadeInCurveX ?? 0.52,
          fadeOutCurveX: item.audioFadeOutCurveX ?? 0.52,
          contentStartOffsetFrames: 0,
          contentEndOffsetFrames: 0,
          fadeInDelayFrames: 0,
          fadeOutLeadFrames: 0,
          clipFadeSpans: [buildClipFadeSpan({
            startFrame: 0,
            durationInFrames: item.durationInFrames,
            fadeInFrames: (item.audioFadeIn ?? 0) * fps,
            fadeOutFrames: (item.audioFadeOut ?? 0) * fps,
            fadeInCurve: item.audioFadeInCurve,
            fadeOutCurve: item.audioFadeOutCurve,
            fadeInCurveX: item.audioFadeInCurveX,
            fadeOutCurveX: item.audioFadeOutCurveX,
          })],
          speed: audioItem.speed ?? 1,
          muted: track.muted ?? false,
          type: 'audio',
          audioCodec: audioEntry.audioCodec,
          volumeKeyframes: audioEntry.volumeKeyframes,
          itemFrom: item.from,
        });
      }
    }
  }

  const managedVideoSegments = buildManagedTransitionAudioSegments(videoById, transitions, fps);
  const managedAudioSegments = buildManagedTransitionAudioSegments(audioById, audioTransitionDefs, fps);
  const managedLinkedAudioSegments = buildManagedTransitionAudioSegments(
    managedLinkedAudioById,
    managedLinkedAudioTransitionDefs,
    fps,
  );

  segments.push(...managedVideoSegments, ...managedAudioSegments, ...managedLinkedAudioSegments, ...audioOnlySegments);

  // === Extract audio from sub-compositions (pre-comps) ===
  // Composition items reference sub-comps that may contain video/audio items with audio.
  // We offset each sub-comp audio segment by the composition item's timeline position.
  for (const track of tracks) {
    if (track.visible === false) continue;
    for (const item of track.items) {
      if (item.type !== 'composition') continue;
      const compItem = item as CompositionItem;
      if (getLinkedCompositionAudioCompanion(timelineItems, compItem)) continue;
      const subComp = useCompositionsStore.getState().getComposition(compItem.compositionId);
      if (!subComp) continue;
      appendCompositionAudioSegments({
        segments,
        track,
        compositionItem: compItem,
        subComp,
        fps,
      });
    }
  }

  log.info('Extracted audio segments', {
    count: segments.length,
    videoCount: segments.filter((s) => s.type === 'video').length,
    audioCount: segments.filter((s) => s.type === 'audio').length,
  });

  return segments;
}

/**
 * Decode audio from a media source using mediabunny for efficient range extraction.
 * Only decodes the portion of audio actually needed, not the entire file.
 *
 * @param src - Source URL (blob URL or regular URL)
 * @param itemId - Item ID for logging
 * @param startTime - Start time in seconds (optional, defaults to 0)
 * @param endTime - End time in seconds (optional, defaults to full duration)
 * @returns Decoded audio data for the specified range
 */
async function decodeAudioFromSource(
  src: string,
  itemId: string,
  startTime?: number,
  endTime?: number,
  audioCodec?: string,
  ac3RetryAttempted: boolean = false,
): Promise<DecodedAudio> {
  // Check cache first (only for full file decodes for backward compatibility)
  if (startTime === undefined && endTime === undefined) {
    const cached = audioDecodeCache.get(src);
    if (cached) {
      log.debug('Using cached decoded audio', { itemId, src: src.substring(0, 50) });
      return { ...cached, itemId };
    }
  }

  log.debug('Decoding audio with mediabunny', {
    itemId,
    src: src.substring(0, 50),
    startTime,
    endTime,
    audioCodec,
  });

  try {
    if (isAc3AudioCodec(audioCodec)) {
      await ensureAc3DecoderRegistered();
    }

    // Try mediabunny first for efficient range extraction
    const mb = await import('mediabunny');
    const input = new mb.Input({
      formats: mb.ALL_FORMATS,
      source: createMediabunnyInputSource(mb, src),
    });
    try {
      const audioTrack = await input.getPrimaryAudioTrack();
      if (!audioTrack) {
        throw new Error('No audio track found');
      }

      const duration = await input.computeDuration();
      const actualStartTime = startTime ?? 0;
      const actualEndTime = endTime ?? duration;

      log.debug('Extracting audio range', {
        itemId,
        startTime: actualStartTime,
        endTime: actualEndTime,
        totalDuration: duration,
      });

      // Create audio sample sink and extract only needed range
      const sink = new mb.AudioSampleSink(audioTrack);

      // Collect planar sample chunks per output channel.
      const channelChunks: Float32Array[][] = [];
      let totalFrames = 0;
      let sampleRate = 48000;
      let channels = 0;

      for await (const sample of sink.samples(actualStartTime, actualEndTime)) {
        try {
          const sampleData = sample as {
            numberOfFrames?: number;
            numberOfChannels?: number;
            sampleRate?: number;
            copyTo: (destination: Float32Array, options: { planeIndex: number; format: 'f32-planar' }) => void;
          };
          const frameCount = Math.max(0, sampleData.numberOfFrames ?? 0);
          const sampleChannels = Math.max(1, sampleData.numberOfChannels ?? 1);
          if (frameCount === 0) {
            continue;
          }

          if (channels === 0) {
            channels = sampleChannels;
            for (let c = 0; c < channels; c++) {
              channelChunks.push([]);
            }
          } else if (sampleChannels > channels) {
            // Rare container edge case: if channel count increases mid-stream,
            // backfill earlier timeline with silence for newly seen channels.
            for (let c = channels; c < sampleChannels; c++) {
              const chunks: Float32Array[] = [];
              if (totalFrames > 0) {
                chunks.push(new Float32Array(totalFrames));
              }
              channelChunks.push(chunks);
            }
            channels = sampleChannels;
          } else if (sampleChannels < channels) {
            log.warn('Inconsistent channel count during mediabunny audio decode', {
              itemId,
              expectedChannels: channels,
              actualChannels: sampleChannels,
            });
          }

          const outputChannels = channels || sampleChannels;
          for (let c = 0; c < outputChannels; c++) {
            const planeIndex = Math.min(c, sampleChannels - 1);
            const channelData = new Float32Array(frameCount);
            sampleData.copyTo(channelData, { planeIndex, format: 'f32-planar' });
            channelChunks[c]!.push(channelData);
          }

          totalFrames += frameCount;
          if (sampleData.sampleRate && sampleData.sampleRate > 0) {
            sampleRate = sampleData.sampleRate;
          }
        } finally {
          sample.close();
        }
      }

      if (channels === 0 || totalFrames === 0) {
        throw new Error('Audio decode produced no output');
      }

      // Combine chunks into contiguous per-channel arrays.
      const samples: Float32Array[] = [];
      for (let c = 0; c < channels; c++) {
        const merged = new Float32Array(totalFrames);
        let offset = 0;
        for (const chunk of channelChunks[c] ?? []) {
          merged.set(chunk, offset);
          offset += chunk.length;
        }
        samples.push(merged);
      }

      const result: DecodedAudio = {
        itemId,
        sampleRate,
        channels,
        samples,
        duration: actualEndTime - actualStartTime,
      };

      log.debug('Decoded audio with mediabunny', {
        itemId,
        sampleRate,
        channels,
        duration: result.duration,
        samples: samples[0]?.length,
      });

      // Cache if full file decode
      if (startTime === undefined && endTime === undefined) {
        audioDecodeCache.set(src, result);
      }

      return result;
    } finally {
      input.dispose();
    }
  } catch (error) {
    // Metadata can be missing/stale for some legacy items. If decode fails and
    // codec did not look like AC-3, retry once after registering the decoder.
    if (!ac3RetryAttempted && !isAc3AudioCodec(audioCodec)) {
      try {
        await ensureAc3DecoderRegistered();
        return await decodeAudioFromSource(src, itemId, startTime, endTime, audioCodec, true);
      } catch {
        // Ignore and continue to Web Audio fallback below.
      }
    }

    // Fall back to Web Audio API for full decode
    log.warn('Mediabunny audio decode failed, using fallback', { itemId, error });
    return decodeAudioFallback(src, itemId);
  }
}

/**
 * Fallback audio decoder using Web Audio API (decodes entire file)
 */
async function decodeAudioFallback(src: string, itemId: string): Promise<DecodedAudio> {
  // Check cache
  const cached = audioDecodeCache.get(src);
  if (cached) {
    log.debug('Using cached decoded audio (fallback)', { itemId });
    return { ...cached, itemId };
  }

  log.debug('Decoding audio with Web Audio API fallback', { itemId, src: src.substring(0, 50) });

  const response = await fetch(src);
  if (!response.ok) {
    throw new Error(`Failed to fetch audio: ${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();

  const offlineContext = new OfflineAudioContext(2, 1, 48000);
  const audioBuffer = await offlineContext.decodeAudioData(arrayBuffer);

  const samples: Float32Array[] = [];
  for (let i = 0; i < audioBuffer.numberOfChannels; i++) {
    samples.push(audioBuffer.getChannelData(i));
  }

  const result: DecodedAudio = {
    itemId,
    sampleRate: audioBuffer.sampleRate,
    channels: audioBuffer.numberOfChannels,
    samples,
    duration: audioBuffer.duration,
  };

  // Cache the result
  audioDecodeCache.set(src, result);

  log.debug('Decoded audio (fallback)', {
    itemId,
    sampleRate: audioBuffer.sampleRate,
    channels: audioBuffer.numberOfChannels,
    duration: audioBuffer.duration,
    samples: samples[0]?.length,
  });

  return result;
}

/**
 * Convert dB to linear gain.
 */
function dbToGain(db: number): number {
  return Math.pow(10, db / 20);
}

/**
 * Apply volume (in dB) to audio samples.
 */
function applyVolume(
  samples: Float32Array,
  volumeDb: number
): Float32Array {
  const gain = dbToGain(volumeDb);
  const output = new Float32Array(samples.length);

  for (let i = 0; i < samples.length; i++) {
    output[i] = samples[i]! * gain;
  }

  return output;
}

/**
 * Apply animated volume envelope from keyframes to audio samples.
 * Interpolates dB value per-frame and applies per-sample gain.
 *
 * @param samples - Audio samples for one channel
 * @param volumeKeyframes - Volume keyframes (frame-relative to item start)
 * @param staticVolumeDb - Static volume dB fallback
 * @param segmentStartFrame - Timeline frame where this segment starts
 * @param itemFrom - Timeline frame where the original item starts
 * @param fps - Frames per second
 * @param sampleRate - Audio sample rate
 */
function applyAnimatedVolume(
  samples: Float32Array,
  volumeKeyframes: VolumeKeyframe[],
  staticVolumeDb: number,
  segmentStartFrame: number,
  itemFrom: number,
  fps: number,
  sampleRate: number
): Float32Array {
  const output = new Float32Array(samples.length);

  for (let i = 0; i < samples.length; i++) {
    // Convert sample index to timeline frame
    const timelineFrame = segmentStartFrame + (i / sampleRate) * fps;
    // Convert to item-relative frame for keyframe interpolation
    const relativeFrame = timelineFrame - itemFrom;
    const db = interpolatePropertyValue(volumeKeyframes, relativeFrame, staticVolumeDb);
    const gain = dbToGain(db);
    output[i] = samples[i]! * gain;
  }

  return output;
}

/**
 * Apply fade in/out to audio samples.
 *
 * @param samples - Audio samples
 * @param fadeInSamples - Number of samples for fade in
 * @param fadeOutSamples - Number of samples for fade out
 * @param useEqualPower - Use equal-power (sin/cos) fades for smoother crossfades
 */
function applyFades(
  samples: Float32Array,
  fadeInSamples: number,
  fadeOutSamples: number,
  useEqualPower: boolean = false,
  fadeInCurve: number = 0,
  fadeOutCurve: number = 0,
  fadeInCurveX: number = 0.52,
  fadeOutCurveX: number = 0.52,
  contentStartOffsetSamples: number = 0,
  contentEndOffsetSamples: number = 0,
  fadeInDelaySamples: number = 0,
  fadeOutLeadSamples: number = 0,
): Float32Array {
  const output = new Float32Array(samples.length);
  output.set(samples);
  const contentStart = Math.max(0, Math.min(contentStartOffsetSamples + Math.max(0, fadeInDelaySamples), output.length));
  const contentEnd = Math.max(contentStart, output.length - Math.max(0, contentEndOffsetSamples + Math.max(0, fadeOutLeadSamples)));
  const contentLength = Math.max(0, contentEnd - contentStart);

  // Apply fade in
  if (fadeInSamples > 0) {
    for (let i = 0; i < contentStart && i < output.length; i++) {
      output[i] = 0;
    }
    for (let i = 0; i < fadeInSamples && i < contentLength; i++) {
      const sampleIndex = contentStart + i;
      const progress = i / fadeInSamples;
      const gain = useEqualPower
        ? Math.sin(progress * Math.PI / 2)
        : evaluateAudioFadeInCurve(progress, fadeInCurve, fadeInCurveX);
      output[sampleIndex] = output[sampleIndex]! * gain;
    }
  }

  // Apply fade out
  if (fadeOutSamples > 0) {
    const fadeOutStart = Math.max(contentStart, contentEnd - fadeOutSamples);
    for (let i = 0; i < fadeOutSamples; i++) {
      const sampleIndex = fadeOutStart + i;
      if (sampleIndex < contentStart || sampleIndex >= contentEnd) continue;

      const progress = i / fadeOutSamples;
      const gain = useEqualPower
        ? Math.cos(progress * Math.PI / 2)
        : evaluateAudioFadeOutCurve(progress, fadeOutCurve, fadeOutCurveX);
      output[sampleIndex] = output[sampleIndex]! * gain;
    }
    for (let i = contentEnd; i < output.length; i++) {
      output[i] = 0;
    }
  }

  return output;
}

function applyClipFadeSpans(
  samples: Float32Array,
  fadeSpans: AudioClipFadeSpan[] | undefined,
  sampleRate: number,
  fps: number,
): Float32Array {
  if (!fadeSpans || fadeSpans.length === 0) return samples;

  const output = new Float32Array(samples.length);
  output.set(samples);

  for (const span of fadeSpans) {
    const spanStart = Math.max(0, Math.floor((span.startFrame / fps) * sampleRate));
    const spanEnd = Math.min(output.length, Math.floor(((span.startFrame + span.durationInFrames) / fps) * sampleRate));
    const spanLength = Math.max(0, spanEnd - spanStart);
    if (spanLength === 0) continue;

    const fadeInSamples = Math.max(0, Math.min(spanLength, Math.floor(((span.fadeInFrames ?? 0) / fps) * sampleRate)));
    const fadeOutSamples = Math.max(0, Math.min(spanLength, Math.floor(((span.fadeOutFrames ?? 0) / fps) * sampleRate)));

    for (let i = 0; i < fadeInSamples; i++) {
      const progress = i / Math.max(1, fadeInSamples);
      const gain = evaluateAudioFadeInCurve(progress, span.fadeInCurve, span.fadeInCurveX);
      output[spanStart + i] = output[spanStart + i]! * gain;
    }

    const fadeOutStart = spanEnd - fadeOutSamples;
    for (let i = 0; i < fadeOutSamples; i++) {
      const sampleIndex = fadeOutStart + i;
      if (sampleIndex < spanStart || sampleIndex >= spanEnd) continue;
      const progress = i / Math.max(1, fadeOutSamples);
      const gain = evaluateAudioFadeOutCurve(progress, span.fadeOutCurve, span.fadeOutCurveX);
      output[sampleIndex] = output[sampleIndex]! * gain;
    }
  }

  return output;
}

/**
 * Apply speed change to audio with pitch preservation using SoundTouch algorithm.
 * Processes all channels together through a single SoundTouch instance so that
 * WSOLA overlap windows are consistent across channels (prevents phase drift
 * between L/R that causes a hollow sound).
 *
 * @param channels - Input audio channels (mono or stereo)
 * @param speed - Playback rate (1.0 = normal, 2.0 = double speed, 0.5 = half speed)
 * @param sampleRate - Sample rate for the audio
 * @returns Processed channels with the same channel count
 */
async function applySpeed(
  channels: Float32Array[],
  speed: number,
  sampleRate: number
): Promise<Float32Array[]> {
  if (speed === 1.0) return channels;
  if (channels.length === 0 || channels[0]!.length === 0) return channels;

  const numChannels = channels.length;
  const samplesPerChannel = channels[0]!.length;

  log.debug('Applying pitch-preserved speed change (SoundTouch)', { speed, sampleRate, numChannels });

  try {
    const soundtouch = await import('soundtouchjs');
    const st = new soundtouch.SoundTouch();

    st.tempo = speed;
    st.pitch = 1.0;
    st.rate = 1.0;

    // SoundTouch processes interleaved stereo. Interleave all channels
    // (for mono, duplicate to stereo so SoundTouch gets valid input).
    const stereoInput = new Float32Array(samplesPerChannel * 2);
    const left = channels[0]!;
    const right = numChannels >= 2 ? channels[1]! : left;
    for (let i = 0; i < samplesPerChannel; i++) {
      stereoInput[i * 2] = left[i]!;
      stereoInput[i * 2 + 1] = right[i]!;
    }

    let inputOffset = 0;
    const source = {
      extract: (target: Float32Array, numFrames: number): number => {
        const samplesToRead = Math.min(numFrames * 2, stereoInput.length - inputOffset);
        if (samplesToRead <= 0) return 0;

        for (let i = 0; i < samplesToRead; i++) {
          target[i] = stereoInput[inputOffset + i]!;
        }
        inputOffset += samplesToRead;
        return samplesToRead / 2;
      }
    };

    const filter = new soundtouch.SimpleFilter(source, st);

    const expectedOutputLength = Math.floor(samplesPerChannel / speed);
    const stereoOutput = new Float32Array(expectedOutputLength * 2);

    let outputOffset = 0;
    const chunkSize = 4096;
    const chunk = new Float32Array(chunkSize * 2);

    while (outputOffset < stereoOutput.length) {
      const framesExtracted = filter.extract(chunk, chunkSize);
      if (framesExtracted === 0) break;

      const samplesToWrite = Math.min(framesExtracted * 2, stereoOutput.length - outputOffset);
      for (let i = 0; i < samplesToWrite; i++) {
        stereoOutput[outputOffset + i] = chunk[i]!;
      }
      outputOffset += framesExtracted * 2;
    }

    // De-interleave back to separate channels
    const actualOutputLength = Math.floor(outputOffset / 2);
    const outputChannels: Float32Array[] = [];

    // Always extract both L and R from the interleaved output
    const outLeft = new Float32Array(actualOutputLength);
    const outRight = new Float32Array(actualOutputLength);
    for (let i = 0; i < actualOutputLength; i++) {
      outLeft[i] = stereoOutput[i * 2]!;
      outRight[i] = stereoOutput[i * 2 + 1]!;
    }

    if (numChannels >= 2) {
      outputChannels.push(outLeft, outRight);
      // Pass through any additional channels beyond stereo (rare)
      for (let c = 2; c < numChannels; c++) {
        outputChannels.push(outLeft); // duplicate left for extra channels
      }
    } else {
      // Mono source: return left channel only
      outputChannels.push(outLeft);
    }

    log.debug('SoundTouch time stretch complete', {
      inputLength: samplesPerChannel,
      outputLength: actualOutputLength,
      expectedLength: expectedOutputLength,
      speed,
      numChannels,
    });

    return outputChannels;
  } catch (error) {
    log.warn('SoundTouch failed, falling back to simple resampling', { error });

    // Fallback: simple resampling per-channel (will change pitch)
    const outputLength = Math.floor(samplesPerChannel / speed);
    return channels.map((samples) => {
      const output = new Float32Array(outputLength);
      for (let i = 0; i < outputLength; i++) {
        const sourceIndex = i * speed;
        const index0 = Math.floor(sourceIndex);
        const index1 = Math.min(index0 + 1, samples.length - 1);
        const fraction = sourceIndex - index0;
        output[i] = samples[index0]! * (1 - fraction) + samples[index1]! * fraction;
      }
      return output;
    });
  }
}

/**
 * Resample audio to target sample rate using OfflineAudioContext for high-quality
 * sinc interpolation (matches browser-native resampling quality).
 */
async function resample(
  samples: Float32Array,
  sourceSampleRate: number,
  targetSampleRate: number
): Promise<Float32Array> {
  if (sourceSampleRate === targetSampleRate) return samples;

  const duration = samples.length / sourceSampleRate;
  const offlineCtx = new OfflineAudioContext(
    1,
    Math.ceil(duration * targetSampleRate),
    targetSampleRate
  );

  const buffer = offlineCtx.createBuffer(1, samples.length, sourceSampleRate);
  buffer.getChannelData(0).set(samples);

  const source = offlineCtx.createBufferSource();
  source.buffer = buffer;
  source.connect(offlineCtx.destination);
  source.start(0);

  const rendered = await offlineCtx.startRendering();
  return rendered.getChannelData(0);
}

/**
 * Mix multiple audio tracks together.
 *
 * @param segments - Processed audio segments with timing
 * @param config - Audio processing configuration
 * @returns Mixed stereo audio samples
 */
function mixAudioTracks(
  segments: Array<{
    samples: Float32Array[];
    startSample: number;
    muted: boolean;
  }>,
  config: AudioProcessingConfig
): Float32Array[] {
  const { sampleRate, channels, fps, totalFrames } = config;
  const totalSamples = Math.ceil((totalFrames / fps) * sampleRate);

  // Create output buffers (stereo)
  const output: Float32Array[] = [];
  for (let c = 0; c < channels; c++) {
    output.push(new Float32Array(totalSamples));
  }

  // Mix each segment
  for (const segment of segments) {
    if (segment.muted) continue;

    for (let c = 0; c < channels; c++) {
      const channelSamples = segment.samples[c % segment.samples.length];
      if (!channelSamples) continue;

      const outputChannel = output[c]!;

      for (let i = 0; i < channelSamples.length; i++) {
        const outputIndex = segment.startSample + i;
        if (outputIndex < 0 || outputIndex >= totalSamples) continue;

        // Simple additive mixing
        const sample = channelSamples[i];
        const currentValue = outputChannel[outputIndex];
        if (sample !== undefined && currentValue !== undefined) {
          outputChannel[outputIndex] = currentValue + sample;
        }
      }
    }
  }

  // Soft-clip to prevent harsh digital clipping while preserving overall loudness.
  // This matches browser preview behavior where audio peaks are naturally saturated
  // rather than the entire mix being reduced in volume.
  let clippedSamples = 0;
  for (const channel of output) {
    for (let i = 0; i < channel.length; i++) {
      const sample = channel[i];
      if (sample !== undefined && Math.abs(sample) > 1.0) {
        // tanh soft limiter: smoothly compresses peaks above 1.0
        channel[i] = Math.tanh(sample);
        clippedSamples++;
      }
    }
  }
  if (clippedSamples > 0) {
    log.debug('Soft-clipped audio peaks', { clippedSamples });
  }

  return output;
}

/**
 * Pre-resolve sub-composition media URLs so extractAudioSegments can access them.
 * blobUrlManager.get() is synchronous but may not have URLs for sub-comp items
 * until they're acquired via resolveMediaUrl (async OPFS read).
 */
async function resolveSubCompMediaUrls(composition: CompositionInputProps): Promise<void> {
  const tracks = composition.tracks ?? [];
  const urlResolutions: Promise<void>[] = [];
  const compositionById = useCompositionsStore.getState().compositionById;
  const reachableCompositionIds = collectReachableCompositionIdsFromTracks(tracks, compositionById);
  for (const compositionId of reachableCompositionIds) {
    const subComp = compositionById[compositionId];
    if (!subComp) continue;
    for (const subItem of subComp.items) {
      if (subItem.type !== 'video' && subItem.type !== 'audio') continue;
      if (subItem.mediaId && !blobUrlManager.get(subItem.mediaId)) {
        urlResolutions.push(resolveMediaUrl(subItem.mediaId).then(() => {}));
      }
    }
  }
  if (urlResolutions.length > 0) {
    log.debug('Pre-resolving sub-comp audio URLs', { count: urlResolutions.length });
    await Promise.all(urlResolutions);
  }
}

/**
 * Process all audio for the composition.
 *
 * @param composition - The composition with tracks
 * @param signal - Optional abort signal
 * @returns Processed audio ready for encoding
 */
export async function processAudio(
  composition: CompositionInputProps,
  signal?: AbortSignal
): Promise<{
  samples: Float32Array[];
  sampleRate: number;
  channels: number;
} | null> {
  const { fps, durationInFrames = 0 } = composition;

  await resolveSubCompMediaUrls(composition);

  // Extract audio segments
  const segments = extractAudioSegments(composition, fps);

  // Filter out muted segments early
  const activeSegments = segments.filter((s) => !s.muted);

  if (activeSegments.length === 0) {
    log.info('No audio segments to process');
    return null;
  }

  const requiresAc3Decoder = activeSegments.some((segment) => isAc3AudioCodec(segment.audioCodec));
  if (requiresAc3Decoder) {
    await ensureAc3DecoderRegistered();
    log.debug('AC-3 decoder pre-registered for export audio decode');
  }

  // Configuration
  const config: AudioProcessingConfig = {
    sampleRate: 48000, // Standard export sample rate
    channels: 2, // Stereo
    fps,
    totalFrames: durationInFrames,
  };

  log.info('Processing audio', {
    segmentCount: activeSegments.length,
    sampleRate: config.sampleRate,
    channels: config.channels,
    durationSeconds: durationInFrames / fps,
  });

  // Decode and process each segment
  const processedSegments: Array<{
    samples: Float32Array[];
    startSample: number;
    muted: boolean;
  }> = [];

  for (const segment of activeSegments) {
    if (signal?.aborted) {
      throw new DOMException('Audio processing cancelled', 'AbortError');
    }

    try {
      // Calculate the time range we actually need from the source
      // sourceStartFrame is in source-native FPS frames, so divide by sourceFps (not project fps)
      const sourceStartTime = segment.sourceStartFrame / segment.sourceFps;
      // Account for speed: at 2x speed, we need twice as much source audio
      const sourceDurationNeeded = (segment.durationFrames / fps) * segment.speed;
      const sourceEndTime = sourceStartTime + sourceDurationNeeded;

      // Decode ONLY the needed range using mediabunny (huge performance improvement!)
      const decoded = await decodeAudioFromSource(
        segment.src,
        segment.itemId,
        sourceStartTime,
        sourceEndTime,
        segment.audioCodec,
      );

      // Process audio channels.
      // Note: decoded audio is already trimmed to the range we requested.

      // Apply speed across ALL channels at once to maintain phase coherence
      // between L/R (SoundTouch WSOLA finds shared overlap windows).
      let processedChannels = decoded.samples;
      if (segment.speed !== 1.0) {
        processedChannels = await applySpeed(processedChannels, segment.speed, decoded.sampleRate);
      }

      // Apply per-channel volume, fades, and resampling
      const fadeInSamples = Math.floor(
        (segment.fadeInFrames / fps) * decoded.sampleRate
      );
      const fadeOutSamples = Math.floor(
        (segment.fadeOutFrames / fps) * decoded.sampleRate
      );
      const crossfadeFadeInSamples = Math.floor(
        ((segment.crossfadeFadeInFrames ?? 0) / fps) * decoded.sampleRate
      );
      const crossfadeFadeOutSamples = Math.floor(
        ((segment.crossfadeFadeOutFrames ?? 0) / fps) * decoded.sampleRate
      );
      const contentStartOffsetSamples = Math.floor(
        ((segment.contentStartOffsetFrames ?? 0) / fps) * decoded.sampleRate
      );
      const contentEndOffsetSamples = Math.floor(
        ((segment.contentEndOffsetFrames ?? 0) / fps) * decoded.sampleRate
      );
      const fadeInDelaySamples = Math.floor(
        ((segment.fadeInDelayFrames ?? 0) / fps) * decoded.sampleRate
      );
      const fadeOutLeadSamples = Math.floor(
        ((segment.fadeOutLeadFrames ?? 0) / fps) * decoded.sampleRate
      );

      for (let c = 0; c < processedChannels.length; c++) {
        let channelSamples = processedChannels[c]!;

        // Apply volume (animated if keyframes exist, static otherwise)
        if (segment.volumeKeyframes && segment.volumeKeyframes.length > 0) {
          channelSamples = applyAnimatedVolume(
            channelSamples,
            segment.volumeKeyframes,
            segment.volume,
            segment.startFrame,
            segment.itemFrom,
            fps,
            decoded.sampleRate
          );
        } else if (segment.volume !== 0) {
          channelSamples = applyVolume(channelSamples, segment.volume);
        }

        // Apply fades
        if (segment.clipFadeSpans && segment.clipFadeSpans.length > 0) {
          channelSamples = applyClipFadeSpans(channelSamples, segment.clipFadeSpans, decoded.sampleRate, fps);
        } else if (fadeInSamples > 0 || fadeOutSamples > 0) {
          channelSamples = applyFades(
            channelSamples,
            fadeInSamples,
            fadeOutSamples,
            false,
            segment.fadeInCurve,
            segment.fadeOutCurve,
            segment.fadeInCurveX,
            segment.fadeOutCurveX,
            contentStartOffsetSamples,
            contentEndOffsetSamples,
            fadeInDelaySamples,
            fadeOutLeadSamples,
          );
        }

        if (crossfadeFadeInSamples > 0 || crossfadeFadeOutSamples > 0) {
          channelSamples = applyFades(
            channelSamples,
            crossfadeFadeInSamples,
            crossfadeFadeOutSamples,
            true,
          );
        }

        // Resample to target sample rate
        if (decoded.sampleRate !== config.sampleRate) {
          channelSamples = await resample(channelSamples, decoded.sampleRate, config.sampleRate);
        }

        processedChannels[c] = channelSamples;
      }

      // Calculate start position in output
      const startSample = Math.floor((segment.startFrame / fps) * config.sampleRate);

      processedSegments.push({
        samples: processedChannels,
        startSample,
        muted: segment.muted,
      });

      log.debug('Processed audio segment', {
        itemId: segment.itemId,
        type: segment.type,
        startSample,
        outputSamples: processedChannels[0]?.length,
      });
    } catch (error) {
      log.error('Failed to process audio segment', {
        itemId: segment.itemId,
        error,
      });
      // Continue with other segments
    }
  }

  if (processedSegments.length === 0) {
    log.warn('No audio segments were successfully processed');
    return null;
  }

  // Mix all segments
  const mixedSamples = mixAudioTracks(processedSegments, config);

  log.info('Audio processing complete', {
    outputSamples: mixedSamples[0]?.length,
    channels: mixedSamples.length,
    durationSeconds: (mixedSamples[0]?.length ?? 0) / config.sampleRate,
  });

  return {
    samples: mixedSamples,
    sampleRate: config.sampleRate,
    channels: config.channels,
  };
}

/**
 * Create an AudioBuffer from processed audio data.
 * This AudioBuffer can then be used with mediabunny's AudioBufferSource.
 *
 * @param audioData - Processed audio samples
 * @returns AudioBuffer ready for encoding
 */
export function createAudioBuffer(
  audioData: { samples: Float32Array[]; sampleRate: number; channels: number }
): AudioBuffer {
  // Create AudioBuffer from Float32Arrays
  const audioContext = new OfflineAudioContext(
    audioData.channels,
    audioData.samples[0]?.length ?? 0,
    audioData.sampleRate
  );

  const audioBuffer = audioContext.createBuffer(
    audioData.channels,
    audioData.samples[0]?.length ?? 0,
    audioData.sampleRate
  );

  // Copy samples to AudioBuffer
  for (let c = 0; c < audioData.channels; c++) {
    const channelData = audioBuffer.getChannelData(c);
    const samples = audioData.samples[c];
    if (samples) {
      channelData.set(samples);
    }
  }

  return audioBuffer;
}

/**
 * Check if composition has any audio content.
 * Async because sub-composition media URLs may need to be resolved from OPFS
 * before extractAudioSegments can see valid src values.
 */
export async function hasAudioContent(composition: CompositionInputProps): Promise<boolean> {
  await resolveSubCompMediaUrls(composition);
  const segments = extractAudioSegments(composition, composition.fps);
  return segments.some((s) => !s.muted);
}
