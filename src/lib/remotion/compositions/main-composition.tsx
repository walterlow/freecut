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
  /** Unique stable ID for the chain (based on first clip's originId) */
  id: string;
  /** Content hash for memo comparison - changes when chain content changes */
  contentHash: string;
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
 *
 * Optimized with O(1) Map lookups instead of O(n) array scans.
 */
function groupClipsIntoChains(
  items: EnrichedVisualItem[],
  transitions: Transition[]
): { chains: ClipChain[]; standaloneClips: EnrichedVisualItem[] } {
  // Build item lookup map for O(1) access (replaces O(n) .find() calls)
  const itemsById = new Map<string, EnrichedVisualItem>();
  for (const item of items) {
    itemsById.set(item.id, item);
  }

  // Build adjacency map: clipId -> { left: Transition, right: Transition }
  const transitionMap = new Map<string, { left?: Transition; right?: Transition }>();
  for (const t of transitions) {
    if (!transitionMap.has(t.leftClipId)) transitionMap.set(t.leftClipId, {});
    if (!transitionMap.has(t.rightClipId)) transitionMap.set(t.rightClipId, {});
    transitionMap.get(t.leftClipId)!.right = t;
    transitionMap.get(t.rightClipId)!.left = t;
  }

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
      const leftClip = itemsById.get(leftTrans.leftClipId); // O(1) instead of O(n)
      if (!leftClip || visitedClips.has(leftClip.id)) break;
      chainStart = leftClip;
    }

    // Now walk right to build the chain
    const chainClips: EnrichedVisualItem[] = [];
    const chainTransitions: Transition[] = [];
    let current: EnrichedVisualItem | undefined = chainStart;

    while (current && !visitedClips.has(current.id)) {
      chainClips.push(current);
      visitedClips.add(current.id);

      const rightTrans = transitionMap.get(current.id)?.right;
      if (!rightTrans) break;

      chainTransitions.push(rightTrans);
      const nextClip = itemsById.get(rightTrans.rightClipId); // O(1) instead of O(n)
      if (!nextClip || visitedClips.has(nextClip.id)) break;
      current = nextClip;
    }

    if (chainClips.length > 1) {
      const lastClip = chainClips[chainClips.length - 1]!;
      const totalClipDuration = chainClips.reduce((sum, c) => sum + c.durationInFrames, 0);
      const totalOverlap = chainTransitions.reduce((sum, t) => sum + t.durationInFrames, 0);

      // Generate stable chain ID from first clip
      const chainId = chainStart.originId || chainStart.id;

      // Generate content hash for memo comparison
      // Includes clip identities, positions, durations, sources, and transition details
      const contentHash = [
        chainClips.map(c => `${c.originId || c.id}:${c.from}:${c.durationInFrames}:${c.src}:${c.sourceStart}`).join('|'),
        chainTransitions.map(t => `${t.id}:${t.durationInFrames}:${t.presentation}:${t.timing}:${t.direction || ''}`).join('|'),
      ].join('~');

      chains.push({
        id: chainId,
        contentHash,
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
 * Audio renderer for clips in transition chains.
 * Handles crossfade between clips during transition overlaps.
 * This is separate from TransitionSeries which only handles video.
 *
 * Memoized to prevent re-renders when unrelated composition updates occur.
 */
const ChainAudioRenderer = React.memo<{
  chains: ClipChain[];
  tracks: RemotionInputProps['tracks'];
  visibleTrackIds: Set<string>;
}>(function ChainAudioRenderer({ chains, tracks, visibleTrackIds }) {
  // Pre-compute track info for stability
  const trackInfo = useMemo(() => {
    const info = new Map<string, { muted: boolean }>();
    tracks.forEach((t) => info.set(t.id, { muted: t.muted ?? false }));
    return info;
  }, [tracks]);

  // Pre-compute audio clip data for each chain to avoid recalculating during render
  const chainAudioData = useMemo(() => {
    return chains.map((chain) => {
      const trackData = trackInfo.get(chain.trackId);
      const trackMuted = trackData?.muted ?? false;
      const trackVisible = visibleTrackIds.has(chain.trackId);

      // Calculate positions for each audio clip
      let runningFrame = chain.startFrame;
      const clipData: Array<{
        clip: VideoItem;
        clipStart: number;
        fadeInDuration: number;
        fadeOutDuration: number;
        muted: boolean;
      }> = [];

      chain.clips.forEach((clip, clipIndex) => {
        const clipStart = runningFrame;
        const transitionBefore = clipIndex > 0 ? chain.transitions[clipIndex - 1] : null;
        const transitionAfter = chain.transitions[clipIndex];

        // Update running frame for next iteration
        runningFrame += clip.durationInFrames - (transitionAfter?.durationInFrames ?? 0);

        // Only include video clips (images don't have audio)
        if (clip.type === 'video') {
          clipData.push({
            clip: clip as VideoItem,
            clipStart,
            fadeInDuration: transitionBefore?.durationInFrames ?? 0,
            fadeOutDuration: transitionAfter?.durationInFrames ?? 0,
            muted: trackMuted || !trackVisible,
          });
        }
      });

      return clipData;
    });
  }, [chains, trackInfo, visibleTrackIds]);

  // Flatten and render all audio clips
  // Use clip.id for keys (not originId) because after splits, both parts may end up in
  // different chains with the same originId, causing duplicate key errors
  return (
    <>
      {chainAudioData.flat().map((data) => (
        <Sequence
          key={`chain-audio-${data.clip.id}`}
          from={data.clipStart}
          durationInFrames={data.clip.durationInFrames}
        >
          <ChainClipAudio
            clip={data.clip}
            fadeInDuration={data.fadeInDuration}
            fadeOutDuration={data.fadeOutDuration}
            muted={data.muted}
          />
        </Sequence>
      ))}
    </>
  );
});

/**
 * Audio for a single clip in a chain with crossfade support.
 * Renders audio-only with volume interpolation for smooth transitions.
 * Memoized to prevent unnecessary re-renders during playback.
 */
const ChainClipAudio = React.memo<{
  clip: VideoItem;
  fadeInDuration: number;
  fadeOutDuration: number;
  muted: boolean;
}>(function ChainClipAudio({ clip, fadeInDuration, fadeOutDuration, muted }) {
  // Skip if muted or no source
  if (muted || !clip.src) return null;

  // Get source position and playback rate
  const trimBefore = clip.sourceStart ?? clip.trimStart ?? clip.offset ?? 0;
  const playbackRate = clip.speed ?? 1;

  // Render audio with crossfade support via PitchCorrectedAudio
  return (
    <PitchCorrectedAudio
      src={clip.src}
      itemId={clip.id}
      trimBefore={trimBefore}
      volume={clip.volume ?? 0}
      playbackRate={playbackRate}
      muted={false}
      durationInFrames={clip.durationInFrames}
      audioFadeIn={clip.audioFadeIn}
      audioFadeOut={clip.audioFadeOut}
      // Crossfade overrides for transitions
      crossfadeFadeIn={fadeInDuration}
      crossfadeFadeOut={fadeOutDuration}
    />
  );
});

/**
 * Memoized renderer for an entire transition chain.
 * Prevents TransitionSeries re-renders when unrelated clips change.
 * Uses deep comparison of chain structure for stability.
 */
const ChainRenderer = React.memo<{
  chain: ClipChain;
  trackVisible: boolean;
  trackOrder: number;
  zIndex: number;
  adjustmentLayers: AdjustmentLayerWithTrackOrder[];
  canvasWidth: number;
  canvasHeight: number;
}>(function ChainRenderer({
  chain,
  trackVisible,
  trackOrder,
  zIndex,
  adjustmentLayers,
  canvasWidth,
  canvasHeight,
}) {
  // Use originId for stable key across splits
  const chainKey = chain.clips[0]!.originId || chain.clips[0]!.id;

  // Premount to prevent flicker when transitioning from standalone clips
  // This mounts the content early (with opacity:0) so videos can preload
  // Using minimal value to balance flicker prevention vs pause
  const premountFrames = 5;

  return (
    <Sequence
      key={`chain-${chainKey}`}
      from={chain.startFrame}
      durationInFrames={chain.renderedDuration}
      premountFor={premountFrames}
    >
      <AbsoluteFill
        style={{
          zIndex,
          visibility: trackVisible ? 'visible' : 'hidden',
          // GPU layer hints to prevent compositing flicker during transitions
          transform: 'translateZ(0)',
          backfaceVisibility: 'hidden',
        }}
      >
        <TransitionSeries>
          {chain.clips.map((clip, index) => {
            const transition = chain.transitions[index];
            const clipKey = clip.originId || clip.id;

            return (
              <React.Fragment key={clipKey}>
                {/* TransitionSeries requires direct children - cannot use wrapper component */}
                <TransitionSeries.Sequence durationInFrames={clip.durationInFrames}>
                  <ItemEffectWrapper
                    itemTrackOrder={trackOrder}
                    adjustmentLayers={adjustmentLayers}
                    sequenceFrom={clip.from}
                  >
                    <Item
                      item={clip}
                      muted={true}
                      masks={[]}
                    />
                  </ItemEffectWrapper>
                </TransitionSeries.Sequence>
                {transition && (
                  <TransitionSeries.Transition
                    timing={getTransitionTiming(transition.timing, transition.durationInFrames)}
                    presentation={getTransitionPresentation(
                      transition.presentation,
                      canvasWidth,
                      canvasHeight,
                      transition.direction
                    )}
                  />
                )}
              </React.Fragment>
            );
          })}
        </TransitionSeries>
      </AbsoluteFill>
    </Sequence>
  );
}, (prevProps, nextProps) => {
  // Fast path: compare chain identity and content hash
  // This replaces 60+ individual property comparisons with 2 string comparisons
  if (prevProps.chain.id !== nextProps.chain.id) return false;
  if (prevProps.chain.contentHash !== nextProps.chain.contentHash) return false;

  // Compare track properties (these aren't in the content hash)
  if (prevProps.trackVisible !== nextProps.trackVisible) return false;
  if (prevProps.trackOrder !== nextProps.trackOrder) return false;
  if (prevProps.zIndex !== nextProps.zIndex) return false;

  // Compare adjustment layers (these apply effects from above tracks)
  if (prevProps.adjustmentLayers.length !== nextProps.adjustmentLayers.length) return false;
  for (let i = 0; i < prevProps.adjustmentLayers.length; i++) {
    if (prevProps.adjustmentLayers[i]!.layer.id !== nextProps.adjustmentLayers[i]!.layer.id) return false;
    if (prevProps.adjustmentLayers[i]!.trackOrder !== nextProps.adjustmentLayers[i]!.trackOrder) return false;
  }

  return true;
});

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

      {/* VIDEO LAYER - standalone videos AND transition chains in SINGLE wrapper for DOM stability */}
      {/* Combining them prevents flicker when transitioning between standalone and chain clips */}
      {/* ALL effects (CSS, glitch, halftone) applied per-item via ItemEffectWrapper */}
      <StableMaskedGroup hasMasks={hasActiveMasks}>
        {/* Standalone videos */}
        <StableVideoSequence
          items={videoItems as any}
          premountFor={Math.round(fps * 2)}
          renderItem={renderVideoItem as any}
        />

        {/* Transition chains - always render container for DOM stability (even when empty) */}
        {chains.map((chain) => {
          const track = tracks.find((t) => t.id === chain.trackId);
          const trackVisible = visibleTrackIds.has(chain.trackId);
          const trackOrder = track?.order ?? 0;
          const zIndex = maxOrder - trackOrder;
          // Use originId for stable key across splits (originId is preserved when splitting)
          const chainKey = chain.clips[0]!.originId || chain.clips[0]!.id;

          return (
            <ChainRenderer
              key={`chain-${chainKey}`}
              chain={chain}
              trackVisible={trackVisible}
              trackOrder={trackOrder}
              zIndex={zIndex}
              adjustmentLayers={visibleAdjustmentLayers}
              canvasWidth={canvasWidth}
              canvasHeight={canvasHeight}
            />
          );
        })}
      </StableMaskedGroup>


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
