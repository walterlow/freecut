import React, { useMemo, useCallback } from 'react';
import { AbsoluteFill, Sequence } from '@/features/player/composition';
import { useCurrentFrame, useVideoConfig } from '../hooks/use-player-compat';
import type { CompositionInputProps } from '@/types/export';
import type { TextItem, ShapeItem, AdjustmentItem, VideoItem, AudioItem, ImageItem } from '@/types/timeline';
import { Item } from '../components/item';
import { PitchCorrectedAudio } from '../components/pitch-corrected-audio';
import { CustomDecoderAudio } from '../components/custom-decoder-audio';
import { OptimizedEffectsBasedTransitionsLayer } from '../components/transition-renderer';
import { useMediaLibraryStore } from '@/features/media-library/stores/media-library-store';
import { needsCustomAudioDecoder } from '../utils/audio-codec-detection';
import { timelineToSourceFrames, sourceToTimelineFrames } from '@/features/timeline/utils/source-calculations';
import { StableVideoSequence, type StableVideoSequenceItem } from '../components/stable-video-sequence';
import { loadFonts } from '../utils/fonts';
import { resolveTransform } from '../utils/transform-resolver';
import { getShapePath, rotatePath } from '../utils/shape-path';
import { resolveTransitionWindows } from '@/lib/transitions/transition-planner';
import { useGizmoStore } from '@/features/preview/stores/gizmo-store';
import { ItemEffectWrapper, type AdjustmentLayerWithTrackOrder } from '../components/item-effect-wrapper';
import { KeyframesProvider } from '../contexts/keyframes-context';

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

/** Props for MaskDefinitions component */
interface MaskDefinitionsProps {
  masks: MaskWithTrackOrder[];
  hasPotentialMasks: boolean;
  currentFrame: number;
  canvasWidth: number;
  canvasHeight: number;
  fps: number;
}

/**
 * SVG Mask Definitions Component
 *
 * Renders SVG mask definitions with OPACITY-CONTROLLED activation.
 * The mask is always present in the DOM; its effect is toggled via internal opacity.
 * This prevents DOM structure changes when masks activate/deactivate.
 *
 * IMPORTANT: When hasPotentialMasks is true but masks is empty, we render an
 * "empty" mask (just the base white rect) that shows everything. This ensures
 * the mask reference is always valid when StableMaskedGroup applies it.
 *
 * Memoized to prevent re-renders when props haven't changed.
 */
