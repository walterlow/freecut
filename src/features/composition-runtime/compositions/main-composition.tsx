import React, { useMemo, useCallback } from 'react';
import { AbsoluteFill, Sequence, useSequenceContext } from '@/features/composition-runtime/deps/player';
import { useVideoConfig } from '../hooks/use-player-compat';
import type { CompositionInputProps } from '@/types/export';
import type { TimelineItem, TextItem, ShapeItem, AdjustmentItem, VideoItem, AudioItem, ImageItem } from '@/types/timeline';
import { Item, type MaskInfo } from '../components/item';
import { PitchCorrectedAudio } from '../components/pitch-corrected-audio';
import { CustomDecoderAudio } from '../components/custom-decoder-audio';
import { useMediaLibraryStore } from '@/features/composition-runtime/deps/stores';
import { needsCustomAudioDecoder } from '../utils/audio-codec-detection';
import { timelineToSourceFrames, sourceToTimelineFrames } from '@/features/composition-runtime/deps/timeline';
import { StableVideoSequence, type StableVideoSequenceItem } from '../components/stable-video-sequence';
import { loadFonts } from '../utils/fonts';
import { resolveTransform } from '../utils/transform-resolver';
import { resolveTransitionWindows } from '@/domain/timeline/transitions/transition-planner';
import { useGizmoStore } from '@/features/composition-runtime/deps/stores';
import { ItemEffectWrapper, type AdjustmentLayerWithTrackOrder } from '../components/item-effect-wrapper';
import { KeyframesProvider } from '../contexts/keyframes-context';
import { KeyframesContext } from '../contexts/keyframes-context-core';
import { resolveAnimatedTransform, hasKeyframeAnimation } from '@/features/composition-runtime/deps/keyframes';
import { CompositionSpaceProvider } from '../contexts/composition-space-context';

/**
 * A visual item (video/image) with track rendering metadata
 */
type EnrichedVisualItem = (VideoItem | ImageItem) & {
  zIndex: number;
  muted: boolean;
  trackOrder: number;
  trackVisible: boolean;
};
type EnrichedVideoItem = EnrichedVisualItem & { type: 'video' };

/** Mask shape with its track order for scope calculation */
interface MaskWithTrackOrder {
  mask: ShapeItem;
  trackOrder: number;
}

/**
 * Resolve active shape masks for the current frame with keyframe animation.
 * Called per-item inside <Sequence> so useSequenceContext() provides per-frame updates.
 *
 * Uses useSequenceContext() instead of useCurrentFrame() because Sequence internally
 * subscribes to the Clock via useSyncExternalStore, guaranteeing per-frame re-renders.
 * useCurrentFrame() reads from BridgedTimelineContext which may not propagate updates
 * through memo boundaries and children-as-props optimizations.
 */
function useActiveMasks(
  masks: MaskWithTrackOrder[],
  canvasWidth: number,
  canvasHeight: number,
  fps: number,
): MaskInfo[] {
  // Compute global frame from sequence context (reliable per-frame updates inside <Sequence>)
  const sequenceCtx = useSequenceContext();
  const globalFrame = (sequenceCtx?.from ?? 0) + (sequenceCtx?.localFrame ?? 0);

  const keyframesCtx = React.useContext(KeyframesContext);
  const canvas = { width: canvasWidth, height: canvasHeight, fps };

  return useMemo<MaskInfo[]>(() => {
    if (masks.length === 0) return [];
    return masks
      .filter(({ mask }) => {
        const start = mask.from;
        const end = mask.from + mask.durationInFrames;
        return globalFrame >= start && globalFrame < end;
      })
      .map(({ mask }) => {
        const baseResolved = resolveTransform(mask, canvas);
        const maskKeyframes = keyframesCtx?.getItemKeyframes(mask.id);
        const relativeFrame = globalFrame - mask.from;
        const animatedResolved = (maskKeyframes && hasKeyframeAnimation(maskKeyframes))
          ? resolveAnimatedTransform(baseResolved, maskKeyframes, relativeFrame)
          : baseResolved;

        return {
          shape: mask,
          transform: {
            x: animatedResolved.x,
            y: animatedResolved.y,
            width: animatedResolved.width,
            height: animatedResolved.height,
            rotation: animatedResolved.rotation,
            opacity: animatedResolved.opacity,
            cornerRadius: animatedResolved.cornerRadius,
          },
        };
      });
  }, [masks, globalFrame, keyframesCtx, canvasWidth, canvasHeight, fps]);
}

interface ClipAudioExtension {
  before: number;
  after: number;
  /** Overlap model: crossfade out over this many frames at the end of the left (outgoing) clip */
  overlapFadeOut: number;
  /** Overlap model: crossfade in over this many frames at the start of the right (incoming) clip */
  overlapFadeIn: number;
}

interface VideoAudioSegment {
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
  crossfadeFadeIn?: number;
  crossfadeFadeOut?: number;
}

interface AudioSegment {
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
}

