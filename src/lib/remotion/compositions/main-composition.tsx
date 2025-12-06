import React, { useMemo, useCallback } from 'react';
import { AbsoluteFill, Sequence, useVideoConfig, useCurrentFrame } from 'remotion';
import { TransitionSeries, linearTiming, springTiming } from '@remotion/transitions';
import { fade } from '@remotion/transitions/fade';
import { wipe } from '@remotion/transitions/wipe';
import { slide } from '@remotion/transitions/slide';
import { flip } from '@remotion/transitions/flip';
import { clockWipe } from '@remotion/transitions/clock-wipe';
import { none } from '@remotion/transitions/none';
import { iris } from '@remotion/transitions/iris';
import type { RemotionInputProps } from '@/types/export';
import type { TextItem, ShapeItem, AdjustmentItem, VideoItem, ImageItem } from '@/types/timeline';
import type { Transition, TransitionPresentation, TransitionTiming, WipeDirection, SlideDirection, FlipDirection } from '@/types/transition';
import { Item } from '../components/item';
import { PitchCorrectedAudio } from '../components/pitch-corrected-audio';
import { StableVideoSequence } from '../components/stable-video-sequence';
import { loadFonts } from '../utils/fonts';
import { resolveTransform } from '../utils/transform-resolver';
import { getShapePath, rotatePath } from '../utils/shape-path';
import { useGizmoStore } from '@/features/preview/stores/gizmo-store';
import { ItemEffectWrapper, type AdjustmentLayerWithTrackOrder } from '../components/item-effect-wrapper';
// Note: Halftone is now applied per-item via ItemEffectWrapper, not globally.
// This ensures adjustment layer effects only affect items BELOW them (higher track order).

/**
 * Get Remotion transition presentation from our presentation type
 * eslint-disable-next-line @typescript-eslint/no-explicit-any
 */
function getTransitionPresentation(
  presentation: TransitionPresentation,
  width: number,
  height: number,
  direction?: WipeDirection | SlideDirection | FlipDirection
): any {
  switch (presentation) {
    case 'fade': return fade();
    case 'wipe': return wipe({ direction: direction as WipeDirection ?? 'from-left' });
    case 'slide': return slide({ direction: direction as SlideDirection ?? 'from-left' });
    case 'flip': return flip({ direction: direction as FlipDirection ?? 'from-left' });
    case 'clockWipe': return clockWipe({ width, height });
    case 'iris': return iris({ width, height });
    case 'none': return none();
    default: return fade();
  }
}

/**
 * Get Remotion transition timing from our timing type
 */
function getTransitionTiming(timing: TransitionTiming, durationInFrames: number) {
  switch (timing) {
    case 'spring': return springTiming({ config: { damping: 200 }, durationInFrames });
    case 'linear':
    default: return linearTiming({ durationInFrames });
  }
}

/**
 * A visual item (video/image) with track rendering metadata
 */
type EnrichedVisualItem = (VideoItem | ImageItem) & {
  zIndex: number;
  muted: boolean;
  trackOrder: number;
  trackVisible: boolean;
};

/**
 * A chain of clips connected by transitions on the same track.
 * Used to render with TransitionSeries.
 */
interface ClipChain {
  clips: EnrichedVisualItem[];
  transitions: Transition[];
  trackId: string;
  /** Start frame of the chain (first clip's from) */
  startFrame: number;
  /** End frame in timeline (last clip's from + duration) */
  endFrame: number;
  /** Total overlap/compression from all transitions */
  totalOverlap: number;
  /** Rendered duration (total clip durations - total overlap) */
  renderedDuration: number;
}

/**
 * Group clips into chains connected by transitions.
 * Returns: { chains: ClipChain[], standaloneClips: EnrichedVisualItem[] }
 */
