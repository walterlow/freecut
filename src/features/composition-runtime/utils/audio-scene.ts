import type { AudioItem, VideoItem } from '@/types/timeline';
import type { Transition } from '@/types/transition';
import { timelineToSourceFrames, sourceToTimelineFrames } from '@/features/composition-runtime/deps/timeline';
import { resolveTransitionWindowsForItems } from './scene-assembly';
import type { AudioClipFadeSpan } from '@/shared/utils/audio-fade-curve';

type ContinuousAudioItem = {
  id: string;
  trackId: string;
  from: number;
  durationInFrames: number;
  mediaId?: string;
  originId?: string;
  src?: string;
  sourceStart?: number;
  trimStart?: number;
  offset?: number;
  sourceEnd?: number;
  sourceFps?: number;
  speed?: number;
};

type StandaloneAudioItem = AudioItem & {
  muted: boolean;
  trackVolumeDb: number;
  trackVisible: boolean;
};

type TransitionAudioItem = (VideoItem | AudioItem) & {
  muted: boolean;
  trackVolumeDb: number;
  trackVisible: boolean;
};

export interface AudioSegment {
  key: string;
  itemId: string;
  mediaId?: string;
  src: string;
  from: number;
  durationInFrames: number;
  trimBefore: number;
  playbackRate: number;
  sourceFps?: number;
  volumeDb: number;
  muted: boolean;
  audioFadeIn: number;
  audioFadeOut: number;
  audioFadeInCurve: number;
  audioFadeOutCurve: number;
  audioFadeInCurveX: number;
  audioFadeOutCurveX: number;
  clipFadeSpans?: AudioClipFadeSpan[];
}

export interface VideoAudioSegment extends AudioSegment {
  contentStartOffsetFrames?: number;
  contentEndOffsetFrames?: number;
  fadeInDelayFrames?: number;
  fadeOutLeadFrames?: number;
  crossfadeFadeIn?: number;
  crossfadeFadeOut?: number;
}

export interface CompoundAudioSegment {
  key: string;
  itemId: string;
  from: number;
  durationInFrames: number;
  trimBefore: number;
  playbackRate: number;
  sourceFps?: number;
  volumeDb: number;
  muted: boolean;
  crossfadeFadeIn?: number;
  crossfadeFadeOut?: number;
}

interface ClipAudioExtension {
  before: number;
  after: number;
  overlapFadeOut: number;
  overlapFadeIn: number;
  fadeInDelay: number;
  fadeOutLead: number;
}

function getAudioPlaybackSrc(item: TransitionAudioItem): string {
  if (item.type === 'video') {
    return item.audioSrc ?? item.src;
  }

  return item.src;
}

function buildClipFadeSpan(params: {
  startFrame: number;
  durationInFrames: number;
  audioFadeIn?: number;
  audioFadeOut?: number;
  audioFadeInCurve?: number;
  audioFadeOutCurve?: number;
  audioFadeInCurveX?: number;
  audioFadeOutCurveX?: number;
  fps: number;
}): AudioClipFadeSpan {
  return {
    startFrame: params.startFrame,
    durationInFrames: params.durationInFrames,
    fadeInFrames: (params.audioFadeIn ?? 0) * params.fps,
    fadeOutFrames: (params.audioFadeOut ?? 0) * params.fps,
    fadeInCurve: params.audioFadeInCurve ?? 0,
    fadeOutCurve: params.audioFadeOutCurve ?? 0,
    fadeInCurveX: params.audioFadeInCurveX ?? 0.52,
    fadeOutCurveX: params.audioFadeOutCurveX ?? 0.52,
  };
}

function getTrimBefore(item: ContinuousAudioItem): number {
  return item.sourceStart ?? item.trimStart ?? item.offset ?? 0;
}

function hasExplicitTrimStart(item: ContinuousAudioItem): boolean {
  return item.sourceStart !== undefined || item.trimStart !== undefined || item.offset !== undefined;
}