function getVideoTrimBefore(item: EnrichedVideoItem): number {
  return item.sourceStart ?? item.trimStart ?? item.offset ?? 0;
}

function hasExplicitTrimStart(item: EnrichedVideoItem): boolean {
  return item.sourceStart !== undefined || item.trimStart !== undefined || item.offset !== undefined;
}

/**
 * Enriched audio item with track rendering metadata (parallel to EnrichedVideoItem)
 */
type EnrichedAudioItem = AudioItem & {
  muted: boolean;
  trackVisible: boolean;
};

function getAudioTrimBefore(item: EnrichedAudioItem): number {
  return item.sourceStart ?? item.trimStart ?? item.offset ?? 0;
}

function hasExplicitAudioTrimStart(item: EnrichedAudioItem): boolean {
  return item.sourceStart !== undefined || item.trimStart !== undefined || item.offset !== undefined;
}

/**
 * Check if two adjacent audio items form a continuous boundary (same source, same speed,
 * source frames line up). Mirrors isContinuousAudioTransition for standalone audio clips.
 */
function isContinuousAudioBoundary(left: EnrichedAudioItem, right: EnrichedAudioItem, timelineFps: number = 30): boolean {
  const leftSpeed = left.speed ?? 1;
  const rightSpeed = right.speed ?? 1;
  if (Math.abs(leftSpeed - rightSpeed) > 0.0001) return false;

  const sameMedia = (left.mediaId && right.mediaId && left.mediaId === right.mediaId)
    || (!!left.src && !!right.src && left.src === right.src);
  if (!sameMedia) return false;

  if (left.originId && right.originId && left.originId !== right.originId) return false;

  const expectedRightFrom = left.from + left.durationInFrames;
  if (Math.abs(right.from - expectedRightFrom) > 2) return false;

  const leftTrim = getAudioTrimBefore(left);
  const rightTrim = getAudioTrimBefore(right);
  const leftSourceFps = left.sourceFps ?? timelineFps;
  const computedLeftSourceEnd = leftTrim + timelineToSourceFrames(left.durationInFrames, leftSpeed, timelineFps, leftSourceFps);
  const storedLeftSourceEnd = left.sourceEnd;
  const computedContinuous = Math.abs(rightTrim - computedLeftSourceEnd) <= 2;
  const storedContinuous = storedLeftSourceEnd !== undefined
    ? Math.abs(rightTrim - storedLeftSourceEnd) <= 2
    : false;

  if (computedContinuous || storedContinuous) return true;

  const rightMissingTrimStart = !hasExplicitAudioTrimStart(right);
  return rightMissingTrimStart;
}

function isContinuousAudioTransition(left: EnrichedVideoItem, right: EnrichedVideoItem, timelineFps: number = 30): boolean {
  const leftSpeed = left.speed ?? 1;
  const rightSpeed = right.speed ?? 1;
  if (Math.abs(leftSpeed - rightSpeed) > 0.0001) return false;

  const sameMedia = (left.mediaId && right.mediaId && left.mediaId === right.mediaId)
    || (!!left.src && !!right.src && left.src === right.src);
  if (!sameMedia) return false;

  // Prefer lineage continuity when available (split clips share originId).
  if (left.originId && right.originId && left.originId !== right.originId) return false;

  const expectedRightFrom = left.from + left.durationInFrames;
  if (Math.abs(right.from - expectedRightFrom) > 2) return false;

  const leftTrim = getVideoTrimBefore(left);
  const rightTrim = getVideoTrimBefore(right);
  // Use FPS-aware conversion: sourceStart is in source FPS frames, so the delta
  // from timeline duration must also be converted to source FPS frames.
  const leftSourceFps = left.sourceFps ?? timelineFps;
  const computedLeftSourceEnd = leftTrim + timelineToSourceFrames(left.durationInFrames, leftSpeed, timelineFps, leftSourceFps);
  const storedLeftSourceEnd = left.sourceEnd;
  const computedContinuous = Math.abs(rightTrim - computedLeftSourceEnd) <= 2;
  const storedContinuous = storedLeftSourceEnd !== undefined
    ? Math.abs(rightTrim - storedLeftSourceEnd) <= 2
    : false;

  // Accept either computed or stored continuity - stored sourceEnd can become stale
  // after downstream trim/rate edits, while computed value remains reliable.
  if (computedContinuous || storedContinuous) return true;

  // Legacy fallback: when right split metadata is missing explicit trim start,
  // but clips are adjacent and from the same lineage/source, treat as continuous.
  const rightMissingTrimStart = !hasExplicitTrimStart(right);
  return rightMissingTrimStart;
}

// ClearingLayer removed - was causing flicker at clip boundaries
// Background layer at z-index -1 is sufficient for showing background color

/** Item wrapper that resolves shape masks per-frame inside a <Sequence> */
const MaskedItem: React.FC<{
  item: TimelineItem;
  muted: boolean;
  shapeMasks: MaskWithTrackOrder[];
  canvasWidth: number;
  canvasHeight: number;
  fps: number;
}> = ({ item, muted, shapeMasks, canvasWidth, canvasHeight, fps }) => {
  const masks = useActiveMasks(shapeMasks, canvasWidth, canvasHeight, fps);
  return <Item item={item} muted={muted} masks={masks} />;
};