function groupClipsIntoChains(
  items: EnrichedVisualItem[],
  transitions: Transition[]
): { chains: ClipChain[]; standaloneClips: EnrichedVisualItem[] } {
  // Build adjacency map: clipId -> { left: Transition, right: Transition }
  const transitionMap = new Map<string, { left?: Transition; right?: Transition }>();

  transitions.forEach((t) => {
    if (!transitionMap.has(t.leftClipId)) transitionMap.set(t.leftClipId, {});
    if (!transitionMap.has(t.rightClipId)) transitionMap.set(t.rightClipId, {});
    transitionMap.get(t.leftClipId)!.right = t;
    transitionMap.get(t.rightClipId)!.left = t;
  });

  const visitedClips = new Set<string>();
  const chains: ClipChain[] = [];
  const standaloneClips: EnrichedVisualItem[] = [];

  // Sort items by track and position for consistent processing
  const sortedItems = [...items].sort((a, b) => {
    if (a.trackId !== b.trackId) return a.trackId.localeCompare(b.trackId);
    return a.from - b.from;
  });

  for (const item of sortedItems) {
    if (visitedClips.has(item.id)) continue;

    const clipTransitions = transitionMap.get(item.id);

    // If this clip has no transitions, it's standalone
    if (!clipTransitions?.left && !clipTransitions?.right) {
      standaloneClips.push(item);
      visitedClips.add(item.id);
      continue;
    }

    // Start a new chain from this clip
    // First, walk left to find the chain start
    let chainStart = item;
    while (true) {
      const leftTrans = transitionMap.get(chainStart.id)?.left;
      if (!leftTrans) break;
      const leftClip = sortedItems.find((i) => i.id === leftTrans.leftClipId);
      if (!leftClip || visitedClips.has(leftClip.id)) break;
      chainStart = leftClip;
    }

    // Now walk right to build the chain
    const chainClips: EnrichedVisualItem[] = [];
    const chainTransitions: Transition[] = [];
    let current = chainStart;

    while (current && !visitedClips.has(current.id)) {
      chainClips.push(current);
      visitedClips.add(current.id);

      const rightTrans = transitionMap.get(current.id)?.right;
      if (!rightTrans) break;

      chainTransitions.push(rightTrans);
      const nextClip = sortedItems.find((i) => i.id === rightTrans.rightClipId);
      if (!nextClip || visitedClips.has(nextClip.id)) break;
      current = nextClip;
    }

    if (chainClips.length > 1) {
      const lastClip = chainClips[chainClips.length - 1]!;
      const totalClipDuration = chainClips.reduce((sum, c) => sum + c.durationInFrames, 0);
      const totalOverlap = chainTransitions.reduce((sum, t) => sum + t.durationInFrames, 0);

      chains.push({
        clips: chainClips,
        transitions: chainTransitions,
        trackId: chainStart.trackId,
        startFrame: chainStart.from,
        endFrame: lastClip.from + lastClip.durationInFrames,
        totalOverlap,
        renderedDuration: totalClipDuration - totalOverlap,
      });
    } else {
      // Single clip with broken transition reference - treat as standalone
      standaloneClips.push(chainStart);
    }
  }

  return { chains, standaloneClips };
}

/** Mask shape with its track order for scope calculation */
interface MaskWithTrackOrder {
  mask: ShapeItem;
  trackOrder: number;
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
  const propertiesPreview = useGizmoStore((s) => s.propertiesPreview);
  const itemPropertiesPreview = useGizmoStore((s) => s.itemPropertiesPreview);
  const groupPreviewTransforms = useGizmoStore((s) => s.groupPreviewTransforms);

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

    // Check for active preview transforms
    const groupPreviewForMask = groupPreviewTransforms?.get(mask.id);
    const isGizmoPreviewActive = activeGizmo?.itemId === mask.id && previewTransform !== null;
    const propertiesPreviewForMask = propertiesPreview?.[mask.id];

    // Get base transform
    const baseResolved = resolveTransform(mask, canvas);

    // Priority: Group preview > Single gizmo preview > Properties preview > Base
    let resolvedTransform = {
      x: baseResolved.x,
      y: baseResolved.y,
      width: baseResolved.width,
      height: baseResolved.height,
      rotation: baseResolved.rotation,
      opacity: baseResolved.opacity,
    };