export function isContinuousAudioBoundary(
  left: ContinuousAudioItem,
  right: ContinuousAudioItem,
  timelineFps = 30,
): boolean {
  const leftSpeed = left.speed ?? 1;
  const rightSpeed = right.speed ?? 1;
  if (Math.abs(leftSpeed - rightSpeed) > 0.0001) return false;

  const sameMedia = (left.mediaId && right.mediaId && left.mediaId === right.mediaId)
    || (!!left.src && !!right.src && left.src === right.src);
  if (!sameMedia) return false;

  if (left.originId && right.originId && left.originId !== right.originId) return false;

  const expectedRightFrom = left.from + left.durationInFrames;
  if (Math.abs(right.from - expectedRightFrom) > 2) return false;

  const leftTrim = getTrimBefore(left);
  const rightTrim = getTrimBefore(right);
  const leftSourceFps = left.sourceFps ?? timelineFps;
  const computedLeftSourceEnd = leftTrim + timelineToSourceFrames(
    left.durationInFrames,
    leftSpeed,
    timelineFps,
    leftSourceFps,
  );
  const storedLeftSourceEnd = left.sourceEnd;
  const computedContinuous = Math.abs(rightTrim - computedLeftSourceEnd) <= 2;
  const storedContinuous = storedLeftSourceEnd !== undefined
    ? Math.abs(rightTrim - storedLeftSourceEnd) <= 2
    : false;

  if (computedContinuous || storedContinuous) return true;

  return !hasExplicitTrimStart(right);
}

export function resolveContinuousClipTrimStarts<TItem extends ContinuousAudioItem>(
  items: TItem[],
  fps: number,
): Map<string, number> {
  const resolvedTrimBeforeById = new Map<string, number>();
  const previousByTrack = new Map<string, TItem>();
  const sortedItems = items.toSorted((a, b) => {
    if (a.trackId !== b.trackId) return a.trackId.localeCompare(b.trackId);
    if (a.from !== b.from) return a.from - b.from;
    return a.id.localeCompare(b.id);
  });

  for (const item of sortedItems) {
    const explicitTrimBefore = getTrimBefore(item);
    let resolvedTrimBefore = explicitTrimBefore;

    if (!hasExplicitTrimStart(item)) {
      const previous = previousByTrack.get(item.trackId);
      if (previous && isContinuousAudioBoundary(previous, item, fps)) {
        const previousTrimBefore = resolvedTrimBeforeById.get(previous.id) ?? getTrimBefore(previous);
        const previousSourceFps = previous.sourceFps ?? fps;
        resolvedTrimBefore = previousTrimBefore + timelineToSourceFrames(
          previous.durationInFrames,
          previous.speed ?? 1,
          fps,
          previousSourceFps,
        );
      }
    }

    resolvedTrimBeforeById.set(item.id, resolvedTrimBefore);
    previousByTrack.set(item.trackId, item);
  }

  return resolvedTrimBeforeById;
}