const MaskDefinitions = React.memo<MaskDefinitionsProps>(({ masks, hasPotentialMasks, currentFrame, canvasWidth, canvasHeight, fps }) => {
  const canvas = { width: canvasWidth, height: canvasHeight, fps };

  // Read gizmo store for real-time mask preview during drag operations
  const activeGizmo = useGizmoStore((s) => s.activeGizmo);
  const previewTransform = useGizmoStore((s) => s.previewTransform);
  // Read unified preview for all masks at once (more efficient than per-mask selectors)
  const preview = useGizmoStore((s) => s.preview);

  // Only render if there are potential masks (shapes that could be masks)
  // This keeps DOM structure stable when isMask is toggled
  if (!hasPotentialMasks) return null;

  // Generate combined mask ID for the group
  const groupMaskId = 'group-composition-mask';

  // Handle empty active masks case - render SVG with just base white rect
  // This ensures mask reference is valid when StableMaskedGroup applies it
  if (masks.length === 0) {
    return (
      <svg
        style={{
          position: 'absolute',
          width: 0,
          height: 0,
          overflow: 'hidden',
          pointerEvents: 'none',
        }}
        aria-hidden="true"
      >
        <defs>
          <mask
            id={groupMaskId}
            maskUnits="userSpaceOnUse"
            x="0"
            y="0"
            width={canvasWidth}
            height={canvasHeight}
          >
            {/* No active masks - show everything (white = visible) */}
            <rect
              x="0"
              y="0"
              width={canvasWidth}
              height={canvasHeight}
              fill="white"
            />
          </mask>
        </defs>
      </svg>
    );
  }

  // Compute mask data with opacity for activation
  const maskData = masks.map(({ mask, trackOrder }) => {
    const maskStart = mask.from;
    const maskEnd = mask.from + mask.durationInFrames;

    // Binary opacity: 1 when active, 0 when inactive
    const isActive = currentFrame >= maskStart && currentFrame < maskEnd;
    const opacity = isActive ? 1 : 0;

    // Check for active preview transforms from unified preview system
    const maskPreview = preview?.[mask.id];
    const unifiedPreviewTransform = maskPreview?.transform;
    const isGizmoPreviewActive = activeGizmo?.itemId === mask.id && previewTransform !== null;

    // Get base transform
    const baseResolved = resolveTransform(mask, canvas);

    // Priority: Unified preview (group/properties) > Single gizmo preview > Base
    let resolvedTransform = {
      x: baseResolved.x,
      y: baseResolved.y,
      width: baseResolved.width,
      height: baseResolved.height,
      rotation: baseResolved.rotation,
      opacity: baseResolved.opacity,
    };

    if (unifiedPreviewTransform) {
      // Unified preview includes both group transforms and properties panel transforms
      resolvedTransform = { ...resolvedTransform, ...unifiedPreviewTransform };
    } else if (isGizmoPreviewActive && previewTransform) {
      resolvedTransform = { ...previewTransform };
    }

    // Generate mask path
    let path = getShapePath(mask, resolvedTransform, { canvasWidth, canvasHeight });

    // Bake rotation into path
    if (resolvedTransform.rotation !== 0) {
      const centerX = canvasWidth / 2 + resolvedTransform.x;
      const centerY = canvasHeight / 2 + resolvedTransform.y;
      path = rotatePath(path, resolvedTransform.rotation, centerX, centerY);
    }

    return {
      mask,
      trackOrder,
      opacity,
      path,
      id: `composition-mask-${mask.id}`,
      strokeWidth: mask.strokeWidth ?? 0,
    };
  });

  // Compute per-mask feather values (only for alpha type, clip type = hard edges)
  // Uses unified preview for real-time slider updates
  const maskFeatherValues = masks.map(({ mask }) => {
    const maskPreview = preview?.[mask.id];
    const type = mask.maskType ?? 'clip';
    const feather = maskPreview?.properties?.maskFeather ?? mask.maskFeather ?? 0;
    return type === 'alpha' ? feather : 0;
  });

  return (
    <svg
      style={{
        position: 'absolute',
        width: 0,
        height: 0,
        overflow: 'hidden',
        pointerEvents: 'none',
      }}
      aria-hidden="true"
    >
      <defs>
        {/* Render individual blur filters for each mask that needs feathering */}
        {masks.map(({ mask }, index) => {
          const feather = maskFeatherValues[index]!;
          if (feather <= 0) return null;
          return (
            <filter
              key={`filter-${mask.id}`}
              id={`blur-mask-${mask.id}`}
              x="-50%"
              y="-50%"
              width="200%"
              height="200%"
            >
              <feGaussianBlur stdDeviation={feather} />
            </filter>
          );
        })}
        <mask
          id={groupMaskId}
          maskUnits="userSpaceOnUse"
          x="0"
          y="0"
          width={canvasWidth}
          height={canvasHeight}
        >
          {/* Base: When ALL masks are inactive, show everything (white = visible) */}
          {/* When ANY mask is active, this gets covered by the mask shapes */}
          <rect
            x="0"
            y="0"
            width={canvasWidth}
            height={canvasHeight}
            fill="white"
          />

          {/* For each mask: when active (opacity=1), apply the mask effect */}
          {maskData.map(({ id, path, opacity, strokeWidth, mask: shapeItem }, index) => {
            const itemMaskInvert = shapeItem.maskInvert ?? false;
            // Per-mask feather: only apply for alpha type (soft edges)
            const itemMaskFeather = maskFeatherValues[index]!;

            // When mask is active (opacity=1):
            // - Draw black rect to hide everything
            // - Draw white path to reveal the mask shape
            // When mask is inactive (opacity=0): nothing is drawn, base white rect shows
            return (
              <g key={id} style={{ opacity }}>
                {/* Hide everything first */}
                <rect
                  x="0"
                  y="0"
                  width={canvasWidth}
                  height={canvasHeight}
                  fill={itemMaskInvert ? 'white' : 'black'}
                />
                {/* Reveal the mask shape */}
                <path
                  d={path}
                  fill={itemMaskInvert ? 'black' : 'white'}
                  stroke={strokeWidth > 0 ? (itemMaskInvert ? 'black' : 'white') : undefined}
                  strokeWidth={strokeWidth > 0 ? strokeWidth : undefined}
                  filter={itemMaskFeather > 0 ? `url(#blur-mask-${shapeItem.id})` : undefined}
                />
              </g>
            );
          })}
        </mask>
      </defs>
    </svg>
  );
});