    if (groupPreviewForMask) {
      resolvedTransform = { ...groupPreviewForMask };
    } else if (isGizmoPreviewActive && previewTransform) {
      resolvedTransform = { ...previewTransform };
    } else if (propertiesPreviewForMask) {
      resolvedTransform = { ...resolvedTransform, ...propertiesPreviewForMask };
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
  // Uses itemPropertiesPreview for real-time slider updates
  const maskFeatherValues = masks.map(({ mask }) => {
    const preview = itemPropertiesPreview?.[mask.id];
    const type = mask.maskType ?? 'clip';
    const feather = preview?.maskFeather ?? mask.maskFeather ?? 0;
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

/**
 * Clearing Layer Component
 *
 * Renders a background fill when no video is currently active.
 * Uses its own useCurrentFrame() hook to isolate per-frame re-renders
 * from the parent MainComposition.
 */
const ClearingLayer: React.FC<{
  videoItems: EnrichedVisualItem[];
  chains: ClipChain[];
  backgroundColor: string;
}> = ({ videoItems, chains, backgroundColor }) => {
  const currentFrame = useCurrentFrame();

  // Check standalone videos
  const hasActiveStandaloneVideo = videoItems.some(
    (item) =>
      item.trackVisible &&
      currentFrame >= item.from &&
      currentFrame < item.from + item.durationInFrames
  );

  // Check clips in transition chains
  // A chain is active if the current frame is within any of its clips' range
  // Note: TransitionSeries handles overlaps, but the visual range is from first clip start to last clip end
  const hasActiveChainClip = chains.some((chain) => {
    if (!chain.clips[0]?.trackVisible) return false;
    const chainStart = chain.startFrame;
    // Calculate chain end: sum of all clip durations minus transition overlaps
    const totalTransitionDuration = chain.transitions.reduce((sum, t) => sum + t.durationInFrames, 0);
    const totalClipDuration = chain.clips.reduce((sum, c) => sum + c.durationInFrames, 0);
    const chainEnd = chainStart + totalClipDuration - totalTransitionDuration;
    return currentFrame >= chainStart && currentFrame < chainEnd;
  });

  if (hasActiveStandaloneVideo || hasActiveChainClip) return null;
  return <AbsoluteFill style={{ backgroundColor, zIndex: 1000 }} />;
};

/**
 * Audio renderer for clips in transition chains.
 * Handles crossfade between clips during transition overlaps.
 * This is separate from TransitionSeries which only handles video.
 */
const ChainAudioRenderer: React.FC<{
  chains: ClipChain[];
  tracks: RemotionInputProps['tracks'];
  visibleTrackIds: Set<string>;
}> = ({ chains, tracks, visibleTrackIds }) => {
  // Render audio for each clip in each chain with crossfade
  return (
    <>
      {chains.map((chain) => {
        const track = tracks.find((t) => t.id === chain.trackId);
        const trackMuted = track?.muted ?? false;
        const trackVisible = visibleTrackIds.has(chain.trackId);

        // Calculate running position for each clip in the chain
        // Each clip starts at its own position, but transitions compress the chain
        let runningFrame = chain.startFrame;

        return chain.clips.map((clip, clipIndex) => {
          // Only render audio for video clips (images don't have audio)
          if (clip.type !== 'video') {
            runningFrame += clip.durationInFrames - (chain.transitions[clipIndex]?.durationInFrames ?? 0);
            return null;
          }

          const clipStart = runningFrame;

          // Get transition before and after this clip
          const transitionBefore = clipIndex > 0 ? chain.transitions[clipIndex - 1] : null;
          const transitionAfter = chain.transitions[clipIndex];

          // Calculate fade regions for crossfade
          const fadeInDuration = transitionBefore?.durationInFrames ?? 0;
          const fadeOutDuration = transitionAfter?.durationInFrames ?? 0;

          // Update running frame for next clip (account for transition overlap)
          runningFrame += clip.durationInFrames - (transitionAfter?.durationInFrames ?? 0);

          // Use Sequence for proper lifecycle and ChainClipAudio for crossfade
          return (
            <Sequence
              key={`chain-audio-${clip.id}`}
              from={clipStart}
              durationInFrames={clip.durationInFrames}
            >
              <ChainClipAudio
                clip={clip}
                fadeInDuration={fadeInDuration}
                fadeOutDuration={fadeOutDuration}
                muted={trackMuted || !trackVisible}
              />
            </Sequence>
          );
        });
      })}
    </>
  );
};

/**
 * Audio for a single clip in a chain with crossfade support.
 * Renders audio-only with volume interpolation for smooth transitions.
 */
const ChainClipAudio: React.FC<{
  clip: EnrichedVisualItem;
  fadeInDuration: number;
  fadeOutDuration: number;
  muted: boolean;
}> = ({ clip, fadeInDuration, fadeOutDuration, muted }) => {
  // Only video clips have audio
  if (clip.type !== 'video' || muted) return null;

  // Guard against missing src
  if (!('src' in clip) || !clip.src) return null;

  const videoClip = clip as VideoItem;

  // Get source position and playback rate
  const trimBefore = videoClip.sourceStart ?? videoClip.trimStart ?? videoClip.offset ?? 0;
  const playbackRate = videoClip.speed ?? 1;

  // Render audio with crossfade support via PitchCorrectedAudio
  return (
    <PitchCorrectedAudio
      src={videoClip.src}
      itemId={videoClip.id}
      trimBefore={trimBefore}
      volume={videoClip.volume ?? 0}
      playbackRate={playbackRate}
      muted={false}
      durationInFrames={videoClip.durationInFrames}
      audioFadeIn={videoClip.audioFadeIn}
      audioFadeOut={videoClip.audioFadeOut}
      // Crossfade overrides for transitions
      crossfadeFadeIn={fadeInDuration}
      crossfadeFadeOut={fadeOutDuration}
    />
  );
};

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
 * Main Remotion Composition
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
export const MainComposition: React.FC<RemotionInputProps> = ({ tracks, transitions = [], backgroundColor = '#000000' }) => {
  const { fps, width: canvasWidth, height: canvasHeight } = useVideoConfig();
  // NOTE: useCurrentFrame() removed from here to prevent per-frame re-renders.
  // Frame-dependent logic is now isolated in FrameAwareMaskDefinitions and ClearingLayer.
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

  // Get all video and image items that could be in transitions
  const allVisualItems: EnrichedVisualItem[] = useMemo(() =>
    tracks.flatMap((track) =>
      track.items
        .filter((item) => item.type === 'video' || item.type === 'image')
        .map((item) => ({
          ...item,
          zIndex: maxOrder - (track.order ?? 0),
          muted: track.muted ?? false,
          trackOrder: track.order ?? 0,
          trackVisible: visibleTrackIds.has(track.id),
        }))
    ) as EnrichedVisualItem[],
    [tracks, visibleTrackIds, maxOrder]
  );

  // Group clips into chains (connected by transitions) and standalone clips
  const { chains, standaloneClips } = useMemo(() =>
    groupClipsIntoChains(allVisualItems, transitions),
    [allVisualItems, transitions]
  );

  // Calculate render offset for a clip based on chains that come before it on the same track
  // Transitions "compress" time, so clips after chains need to shift earlier
  const getRenderOffset = useCallback((trackId: string, clipFrom: number): number => {
    let offset = 0;
    for (const chain of chains) {
      if (chain.trackId === trackId && chain.endFrame <= clipFrom) {
        // This chain ends before our clip starts, so its overlap affects our position
        offset += chain.totalOverlap;
      }
    }
    return offset;
  }, [chains]);

  // Standalone video items with adjusted render positions
  const videoItems = useMemo(() =>
    standaloneClips
      .filter((item) => item.type === 'video')
      .map((item) => ({
        ...item,
        // Adjust 'from' for rendering (shifted by chain overlaps before this clip)
        from: item.from - getRenderOffset(item.trackId, item.from),
      })),
    [standaloneClips, getRenderOffset]
  );

  // Standalone image items (not in any transition chain) - rendered in nonMediaByTrack
  const standaloneImageIds = useMemo(() =>
    new Set(standaloneClips.filter((item) => item.type === 'image').map((i) => i.id)),
    [standaloneClips]
  );

  // Audio items are memoized separately and rendered outside mask groups
  // This prevents audio from being affected by visual layer changes (mask add/delete, item moves)
  // Use ALL tracks for stable DOM structure, with trackVisible for conditional playback
  const audioItems = useMemo(() =>
    tracks.flatMap((track) =>
      track.items
        .filter((item) => item.type === 'audio')
        .map((item) => ({
          ...item,
          muted: track.muted,
          trackVisible: visibleTrackIds.has(track.id),
        }))
    ),
    [tracks, visibleTrackIds]
  );

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
  // Images in transition chains are rendered by TransitionSeries, not here
  const nonMediaByTrack = useMemo(() =>
    tracks.map((track) => ({
      ...track,
      trackVisible: visibleTrackIds.has(track.id),
      items: track.items.filter((item) => {
        // Filter out videos (rendered by StableVideoSequence or TransitionSeries)
        if (item.type === 'video') return false;
        // Filter out audio (rendered separately)
        if (item.type === 'audio') return false;
        // Filter out mask shapes (rendered in SVG defs)
        if (item.type === 'shape' && item.isMask) return false;
        // Filter out adjustment items (handled separately)
        if (item.type === 'adjustment') return false;
        // Filter out images that are in transition chains (rendered by TransitionSeries)
        if (item.type === 'image' && !standaloneImageIds.has(item.id)) return false;
        return true;
      }),
    })),
    [tracks, visibleTrackIds, standaloneImageIds]
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
  const renderVideoItem = useCallback((item: typeof videoItems[number] & { _sequenceFrameOffset?: number }) => {
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
        }}
      >
        <ItemEffectWrapper
          itemTrackOrder={item.trackOrder}
          adjustmentLayers={visibleAdjustmentLayers}
          sequenceFrom={sequenceFrom}
        >
          <Item item={item} muted={item.muted || !item.trackVisible} masks={[]} />
        </ItemEffectWrapper>
      </AbsoluteFill>
    );
  }, [visibleAdjustmentLayers]);

  return (
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
      <AbsoluteFill style={{ backgroundColor, zIndex: -1 }} />

      {/* AUDIO LAYER - rendered outside visual layers to prevent re-renders from mask/visual changes */}
      {/* Audio uses item.id as key (not generateStableKey) to prevent remounts on speed changes */}
      {/* Hidden tracks are muted but stay in DOM for stable structure */}
      {/* Items after transition chains on the same track are shifted earlier */}
      {audioItems.map((item) => {
        // Apply render offset for audio that comes after transition chains on the same track
        const renderOffset = getRenderOffset(item.trackId, item.from);
        const adjustedFrom = item.from - renderOffset;
        return (
          <Sequence
            key={item.id}
            from={adjustedFrom}
            durationInFrames={item.durationInFrames}
          >
            <Item item={item} muted={item.muted || !item.trackVisible} masks={[]} />
          </Sequence>
        );
      })}

      {/* CHAIN AUDIO LAYER - audio from video clips in transition chains with crossfade */}
      {/* Rendered separately from TransitionSeries (which handles video only) */}
      {chains.length > 0 && (
        <ChainAudioRenderer
          chains={chains}
          tracks={tracks}
          visibleTrackIds={visibleTrackIds}
        />
      )}

      {/* VIDEO LAYER - all videos in single StableVideoSequence for DOM stability */}
      {/* ALL effects (CSS, glitch, halftone) applied per-item via ItemEffectWrapper */}
      {/* Only items BELOW adjustment layer (higher track order) receive effects */}
      <StableMaskedGroup hasMasks={hasActiveMasks}>
        <StableVideoSequence
          items={videoItems as any}
          premountFor={Math.round(fps * 2)}
          renderItem={renderVideoItem as any}
        />
      </StableMaskedGroup>

      {/* TRANSITION CHAINS - render using Remotion TransitionSeries */}
      {/* Each chain is a sequence of clips connected by transitions */}
      {chains.length > 0 && (
        <StableMaskedGroup hasMasks={hasActiveMasks}>
          {chains.map((chain) => {
            const track = tracks.find((t) => t.id === chain.trackId);
            const trackVisible = visibleTrackIds.has(chain.trackId);
            const trackOrder = track?.order ?? 0;
            const zIndex = maxOrder - trackOrder;

            return (
              <Sequence
                key={`chain-${chain.clips[0]!.id}`}
                from={chain.startFrame}
              >
                <AbsoluteFill
                  style={{
                    zIndex,
                    visibility: trackVisible ? 'visible' : 'hidden',
                  }}
                >
                  <TransitionSeries>
                    {chain.clips.map((clip, index) => {
                      // Render the clip
                      const transition = chain.transitions[index]; // Transition AFTER this clip

                      return (
                        <React.Fragment key={clip.id}>
                          <TransitionSeries.Sequence durationInFrames={clip.durationInFrames}>
                            <ItemEffectWrapper
                              itemTrackOrder={trackOrder}
                              adjustmentLayers={visibleAdjustmentLayers}
                              sequenceFrom={clip.from}
                            >
                              <Item
                                item={clip}
                                muted={true} // Always mute in TransitionSeries - audio rendered separately with crossfade
                                masks={[]}
                              />
                            </ItemEffectWrapper>
                          </TransitionSeries.Sequence>

                          {/* Add transition after this clip (if not the last clip) */}
                          {transition && (
                            <TransitionSeries.Transition
                              timing={getTransitionTiming(transition.timing, transition.durationInFrames)}
                              presentation={getTransitionPresentation(transition.presentation, canvasWidth, canvasHeight, transition.direction)}
                            />
                          )}
                        </React.Fragment>
                      );
                    })}
                  </TransitionSeries>
                </AbsoluteFill>
              </Sequence>
            );
          })}
        </StableMaskedGroup>
      )}

      {/* CLEARING LAYER - uses its own useCurrentFrame() to isolate per-frame re-renders */}
      <ClearingLayer videoItems={videoItems} chains={chains} backgroundColor={backgroundColor} />

      {/* NON-MEDIA LAYERS - all in single structure, per-item effects via ItemEffectWrapper */}
      {/* No more above/below split - items never move between DOM parents */}
      {/* Items after transition chains are shifted earlier by chain overlap duration */}
      <StableMaskedGroup hasMasks={hasActiveMasks}>
        {nonMediaByTrack
          .filter((track) => track.items.length > 0)
          .map((track) => {
            const trackOrder = track.order ?? 0;
            return (
              <AbsoluteFill
                key={track.id}
                style={{
                  zIndex: 1001 + (maxOrder - trackOrder),
                  visibility: track.trackVisible ? 'visible' : 'hidden',
                }}
              >
                {track.items.map((item) => {
                  // Apply render offset for items that come after transition chains on the same track
                  const renderOffset = getRenderOffset(track.id, item.from);
                  const adjustedFrom = item.from - renderOffset;
                  return (
                    <Sequence key={item.id} from={adjustedFrom} durationInFrames={item.durationInFrames}>
                      <ItemEffectWrapper
                        itemTrackOrder={trackOrder}
                        adjustmentLayers={visibleAdjustmentLayers}
                        sequenceFrom={item.from}
                      >
                        <Item item={item} muted={false} masks={[]} />
                      </ItemEffectWrapper>
                    </Sequence>
                  );
                })}
              </AbsoluteFill>
            );
          })}
      </StableMaskedGroup>
    </AbsoluteFill>
  );
};