export function buildStandaloneAudioSegments(
  items: StandaloneAudioItem[],
  fps: number,
): AudioSegment[] {
  const sortedItems = items.toSorted((a, b) => {
    if (a.trackId !== b.trackId) return a.trackId.localeCompare(b.trackId);
    if (a.from !== b.from) return a.from - b.from;
    return a.id.localeCompare(b.id);
  });
  const resolvedTrimBeforeById = resolveContinuousClipTrimStarts(sortedItems, fps);

  type ExpandedAudioSegment = AudioSegment & { clip: StandaloneAudioItem };
  const segments: ExpandedAudioSegment[] = [];

  for (const item of sortedItems) {
    if (!item.src) continue;

    segments.push({
      key: `audio-${item.id}`,
      itemId: item.id,
      mediaId: item.mediaId,
      clip: item,
      src: item.src,
      from: item.from,
      durationInFrames: item.durationInFrames,
      trimBefore: resolvedTrimBeforeById.get(item.id) ?? getTrimBefore(item),
      playbackRate: item.speed ?? 1,
      sourceFps: item.sourceFps,
      volumeDb: (item.volume ?? 0) + (item.trackVolumeDb ?? 0),
      muted: item.muted || !item.trackVisible,
      audioFadeIn: item.audioFadeIn ?? 0,
      audioFadeOut: item.audioFadeOut ?? 0,
      audioFadeInCurve: item.audioFadeInCurve ?? 0,
      audioFadeOutCurve: item.audioFadeOutCurve ?? 0,
      audioFadeInCurveX: item.audioFadeInCurveX ?? 0.52,
      audioFadeOutCurveX: item.audioFadeOutCurveX ?? 0.52,
      clipFadeSpans: [buildClipFadeSpan({
        startFrame: 0,
        durationInFrames: item.durationInFrames,
        audioFadeIn: item.audioFadeIn,
        audioFadeOut: item.audioFadeOut,
        audioFadeInCurve: item.audioFadeInCurve,
        audioFadeOutCurve: item.audioFadeOutCurve,
        audioFadeInCurveX: item.audioFadeInCurveX,
        audioFadeOutCurveX: item.audioFadeOutCurveX,
        fps,
      })],
    });
  }

  const merged: AudioSegment[] = [];
  let active: ExpandedAudioSegment | null = null;

  for (const segment of segments) {
    if (!active) {
      active = { ...segment };
      continue;
    }

    const canMerge = isContinuousAudioBoundary(active.clip, segment.clip, fps)
      && active.src === segment.src
      && Math.abs(active.playbackRate - segment.playbackRate) <= 0.0001
      && Math.abs(active.volumeDb - segment.volumeDb) <= 0.0001
      && active.muted === segment.muted;

    if (canMerge) {
      const activeFrom = active.from;
      active.durationInFrames = (segment.from + segment.durationInFrames) - active.from;
      active.audioFadeOut = segment.audioFadeOut;
      active.audioFadeOutCurve = segment.audioFadeOutCurve;
      active.audioFadeOutCurveX = segment.audioFadeOutCurveX;
      active.clipFadeSpans = [...(active.clipFadeSpans ?? []), ...((segment.clipFadeSpans ?? []).map((span) => ({
        ...span,
        startFrame: span.startFrame + (segment.from - activeFrom),
      })))];
      active.clip = segment.clip;
      continue;
    }

    merged.push({
      key: active.key,
      itemId: active.itemId,
      mediaId: active.mediaId,
      src: active.src,
      from: active.from,
      durationInFrames: active.durationInFrames,
      trimBefore: active.trimBefore,
      playbackRate: active.playbackRate,
      sourceFps: active.sourceFps,
      volumeDb: active.volumeDb,
      muted: active.muted,
      audioFadeIn: active.audioFadeIn,
      audioFadeOut: active.audioFadeOut,
      audioFadeInCurve: active.audioFadeInCurve,
      audioFadeOutCurve: active.audioFadeOutCurve,
      audioFadeInCurveX: active.audioFadeInCurveX,
      audioFadeOutCurveX: active.audioFadeOutCurveX,
      clipFadeSpans: active.clipFadeSpans,
    });
    active = { ...segment };
  }

  if (active) {
    merged.push({
      key: active.key,
      itemId: active.itemId,
      mediaId: active.mediaId,
      src: active.src,
      from: active.from,
      durationInFrames: active.durationInFrames,
      trimBefore: active.trimBefore,
      playbackRate: active.playbackRate,
      sourceFps: active.sourceFps,
      volumeDb: active.volumeDb,
      muted: active.muted,
      audioFadeIn: active.audioFadeIn,
      audioFadeOut: active.audioFadeOut,
      audioFadeInCurve: active.audioFadeInCurve,
      audioFadeOutCurve: active.audioFadeOutCurve,
      audioFadeInCurveX: active.audioFadeInCurveX,
      audioFadeOutCurveX: active.audioFadeOutCurveX,
      clipFadeSpans: active.clipFadeSpans,
    });
  }

  return merged;
}