/**
 * Main Composition Composition
 *
 * ARCHITECTURE FOR STABLE DOM (prevents re-renders on item/adjustment layer add/delete):
 *
 * MASKING:
 * 1. ALL content rendered through single StableMaskedGroup wrapper
 * 2. MaskDefinitions: SVG mask defs with OPACITY-CONTROLLED activation
 * 3. Mask effect toggled via SVG internal opacity, not DOM structure changes
 * 4. Deleting/adding masks doesn't move items between DOM parents â†’ no remount
 *
 * ADJUSTMENT LAYER EFFECTS:
 * 1. ALL effects (CSS filter, glitch, halftone) applied PER-ITEM via ItemEffectWrapper
 * 2. Each item checks if it should have effects based on track order
 * 3. Only items BELOW adjustment layer (higher track order) receive effects
 * 4. Adding/removing adjustment layers doesn't change DOM structure
 */
export const MainComposition: React.FC<CompositionInputProps> = ({
  tracks,
  transitions = [],
  backgroundColor = '#000000',
  keyframes,
  width: compositionWidth,
  height: compositionHeight,
}) => {
  const { fps, width: renderWidth, height: renderHeight } = useVideoConfig();
  const projectWidth = compositionWidth ?? renderWidth;
  const projectHeight = compositionHeight ?? renderHeight;
  const canvasWidth = renderWidth;
  const canvasHeight = renderHeight;
  // NOTE: useCurrentFrame() removed from here to prevent per-frame re-renders.
  // Frame-dependent logic is now isolated in FrameAwareMaskDefinitions and ClearingLayer.

  // Read preview color directly from store to avoid inputProps changes during color picker drag
  // This prevents Player from seeking/refreshing when user scrubs the color picker
  const canvasBackgroundPreview = useGizmoStore((s) => s.canvasBackgroundPreview);
  const effectiveBackgroundColor = canvasBackgroundPreview ?? backgroundColor;

  const hasSoloTracks = useMemo(() => tracks.some((track) => track.solo), [tracks]);
  const maxOrder = useMemo(() => Math.max(...tracks.map((t) => t.order ?? 0), 0), [tracks]);

  const visibleTracks = useMemo(() =>
    tracks.filter((track) => {
      if (hasSoloTracks) return track.solo;
      return track.visible !== false;
    }),
    [tracks, hasSoloTracks]
  );

  // Shared visibility lookup - used by videoItems and nonMediaByTrack for stable DOM structure
  const visibleTrackIds = useMemo(() => new Set(visibleTracks.map((t) => t.id)), [visibleTracks]);

  // Get all video and image items for transitions and rendering
  // Z-index scheme: (maxOrder - trackOrder) * 1000 gives each track a z-index band
  // This ensures track order is the primary factor for layering
  const allVisualItems: EnrichedVisualItem[] = useMemo(() =>
    tracks.flatMap((track) =>
      track.items
        .filter((item) => item.type === 'video' || item.type === 'image')
        .map((item) => ({
          ...item,
          zIndex: (maxOrder - (track.order ?? 0)) * 1000,
          muted: track.muted ?? false,
          trackOrder: track.order ?? 0,
          trackVisible: visibleTrackIds.has(track.id),
        }))
    ) as EnrichedVisualItem[],
    [tracks, visibleTrackIds, maxOrder]
  );

  // Build item lookup map for effects-based transitions
  // Video items for rendering (all video items, rendered by StableVideoSequence)
  const videoItems = useMemo(() =>
    allVisualItems.filter((item): item is StableVideoSequenceItem => item.type === 'video'),
    [allVisualItems]
  );

  // Audio items are memoized separately and rendered outside mask groups
  // This prevents audio from being affected by visual layer changes (mask add/delete, item moves)
  // Use ALL tracks for stable DOM structure, with trackVisible for conditional playback
  const audioItems: EnrichedAudioItem[] = useMemo(() =>
    tracks.flatMap((track) =>
      track.items
        .filter((item): item is AudioItem => item.type === 'audio')
        .map((item) => ({
          ...item,
          muted: track.muted,
          trackVisible: visibleTrackIds.has(track.id),
        }))
    ),
    [tracks, visibleTrackIds]
  );

  // Merge continuous split audio clips into single segments to prevent
  // audio element remount (click/gap) at split boundaries.
  // Mirrors the videoAudioSegments merging pattern.
  const audioSegments = useMemo<AudioSegment[]>(() => {
    // Sort by track and time for adjacency detection
    const sorted = audioItems.toSorted((a, b) => {
      if (a.trackId !== b.trackId) return a.trackId.localeCompare(b.trackId);
      if (a.from !== b.from) return a.from - b.from;
      return a.id.localeCompare(b.id);
    });

    // Build resolved trim-before with continuity repair for legacy metadata
    const resolvedTrimBeforeById = new Map<string, number>();
    const previousByTrack = new Map<string, EnrichedAudioItem>();

    for (const item of sorted) {
      const explicitTrimBefore = getAudioTrimBefore(item);
      let resolvedTrimBefore = explicitTrimBefore;

      if (!hasExplicitAudioTrimStart(item)) {
        const previous = previousByTrack.get(item.trackId);
        if (previous) {
          const prevSpeed = previous.speed ?? 1;
          const clipSpeed = item.speed ?? 1;
          const sameSpeed = Math.abs(prevSpeed - clipSpeed) <= 0.0001;
          const sameMedia = (previous.mediaId && item.mediaId && previous.mediaId === item.mediaId)
            || (!!previous.src && !!item.src && previous.src === item.src);
          const adjacent = Math.abs(item.from - (previous.from + previous.durationInFrames)) <= 2;
          const sameOrigin = previous.originId && item.originId
            ? previous.originId === item.originId
            : true;

          if (sameSpeed && sameMedia && adjacent && sameOrigin) {
            const prevTrimBefore = resolvedTrimBeforeById.get(previous.id) ?? getAudioTrimBefore(previous);
            const prevSourceFps = previous.sourceFps ?? fps;
            resolvedTrimBefore = prevTrimBefore + timelineToSourceFrames(previous.durationInFrames, prevSpeed, fps, prevSourceFps);
          }
        }
      }

      resolvedTrimBeforeById.set(item.id, resolvedTrimBefore);
      previousByTrack.set(item.trackId, item);
    }

    // Build per-clip segments
    type ExpandedAudioSegment = AudioSegment & { clip: EnrichedAudioItem };
    const segments: ExpandedAudioSegment[] = [];

    for (const item of sorted) {
      if (!item.src) continue;

      const playbackRate = item.speed ?? 1;
      const baseTrimBefore = resolvedTrimBeforeById.get(item.id) ?? getAudioTrimBefore(item);

      segments.push({
        key: `audio-${item.id}`,
        itemId: item.id,
        mediaId: item.mediaId,
        clip: item,
        src: item.src,
        from: item.from,
        durationInFrames: item.durationInFrames,
        trimBefore: baseTrimBefore,
        playbackRate,
        sourceFps: item.sourceFps,
        volumeDb: item.volume ?? 0,
        muted: item.muted || !item.trackVisible,
        audioFadeIn: item.audioFadeIn ?? 0,
        audioFadeOut: item.audioFadeOut ?? 0,
      });
    }

    // Merge continuous split boundaries into single segments
    const canMerge = (left: ExpandedAudioSegment, right: ExpandedAudioSegment): boolean => {
      if (!isContinuousAudioBoundary(left.clip, right.clip, fps)) return false;
      if (left.src !== right.src) return false;
      if (Math.abs(left.playbackRate - right.playbackRate) > 0.0001) return false;
      if (Math.abs(left.volumeDb - right.volumeDb) > 0.0001) return false;
      if (left.muted !== right.muted) return false;
      return true;
    };

    const toPublic = (s: ExpandedAudioSegment): AudioSegment => ({
      key: s.key,
      itemId: s.itemId,
      mediaId: s.mediaId,
      src: s.src,
      from: s.from,
      durationInFrames: s.durationInFrames,
      trimBefore: s.trimBefore,
      playbackRate: s.playbackRate,
      sourceFps: s.sourceFps,
      volumeDb: s.volumeDb,
      muted: s.muted,
      audioFadeIn: s.audioFadeIn,
      audioFadeOut: s.audioFadeOut,
    });

    const merged: AudioSegment[] = [];
    let active: ExpandedAudioSegment | null = null;

    for (const segment of segments) {
      if (!active) {
        active = { ...segment };
        continue;
      }

      if (canMerge(active, segment)) {
        const mergedEnd = segment.from + segment.durationInFrames;
        active.durationInFrames = mergedEnd - active.from;
        active.audioFadeOut = segment.audioFadeOut;
        active.clip = segment.clip;
        continue;
      }

      merged.push(toPublic(active));
      active = { ...segment };
    }

    if (active) {
      merged.push(toPublic(active));
    }

    return merged;
  }, [audioItems, fps]);

  // Video audio is rendered in a dedicated audio layer to decouple audio
  // from transition visual overlays and pooled video element state.
  const videoAudioItems = useMemo(() =>
    allVisualItems.filter((item): item is EnrichedVideoItem => item.type === 'video'),
    [allVisualItems]
  );

  // Build explicit audio playback segments for transition overlaps:
  // - One continuous segment per clip (decoupled from visual transitions)
  // - Segments are expanded into transition handles so both clips overlap chronologically
  const videoAudioSegments = useMemo<VideoAudioSegment[]>(() => {
    const clipsById = new Map(videoAudioItems.map((item) => [item.id, item]));
    const resolvedWindows = resolveTransitionWindows(transitions, clipsById);
    const extensionByClipId = new Map<string, ClipAudioExtension>();
    const resolvedTrimBeforeById = new Map<string, number>();

    // Build per-clip trim starts with fallback continuity repair for legacy split metadata.
    const sortedByTrackAndTime = videoAudioItems.toSorted((a, b) => {
      if (a.trackId !== b.trackId) return a.trackId.localeCompare(b.trackId);
      if (a.from !== b.from) return a.from - b.from;
      return a.id.localeCompare(b.id);
    });

    const previousByTrack = new Map<string, EnrichedVideoItem>();
    for (const clip of sortedByTrackAndTime) {
      const explicitTrimBefore = getVideoTrimBefore(clip);
      let resolvedTrimBefore = explicitTrimBefore;

      if (!hasExplicitTrimStart(clip)) {
        const previous = previousByTrack.get(clip.trackId);
        if (previous) {
          const previousSpeed = previous.speed ?? 1;
          const clipSpeed = clip.speed ?? 1;
          const sameSpeed = Math.abs(previousSpeed - clipSpeed) <= 0.0001;
          const sameMedia = (previous.mediaId && clip.mediaId && previous.mediaId === clip.mediaId)
            || (!!previous.src && !!clip.src && previous.src === clip.src);
          const adjacent = Math.abs(clip.from - (previous.from + previous.durationInFrames)) <= 2;
          const sameOrigin = previous.originId && clip.originId
            ? previous.originId === clip.originId
            : true;

          if (sameSpeed && sameMedia && adjacent && sameOrigin) {
            const previousTrimBefore = resolvedTrimBeforeById.get(previous.id) ?? getVideoTrimBefore(previous);
            // Use FPS-aware conversion: previousTrimBefore is in source FPS frames,
            // so the delta must also be in source FPS frames.
            const previousSourceFps = previous.sourceFps ?? fps;
            resolvedTrimBefore = previousTrimBefore + timelineToSourceFrames(previous.durationInFrames, previousSpeed, fps, previousSourceFps);
          }
        }
      }

      resolvedTrimBeforeById.set(clip.id, resolvedTrimBefore);
      previousByTrack.set(clip.trackId, clip);
    }

    const ensureExtension = (clipId: string): ClipAudioExtension => {
      const existing = extensionByClipId.get(clipId);
      if (existing) return existing;
      const created: ClipAudioExtension = { before: 0, after: 0, overlapFadeOut: 0, overlapFadeIn: 0 };
      extensionByClipId.set(clipId, created);
      return created;
    };

    for (const window of resolvedWindows) {
      const left = clipsById.get(window.transition.leftClipId);
      const right = clipsById.get(window.transition.rightClipId);
      if (!left || !right || !left.src || !right.src) continue;
      if (isContinuousAudioTransition(left, right, fps)) continue;

      // Old model: extend clips to cover transition window
      const rightPreRoll = Math.max(0, right.from - window.startFrame);
      const leftPostRoll = Math.max(
        0,
        window.endFrame - (left.from + left.durationInFrames)
      );

      if (rightPreRoll > 0) {
        const rightExt = ensureExtension(right.id);
        rightExt.before = Math.max(rightExt.before, rightPreRoll);
      }

      if (leftPostRoll > 0) {
        const leftExt = ensureExtension(left.id);
        leftExt.after = Math.max(leftExt.after, leftPostRoll);
      }

      // Overlap model: crossfade audio during the overlap region.
      // Left clip fades out, right clip fades in (equal-power sin/cos curves).
      const overlapDuration = window.durationInFrames;
      if (overlapDuration > 0) {
        const leftExt = ensureExtension(left.id);
        leftExt.overlapFadeOut = Math.max(leftExt.overlapFadeOut, overlapDuration);
        const rightExt = ensureExtension(right.id);
        rightExt.overlapFadeIn = Math.max(rightExt.overlapFadeIn, overlapDuration);
      }
    }

    type ExpandedVideoAudioSegment = VideoAudioSegment & {
      clip: EnrichedVideoItem;
      beforeFrames: number;
      afterFrames: number;
    };

    const expandedSegments: ExpandedVideoAudioSegment[] = [];
    for (const item of videoAudioItems) {
      if (!item.src) continue;

      const playbackRate = item.speed ?? 1;
      const itemSourceFps = item.sourceFps ?? fps;
      const baseTrimBefore = resolvedTrimBeforeById.get(item.id) ?? getVideoTrimBefore(item);
      const extension = extensionByClipId.get(item.id) ?? { before: 0, after: 0, overlapFadeOut: 0, overlapFadeIn: 0 };
      // baseTrimBefore is in source FPS frames; convert to timeline frames for comparison
      const maxBeforeBySource = playbackRate > 0
        ? sourceToTimelineFrames(baseTrimBefore, playbackRate, itemSourceFps, fps)
        : 0;
      const before = Math.max(0, Math.min(extension.before, maxBeforeBySource));
      const after = Math.max(0, extension.after);

      // Crossfade regions: overlap model uses overlapFadeIn/Out, old extension model uses before/after
      const crossfadeIn = extension.overlapFadeIn > 0
        ? extension.overlapFadeIn
        : (before > 0 ? before : undefined);
      const crossfadeOut = extension.overlapFadeOut > 0
        ? extension.overlapFadeOut
        : (after > 0 ? after : undefined);

      expandedSegments.push({
        key: `video-audio-${item.id}`,
        itemId: item.id,
        mediaId: item.mediaId,
        clip: item,
        src: item.src,
        from: item.from - before,
        durationInFrames: item.durationInFrames + before + after,
        // Convert `before` (timeline frames) to source frames for subtraction
        trimBefore: baseTrimBefore - timelineToSourceFrames(before, playbackRate, fps, itemSourceFps),
        playbackRate,
        sourceFps: item.sourceFps,
        volumeDb: item.volume ?? 0,
        muted: item.muted || !item.trackVisible,
        audioFadeIn: crossfadeIn === undefined ? (item.audioFadeIn ?? 0) : 0,
        audioFadeOut: crossfadeOut === undefined ? (item.audioFadeOut ?? 0) : 0,
        crossfadeFadeIn: crossfadeIn,
        crossfadeFadeOut: crossfadeOut,
        beforeFrames: before,
        afterFrames: after,
      });
    }

    const sortedSegments = expandedSegments.toSorted((a, b) => {
      if (a.from !== b.from) return a.from - b.from;
      return a.key.localeCompare(b.key);
    });

    // Split clips can be fully continuous in source audio. Merge those boundaries
    // into one stable segment to avoid handoff re-sync clicks/pauses between items.
    const canMergeContinuousBoundary = (
      left: ExpandedVideoAudioSegment,
      right: ExpandedVideoAudioSegment
    ): boolean => {
      if (!isContinuousAudioTransition(left.clip, right.clip, fps)) return false;
      if (left.src !== right.src) return false;
      if (Math.abs(left.playbackRate - right.playbackRate) > 0.0001) return false;
      if (Math.abs(left.volumeDb - right.volumeDb) > 0.0001) return false;
      if (left.muted !== right.muted) return false;
      if (left.afterFrames !== 0 || right.beforeFrames !== 0) return false;

      return true;
    };

    const mergedSegments: VideoAudioSegment[] = [];
    let active: ExpandedVideoAudioSegment | null = null;

    const toPublicSegment = (segment: ExpandedVideoAudioSegment): VideoAudioSegment => ({
      key: segment.key,
      itemId: segment.itemId,
      mediaId: segment.mediaId,
      src: segment.src,
      from: segment.from,
      durationInFrames: segment.durationInFrames,
      trimBefore: segment.trimBefore,
      playbackRate: segment.playbackRate,
      sourceFps: segment.sourceFps,
      volumeDb: segment.volumeDb,
      muted: segment.muted,
      audioFadeIn: segment.audioFadeIn,
      audioFadeOut: segment.audioFadeOut,
      crossfadeFadeIn: segment.crossfadeFadeIn,
      crossfadeFadeOut: segment.crossfadeFadeOut,
    });

    for (const segment of sortedSegments) {
      if (!active) {
        active = { ...segment };
        continue;
      }

      if (canMergeContinuousBoundary(active, segment)) {
        const mergedEnd = segment.from + segment.durationInFrames;
        active.durationInFrames = mergedEnd - active.from;
        active.audioFadeOut = segment.audioFadeOut;
        active.crossfadeFadeOut = segment.crossfadeFadeOut;
        active.clip = segment.clip;
        active.afterFrames = segment.afterFrames;
        continue;
      }

      mergedSegments.push(toPublicSegment(active));
      active = { ...segment };
    }

    if (active) {
      mergedSegments.push(toPublicSegment(active));
    }

    return mergedSegments;
  }, [videoAudioItems, transitions, fps]);

  // Look up which video audio segments need custom decoding (AC-3/E-AC-3)
  const mediaItems = useMediaLibraryStore((s) => s.mediaItems);
  const mediaById = useMemo(() => {
    const map = new Map<string, (typeof mediaItems)[number]>();
    for (const media of mediaItems) {
      map.set(media.id, media);
    }
    return map;
  }, [mediaItems]);

  const shouldUseCustomDecoder = useCallback((segment: VideoAudioSegment | AudioSegment): boolean => {
    if (!segment.mediaId) {
      // Legacy clips without media linkage: safest fallback is custom decode.
      return true;
    }

    const media = mediaById.get(segment.mediaId);
    if (!media) {
      // Orphaned media metadata; native audio path can be silent for AC-3/E-AC-3.
      return true;
    }

    // Video assets usually expose audio codec in media.audioCodec.
    // Audio-only assets persist their codec in media.codec.
    return needsCustomAudioDecoder(media.audioCodec ?? media.codec);
  }, [mediaById]);

  // Active masks: shapes with isMask: true
  const activeMasks: MaskWithTrackOrder[] = useMemo(() => {
    const masks: MaskWithTrackOrder[] = [];
    visibleTracks.forEach((track) => {
      track.items.forEach((item) => {
        if (item.type === 'shape' && item.isMask) {
          masks.push({ mask: item, trackOrder: track.order ?? 0 });
        }
      });
    });
    return masks;
  }, [visibleTracks]);

  // Collect adjustment layers from VISIBLE tracks (for effect application)
  // Effects from hidden tracks should not be applied
  const visibleAdjustmentLayers: AdjustmentLayerWithTrackOrder[] = useMemo(() => {
    const layers: AdjustmentLayerWithTrackOrder[] = [];
    visibleTracks.forEach((track) => {
      track.items.forEach((item) => {
        if (item.type === 'adjustment') {
          layers.push({ layer: item as AdjustmentItem, trackOrder: track.order ?? 0 });
        }
      });
    });
    return layers;
  }, [visibleTracks]);

  // Use ALL tracks for stable DOM structure, with visibility flag for CSS-based hiding
  const nonMediaByTrack = useMemo(() =>
    tracks.map((track) => ({
      ...track,
      trackVisible: visibleTrackIds.has(track.id),
      items: track.items.filter((item) => {
        // Filter out videos (rendered by StableVideoSequence)
        if (item.type === 'video') return false;
        // Filter out audio (rendered separately)
        if (item.type === 'audio') return false;
        // Filter out mask shapes (rendered in SVG defs)
        if (item.type === 'shape' && item.isMask) return false;
        // Filter out adjustment items (handled separately)
        if (item.type === 'adjustment') return false;
        return true;
      }),
    })),
    [tracks, visibleTrackIds]
  );

  // NOTE: DOM structure is now fully stable regardless of adjustment layer changes.
  // Previously, items would split between above/below adjustment groups â†’ remounts.
  // Now ALL items stay in the same DOM location with per-item effect application
  // via ItemEffectWrapper. This prevents remounts when adjustment layers are added/removed.

  useMemo(() => {
    const textItems = visibleTracks
      .flatMap((track) => track.items)
      .filter((item): item is TextItem => item.type === 'text');
    const fontFamilies = textItems
      .map((item) => item.fontFamily ?? 'Inter')
      .filter((font, index, arr) => arr.indexOf(font) === index);
    if (fontFamilies.length > 0) loadFonts(fontFamilies);
  }, [visibleTracks]);


  // Stable render function for video items - prevents re-renders on every frame
  // useCallback ensures the function reference stays stable between renders
  // Uses CSS visibility for hidden tracks to avoid DOM changes
  // Now uses ItemEffectWrapper for per-item adjustment effects (no DOM restructuring)
  const renderVideoItem = useCallback((item: StableVideoSequenceItem) => {
    // Calculate the parent Sequence's `from` value for local-to-global frame conversion
    // For shared Sequences (split clips), _sequenceFrameOffset is the offset from group.minFrom to item.from
    // sequenceFrom = item.from - offset = group.minFrom
    const sequenceFrom = item.from - (item._sequenceFrameOffset ?? 0);
    return (
      <AbsoluteFill
        style={{
          zIndex: item.zIndex,
          // Use visibility: hidden for invisible tracks - keeps DOM stable, no re-render
          visibility: item.trackVisible ? 'visible' : 'hidden',
          // GPU layer hints to prevent compositing flicker during transitions
          transform: 'translateZ(0)',
          backfaceVisibility: 'hidden',
        }}
      >
        <ItemEffectWrapper
          itemTrackOrder={item.trackOrder}
          adjustmentLayers={visibleAdjustmentLayers}
          sequenceFrom={sequenceFrom}
        >
          <MaskedItem item={item} muted={true} shapeMasks={activeMasks} canvasWidth={canvasWidth} canvasHeight={canvasHeight} fps={fps} />
        </ItemEffectWrapper>
      </AbsoluteFill>
    );
  }, [visibleAdjustmentLayers, activeMasks, canvasWidth, canvasHeight, fps]);

  return (
    <KeyframesProvider keyframes={keyframes}>
      <CompositionSpaceProvider
        projectWidth={projectWidth}
        projectHeight={projectHeight}
        renderWidth={renderWidth}
        renderHeight={renderHeight}
      >
        <AbsoluteFill>
          {/* SVG MASK DEFINITIONS - kept for backward compat with feather/invert that need SVG mask */}
          {/* Shape mask animation is now handled per-item via ActiveMasksProvider + MaskedItem */}

          {/* BACKGROUND LAYER */}
          <AbsoluteFill style={{ backgroundColor: effectiveBackgroundColor, zIndex: -1 }} />

          {/* AUDIO LAYER - rendered outside visual layers to prevent re-renders from mask/visual changes */}
          {/* Video audio is decoupled from visual video elements for transition stability */}
          {/* Custom-decoded segments (AC-3/E-AC-3, PCM endian variants) use mediabunny instead of native <audio>. */}
          {videoAudioSegments.map((segment) => {
            const useCustomDecoder = shouldUseCustomDecoder(segment);
            const decodeMediaId = segment.mediaId ?? `legacy-src:${segment.src}`;
            return (
              <Sequence
                key={segment.key}
                from={segment.from}
                durationInFrames={segment.durationInFrames}
                premountFor={Math.round(fps * 2)}
              >
                {useCustomDecoder ? (
                  <CustomDecoderAudio
                    src={segment.src}
                    mediaId={decodeMediaId}
                    itemId={segment.itemId}
                    trimBefore={segment.trimBefore}
                    sourceFps={segment.sourceFps}
                    volume={segment.volumeDb}
                    playbackRate={segment.playbackRate}
                    muted={segment.muted}
                    durationInFrames={segment.durationInFrames}
                    audioFadeIn={segment.audioFadeIn}
                    audioFadeOut={segment.audioFadeOut}
                    crossfadeFadeIn={segment.crossfadeFadeIn}
                    crossfadeFadeOut={segment.crossfadeFadeOut}
                  />
                ) : (
                  <PitchCorrectedAudio
                    src={segment.src}
                    itemId={segment.itemId}
                    trimBefore={segment.trimBefore}
                    sourceFps={segment.sourceFps}
                    volume={segment.volumeDb}
                    playbackRate={segment.playbackRate}
                    muted={segment.muted}
                    durationInFrames={segment.durationInFrames}
                    audioFadeIn={segment.audioFadeIn}
                    audioFadeOut={segment.audioFadeOut}
                    crossfadeFadeIn={segment.crossfadeFadeIn}
                    crossfadeFadeOut={segment.crossfadeFadeOut}
                  />
                )}
              </Sequence>
            );
          })}

          {/* Standalone audio items - merged across split boundaries for stable playback */}
          {audioSegments.map((segment) => {
            const useCustomDecoder = shouldUseCustomDecoder(segment);
            const decodeMediaId = segment.mediaId ?? `legacy-src:${segment.src}`;
            return (
              <Sequence
                key={segment.key}
                from={segment.from}
                durationInFrames={segment.durationInFrames}
                premountFor={Math.round(fps * 2)}
              >
                {useCustomDecoder ? (
                  <CustomDecoderAudio
                    src={segment.src}
                    mediaId={decodeMediaId}
                    itemId={segment.itemId}
                    trimBefore={segment.trimBefore}
                    sourceFps={segment.sourceFps}
                    volume={segment.volumeDb}
                    playbackRate={segment.playbackRate}
                    muted={segment.muted}
                    durationInFrames={segment.durationInFrames}
                    audioFadeIn={segment.audioFadeIn}
                    audioFadeOut={segment.audioFadeOut}
                  />
                ) : (
                  <PitchCorrectedAudio
                    src={segment.src}
                    itemId={segment.itemId}
                    trimBefore={segment.trimBefore}
                    sourceFps={segment.sourceFps}
                    volume={segment.volumeDb}
                    playbackRate={segment.playbackRate}
                    muted={segment.muted}
                    durationInFrames={segment.durationInFrames}
                    audioFadeIn={segment.audioFadeIn}
                    audioFadeOut={segment.audioFadeOut}
                  />
                )}
              </Sequence>
            );
          })}

          {/* ALL VISUAL LAYERS - videos and non-media in SINGLE wrapper for proper z-index stacking */}
          {/* This ensures items from different tracks respect z-index across all types */}
          <AbsoluteFill>
            {/* VIDEO LAYER - all videos rendered via StableVideoSequence */}
            {/* ALL effects (CSS, glitch, halftone) applied per-item via ItemEffectWrapper */}
            <StableVideoSequence
              items={videoItems}
              premountFor={Math.round(fps * 1)}
              renderItem={renderVideoItem}
            />

            {/* NON-MEDIA LAYERS - text, shapes, etc. with per-item effects via ItemEffectWrapper */}
            {/* No more above/below split - items never move between DOM parents */}
            {nonMediaByTrack
              .filter((track) => track.items.length > 0)
              .map((track) => {
                const trackOrder = track.order ?? 0;
                return (
                  <AbsoluteFill
                    key={track.id}
                    style={{
                      // Non-media z-index: base + 100 (videos use base, transitions use base + 200)
                      zIndex: (maxOrder - trackOrder) * 1000 + 100,
                      visibility: track.trackVisible ? 'visible' : 'hidden',
                    }}
                  >
                    {track.items.map((item) => (
                      <Sequence key={item.id} from={item.from} durationInFrames={item.durationInFrames}>
                        <ItemEffectWrapper
                          itemTrackOrder={trackOrder}
                          adjustmentLayers={visibleAdjustmentLayers}
                          sequenceFrom={item.from}
                        >
                          <MaskedItem item={item} muted={track.muted || !track.trackVisible} shapeMasks={activeMasks} canvasWidth={canvasWidth} canvasHeight={canvasHeight} fps={fps} />
                        </ItemEffectWrapper>
                      </Sequence>
                    ))}
                  </AbsoluteFill>
                );
              })}
          </AbsoluteFill>
        </AbsoluteFill>
      </CompositionSpaceProvider>
    </KeyframesProvider>
  );
};