/**
 * Frame-aware wrapper for MaskDefinitions.
 * Isolates useCurrentFrame() to this component so that MainComposition
 * doesn't re-render on every frame. Only this component and its children
 * will re-render per frame.
 */
const FrameAwareMaskDefinitions: React.FC<{
  masks: MaskWithTrackOrder[];
  hasPotentialMasks: boolean;
  canvasWidth: number;
  canvasHeight: number;
  fps: number;
}> = (props) => {
  const currentFrame = useCurrentFrame();
  return <MaskDefinitions {...props} currentFrame={currentFrame} />;
};

// ClearingLayer removed - was causing flicker at clip boundaries
// Background layer at z-index -1 is sufficient for showing background color

/**
 * Stable wrapper that applies CSS mask reference.
 * ALWAYS renders the same div structure - mask effect controlled by SVG opacity.
 */
const StableMaskedGroup: React.FC<{
  children: React.ReactNode;
  hasMasks: boolean;
}> = ({ children, hasMasks }) => {
  // Always apply the mask reference - the SVG mask handles activation via opacity
  // When no masks are active, the SVG mask shows everything (base white rect)
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        mask: hasMasks ? 'url(#group-composition-mask)' : undefined,
        WebkitMask: hasMasks ? 'url(#group-composition-mask)' : undefined,
      }}
    >
      {children}
    </div>
  );
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
 * 4. Deleting/adding masks doesn't move items between DOM parents → no remount
 *
 * ADJUSTMENT LAYER EFFECTS:
 * 1. ALL effects (CSS filter, glitch, halftone) applied PER-ITEM via ItemEffectWrapper
 * 2. Each item checks if it should have effects based on track order
 * 3. Only items BELOW adjustment layer (higher track order) receive effects
 * 4. Adding/removing adjustment layers doesn't change DOM structure
 */
export const MainComposition: React.FC<CompositionInputProps> = ({ tracks, transitions = [], backgroundColor = '#000000', keyframes }) => {
  const { fps, width: canvasWidth, height: canvasHeight } = useVideoConfig();
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
  const itemsById = useMemo(() => {
    const map = new Map<string, typeof allVisualItems[number]>();
    for (const item of allVisualItems) {
      map.set(item.id, item);
    }
    return map;
  }, [allVisualItems]);

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
  // Previously, items would split between above/below adjustment groups → remounts.
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

  // hasActiveMasks: shapes with isMask: true (for actual mask rendering)
  const hasActiveMasks = activeMasks.length > 0;

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
          <Item item={item} muted={true} masks={[]} />
        </ItemEffectWrapper>
      </AbsoluteFill>
    );
  }, [visibleAdjustmentLayers]);

  return (
    <KeyframesProvider keyframes={keyframes}>
      <AbsoluteFill>
        {/* SVG MASK DEFINITIONS - opacity controls activation, no DOM changes */}
        {/* Uses FrameAwareMaskDefinitions to isolate per-frame re-renders */}
        <FrameAwareMaskDefinitions
          masks={activeMasks}
          hasPotentialMasks={hasActiveMasks}
          canvasWidth={canvasWidth}
          canvasHeight={canvasHeight}
          fps={fps}
        />

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
        <StableMaskedGroup hasMasks={hasActiveMasks}>
          {/* VIDEO LAYER - all videos rendered via StableVideoSequence */}
          {/* ALL effects (CSS, glitch, halftone) applied per-item via ItemEffectWrapper */}
          <StableVideoSequence
            items={videoItems}
            premountFor={Math.round(fps * 1)}
            renderItem={renderVideoItem}
          />

          {/* Effects-based transitions - visual effect centered on cut point */}
          {/* These render ABOVE the normal clips during the transition window */}
          <OptimizedEffectsBasedTransitionsLayer
            transitions={transitions}
            itemsById={itemsById}
            adjustmentLayers={visibleAdjustmentLayers}
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
                        <Item item={item} muted={track.muted || !track.trackVisible} masks={[]} />
                      </ItemEffectWrapper>
                    </Sequence>
                  ))}
                </AbsoluteFill>
              );
            })}
        </StableMaskedGroup>
      </AbsoluteFill>
    </KeyframesProvider>
  );
};