export function buildTransitionVideoAudioSegments(
  items: TransitionAudioItem[],
  transitions: Transition[],
  fps: number,
): VideoAudioSegment[] {
  const sortedItems = items.toSorted((a, b) => {
    if (a.trackId !== b.trackId) return a.trackId.localeCompare(b.trackId);
    if (a.from !== b.from) return a.from - b.from;
    return a.id.localeCompare(b.id);
  });
  const resolvedTrimBeforeById = resolveContinuousClipTrimStarts(sortedItems, fps);
  const resolvedWindows = resolveTransitionWindowsForItems(transitions, sortedItems);
  const extensionByClipId = new Map<string, ClipAudioExtension>();

  const ensureExtension = (clipId: string): ClipAudioExtension => {
    const existing = extensionByClipId.get(clipId);
    if (existing) return existing;
    const created: ClipAudioExtension = { before: 0, after: 0, overlapFadeOut: 0, overlapFadeIn: 0, fadeInDelay: 0, fadeOutLead: 0 };
    extensionByClipId.set(clipId, created);
    return created;
  };

  for (const window of resolvedWindows) {
    const left = window.leftClip;
    const right = window.rightClip;
    if (!getAudioPlaybackSrc(left) || !getAudioPlaybackSrc(right)) continue;
    if (isContinuousAudioBoundary(left, right, fps)) continue;

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

  type ExpandedVideoAudioSegment = VideoAudioSegment & {
    clip: TransitionAudioItem;
    beforeFrames: number;
    afterFrames: number;
  };
  const expandedSegments: ExpandedVideoAudioSegment[] = [];

  for (const item of sortedItems) {
    const audioSrc = getAudioPlaybackSrc(item);
    if (!audioSrc) continue;

    const playbackRate = item.speed ?? 1;
    const itemSourceFps = item.sourceFps ?? fps;
    const baseTrimBefore = resolvedTrimBeforeById.get(item.id) ?? getTrimBefore(item);
    const extension = extensionByClipId.get(item.id) ?? { before: 0, after: 0, overlapFadeOut: 0, overlapFadeIn: 0, fadeInDelay: 0, fadeOutLead: 0 };
    const maxBeforeBySource = playbackRate > 0
      ? sourceToTimelineFrames(baseTrimBefore, playbackRate, itemSourceFps, fps)
      : 0;
    const before = Math.max(0, Math.min(extension.before, maxBeforeBySource));
    const after = Math.max(0, extension.after);
    const crossfadeFadeIn = extension.overlapFadeIn > 0
      ? extension.overlapFadeIn
      : (before > 0 ? before : undefined);
    const crossfadeFadeOut = extension.overlapFadeOut > 0
      ? extension.overlapFadeOut
      : (after > 0 ? after : undefined);

    expandedSegments.push({
      key: `video-audio-${item.id}`,
      itemId: item.id,
      mediaId: item.mediaId,
      clip: item,
      src: audioSrc,
      from: item.from - before,
      durationInFrames: item.durationInFrames + before + after,
      trimBefore: Math.max(0, baseTrimBefore - timelineToSourceFrames(before, playbackRate, fps, itemSourceFps)),
      playbackRate,
      sourceFps: item.sourceFps,
      volumeDb: (item.volume ?? 0) + (item.trackVolumeDb ?? 0),
      muted: item.muted || !item.trackVisible,
      audioFadeIn: item.audioFadeIn ?? 0,
      audioFadeOut: item.audioFadeOut ?? 0,
      audioFadeInCurve: item.audioFadeInCurve ?? 0,
      audioFadeOutCurve: item.audioFadeOutCurve ?? 0,
      audioFadeInCurveX: item.audioFadeInCurveX ?? 0.52,
      audioFadeOutCurveX: item.audioFadeOutCurveX ?? 0.52,
      clipFadeSpans: [buildClipFadeSpan({
        startFrame: before,
        durationInFrames: item.durationInFrames,
        audioFadeIn: item.audioFadeIn,
        audioFadeOut: item.audioFadeOut,
        audioFadeInCurve: item.audioFadeInCurve,
        audioFadeOutCurve: item.audioFadeOutCurve,
        audioFadeInCurveX: item.audioFadeInCurveX,
        audioFadeOutCurveX: item.audioFadeOutCurveX,
        fps,
      })],
      contentStartOffsetFrames: before,
      contentEndOffsetFrames: after,
      fadeInDelayFrames: extension.fadeInDelay,
      fadeOutLeadFrames: extension.fadeOutLead,
      crossfadeFadeIn,
      crossfadeFadeOut,
      beforeFrames: before,
      afterFrames: after,
    });
  }

  const merged: VideoAudioSegment[] = [];
  let active: ExpandedVideoAudioSegment | null = null;

  for (const segment of expandedSegments.toSorted((a, b) => {
    if (a.from !== b.from) return a.from - b.from;
    return a.key.localeCompare(b.key);
  })) {
    if (!active) {
      active = { ...segment };
      continue;
    }

    const canMerge = isContinuousAudioBoundary(active.clip, segment.clip, fps)
      && active.src === segment.src
      && Math.abs(active.playbackRate - segment.playbackRate) <= 0.0001
      && Math.abs(active.volumeDb - segment.volumeDb) <= 0.0001
      && active.muted === segment.muted
      && active.afterFrames === 0
      && segment.beforeFrames === 0;

    if (canMerge) {
      const activeFrom = active.from;
      active.durationInFrames = (segment.from + segment.durationInFrames) - active.from;
      active.audioFadeOut = segment.audioFadeOut;
      active.audioFadeOutCurve = segment.audioFadeOutCurve;
      active.audioFadeOutCurveX = segment.audioFadeOutCurveX;
      active.contentEndOffsetFrames = segment.contentEndOffsetFrames;
      active.fadeOutLeadFrames = segment.fadeOutLeadFrames;
      active.crossfadeFadeOut = segment.crossfadeFadeOut;
      active.clipFadeSpans = [...(active.clipFadeSpans ?? []), ...((segment.clipFadeSpans ?? []).map((span) => ({
        ...span,
        startFrame: span.startFrame + (segment.from - activeFrom),
      })))];
      active.clip = segment.clip;
      active.afterFrames = segment.afterFrames;
      continue;
    }

    merged.push({
      key: active.key,
      itemId: active.itemId,
      mediaId: active.mediaId,
      src: active.src,
      from: active.from,
      durationInFrames: active.durationInFrames,
      trimBefore: active.trimBefore,
      playbackRate: active.playbackRate,
      sourceFps: active.sourceFps,
      volumeDb: active.volumeDb,
      muted: active.muted,
      audioFadeIn: active.audioFadeIn,
      audioFadeOut: active.audioFadeOut,
      audioFadeInCurve: active.audioFadeInCurve,
      audioFadeOutCurve: active.audioFadeOutCurve,
      audioFadeInCurveX: active.audioFadeInCurveX,
      audioFadeOutCurveX: active.audioFadeOutCurveX,
      clipFadeSpans: active.clipFadeSpans,
      contentStartOffsetFrames: active.contentStartOffsetFrames,
      contentEndOffsetFrames: active.contentEndOffsetFrames,
      fadeInDelayFrames: active.fadeInDelayFrames,
      fadeOutLeadFrames: active.fadeOutLeadFrames,
      crossfadeFadeIn: active.crossfadeFadeIn,
      crossfadeFadeOut: active.crossfadeFadeOut,
    });
    active = { ...segment };
  }

  if (active) {
    merged.push({
      key: active.key,
      itemId: active.itemId,
      mediaId: active.mediaId,
      src: active.src,
      from: active.from,
      durationInFrames: active.durationInFrames,
      trimBefore: active.trimBefore,
      playbackRate: active.playbackRate,
      sourceFps: active.sourceFps,
      volumeDb: active.volumeDb,
      muted: active.muted,
      audioFadeIn: active.audioFadeIn,
      audioFadeOut: active.audioFadeOut,
      audioFadeInCurve: active.audioFadeInCurve,
      audioFadeOutCurve: active.audioFadeOutCurve,
      audioFadeInCurveX: active.audioFadeInCurveX,
      audioFadeOutCurveX: active.audioFadeOutCurveX,
      clipFadeSpans: active.clipFadeSpans,
      contentStartOffsetFrames: active.contentStartOffsetFrames,
      contentEndOffsetFrames: active.contentEndOffsetFrames,
      fadeInDelayFrames: active.fadeInDelayFrames,
      fadeOutLeadFrames: active.fadeOutLeadFrames,
      crossfadeFadeIn: active.crossfadeFadeIn,
      crossfadeFadeOut: active.crossfadeFadeOut,
    });
  }

  return merged;
}

type CompoundTransitionAudioItem = AudioItem & {
  compositionId: string;
  muted: boolean;
  trackVolumeDb: number;
  trackVisible: boolean;
};

export function buildCompoundAudioTransitionSegments(
  items: CompoundTransitionAudioItem[],
  transitions: Transition[],
  fps: number,
): CompoundAudioSegment[] {
  const sortedItems = items.toSorted((a, b) => {
    if (a.trackId !== b.trackId) return a.trackId.localeCompare(b.trackId);
    if (a.from !== b.from) return a.from - b.from;
    return a.id.localeCompare(b.id);
  });
  const resolvedTrimBeforeById = resolveContinuousClipTrimStarts(sortedItems, fps);
  const resolvedWindows = resolveTransitionWindowsForItems(transitions, sortedItems);
  const extensionByClipId = new Map<string, ClipAudioExtension>();

  const ensureExtension = (clipId: string): ClipAudioExtension => {
    const existing = extensionByClipId.get(clipId);
    if (existing) return existing;
    const created: ClipAudioExtension = { before: 0, after: 0, overlapFadeOut: 0, overlapFadeIn: 0, fadeInDelay: 0, fadeOutLead: 0 };
    extensionByClipId.set(clipId, created);
    return created;
  };

  for (const window of resolvedWindows) {
    const left = window.leftClip;
    const right = window.rightClip;
    if (isContinuousAudioBoundary(left, right, fps)) continue;

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
      const rightExt = ensureExtension(right.id);
      rightExt.overlapFadeIn = Math.max(rightExt.overlapFadeIn, window.durationInFrames);
    }
  }

  return sortedItems.map((item) => {
    const playbackRate = item.speed ?? 1;
    const itemSourceFps = item.sourceFps ?? fps;
    const baseTrimBefore = resolvedTrimBeforeById.get(item.id) ?? getTrimBefore(item);
    const extension = extensionByClipId.get(item.id) ?? { before: 0, after: 0, overlapFadeOut: 0, overlapFadeIn: 0, fadeInDelay: 0, fadeOutLead: 0 };
    const maxBeforeBySource = playbackRate > 0
      ? sourceToTimelineFrames(baseTrimBefore, playbackRate, itemSourceFps, fps)
      : 0;
    const before = Math.max(0, Math.min(extension.before, maxBeforeBySource));
    const after = Math.max(0, extension.after);

    return {
      key: `compound-audio-${item.id}`,
      itemId: item.id,
      from: item.from - before,
      durationInFrames: item.durationInFrames + before + after,
      trimBefore: Math.max(0, baseTrimBefore - timelineToSourceFrames(before, playbackRate, fps, itemSourceFps)),
      playbackRate,
      sourceFps: item.sourceFps,
      volumeDb: (item.volume ?? 0) + (item.trackVolumeDb ?? 0),
      muted: item.muted || !item.trackVisible,
      crossfadeFadeIn: extension.overlapFadeIn > 0 ? extension.overlapFadeIn : (before > 0 ? before : undefined),
      crossfadeFadeOut: extension.overlapFadeOut > 0 ? extension.overlapFadeOut : (after > 0 ? after : undefined),
    } satisfies CompoundAudioSegment;
  });
}
