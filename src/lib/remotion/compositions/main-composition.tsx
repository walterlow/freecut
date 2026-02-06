import React, { useMemo, useCallback } from 'react';
import { AbsoluteFill, Sequence } from '@/features/player/composition';
import { useCurrentFrame, useVideoConfig } from '../hooks/use-remotion-compat';
import type { RemotionInputProps } from '@/types/export';
import type { TextItem, ShapeItem, AdjustmentItem, VideoItem, ImageItem } from '@/types/timeline';
import { Item } from '../components/item';
import { EffectsBasedTransitionsLayer } from '../components/effects-based-transition-optimized';
import { StableVideoSequence } from '../components/stable-video-sequence';
import { loadFonts } from '../utils/fonts';
import { resolveTransform } from '../utils/transform-resolver';
import { getShapePath, rotatePath } from '../utils/shape-path';
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
export const MainComposition: React.FC<RemotionInputProps> = ({ tracks, transitions = [], backgroundColor = '#000000', keyframes }) => {
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

  // Build transition enrichment data for clips involved in transitions.
  // Each clip gets: source offset (for video sync) and audio crossfade info.
  // Video items for rendering (all video items, rendered by StableVideoSequence)
  const videoItems = useMemo(() =>
    allVisualItems.filter((item) => item.type === 'video'),
    [allVisualItems]
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
        {/* Audio uses item.id as key (not generateStableKey) to prevent remounts on speed changes */}
        {/* Hidden tracks are muted but stay in DOM for stable structure */}
        {audioItems.map((item) => (
          <Sequence
            key={item.id}
            from={item.from}
            durationInFrames={item.durationInFrames}
          >
            <Item item={item} muted={item.muted || !item.trackVisible} masks={[]} />
          </Sequence>
        ))}

        {/* ALL VISUAL LAYERS - videos and non-media in SINGLE wrapper for proper z-index stacking */}
        {/* This ensures items from different tracks respect z-index across all types */}
        <StableMaskedGroup hasMasks={hasActiveMasks}>
          {/* VIDEO LAYER - all videos rendered via StableVideoSequence */}
          {/* ALL effects (CSS, glitch, halftone) applied per-item via ItemEffectWrapper */}
          <StableVideoSequence
            items={videoItems as any}
            premountFor={Math.round(fps * 1)}
            renderItem={renderVideoItem as any}
          />

          {/* Effects-based transitions - visual effect centered on cut point */}
          {/* These render ABOVE the normal clips during the transition window */}
          <EffectsBasedTransitionsLayer
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
                        <Item item={item} muted={false} masks={[]} />
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
