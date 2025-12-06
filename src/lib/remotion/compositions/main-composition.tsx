import React, { useMemo, useCallback } from 'react';
import { AbsoluteFill, Sequence, useVideoConfig, useCurrentFrame } from 'remotion';
import type { RemotionInputProps } from '@/types/export';
import type { TextItem, ShapeItem, AdjustmentItem } from '@/types/timeline';
import { Item } from '../components/item';
import { StableVideoSequence } from '../components/stable-video-sequence';
import { loadFonts } from '../utils/fonts';
import { resolveTransform } from '../utils/transform-resolver';
import { getShapePath, rotatePath } from '../utils/shape-path';
import { useGizmoStore } from '@/features/preview/stores/gizmo-store';
import { ItemEffectWrapper, type AdjustmentLayerWithTrackOrder } from '../components/item-effect-wrapper';
import { AdjustmentPostProcessor } from '@/features/effects/components/adjustment-post-processor';
import type { PostProcessingEffect } from '@/features/effects/utils/post-processing-pipeline';
import { getHalftoneEffect } from '@/features/effects/utils/effect-to-css';

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
  videoItems: Array<{ from: number; durationInFrames: number; trackVisible: boolean }>;
  backgroundColor: string;
}> = ({ videoItems, backgroundColor }) => {
  const currentFrame = useCurrentFrame();
  // Only consider VISIBLE videos for clearing layer logic
  const hasActiveVideo = videoItems.some(
    (item) =>
      item.trackVisible &&
      currentFrame >= item.from &&
      currentFrame < item.from + item.durationInFrames
  );

  if (hasActiveVideo) return null;
  return <AbsoluteFill style={{ backgroundColor, zIndex: 1000 }} />;
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
 * Global Halftone Wrapper - applies halftone post-processing to all visual content.
 *
 * Halftone requires canvas-based capture of the entire rendered frame, so it can't
 * be applied per-item like CSS filters. This wrapper applies halftone globally
 * when any active adjustment layer has a halftone effect.
 *
 * Always renders the same DOM structure (AdjustmentPostProcessor handles enabled/disabled).
 * Uses its own useCurrentFrame() to isolate per-frame re-renders.
 */
const GlobalHalftoneWrapper: React.FC<{
  children: React.ReactNode;
  adjustmentLayers: AdjustmentLayerWithTrackOrder[];
}> = ({ children, adjustmentLayers }) => {
  const frame = useCurrentFrame();

  // Read effects preview from gizmo store for real-time slider updates
  const effectsPreview = useGizmoStore((s) => s.effectsPreview);

  // Find active halftone effect from any adjustment layer at current frame
  const halftoneEffect = useMemo((): PostProcessingEffect | null => {
    if (adjustmentLayers.length === 0) return null;

    for (const { layer } of adjustmentLayers) {
      // Check if layer is active at current frame
      if (frame < layer.from || frame >= layer.from + layer.durationInFrames) continue;

      // Check for halftone effect - use preview if available for live slider updates
      const effects = effectsPreview?.[layer.id] ?? layer.effects ?? [];
      const halftone = getHalftoneEffect(effects);
      if (halftone) {
        return {
          type: 'halftone',
          options: {
            dotSize: halftone.dotSize,
            spacing: halftone.spacing,
            angle: halftone.angle,
            intensity: halftone.intensity,
            backgroundColor: halftone.backgroundColor,
            dotColor: halftone.dotColor,
          },
        };
      }
    }
    return null;
  }, [adjustmentLayers, frame, effectsPreview]);

  // Always render AdjustmentPostProcessor to maintain stable DOM structure
  return (
    <AdjustmentPostProcessor
      effect={halftoneEffect}
      enabled={!!halftoneEffect}
    >
      {children}
    </AdjustmentPostProcessor>
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
 * 1. CSS filter/glitch effects applied PER-ITEM via ItemEffectWrapper
 * 2. Each item checks if it should have effects based on track order
 * 3. Adding/removing adjustment layers doesn't change DOM structure
 * 4. Halftone (canvas-based) applied globally via GlobalHalftoneWrapper
 */
export const MainComposition: React.FC<RemotionInputProps> = ({ tracks, backgroundColor = '#000000' }) => {
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

  // Separate video and audio items - audio doesn't need masking and should be isolated
  // from visual layer changes to prevent unnecessary re-renders
  // Use ALL tracks (not just visible) to keep DOM structure stable when toggling visibility
  const videoItems = useMemo(() =>
    tracks.flatMap((track) =>
      track.items
        .filter((item) => item.type === 'video')
        .map((item) => ({
          ...item,
          zIndex: maxOrder - (track.order ?? 0),
          muted: track.muted,
          trackOrder: track.order ?? 0,
          trackVisible: visibleTrackIds.has(track.id),
        }))
    ),
    [tracks, visibleTrackIds, maxOrder]
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
  // No longer split into above/below groups - effects applied per-item via ItemEffectWrapper
  const nonMediaByTrack = useMemo(() =>
    tracks.map((track) => ({
      ...track,
      trackVisible: visibleTrackIds.has(track.id),
      items: track.items.filter(
        (item) =>
          item.type !== 'video' &&
          item.type !== 'audio' &&
          !(item.type === 'shape' && item.isMask) &&
          item.type !== 'adjustment' // Filter out adjustment items
      ),
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
      {audioItems.map((item) => (
        <Sequence
          key={item.id}
          from={item.from}
          durationInFrames={item.durationInFrames}
        >
          <Item item={item} muted={item.muted || !item.trackVisible} masks={[]} />
        </Sequence>
      ))}

      {/* GLOBAL HALFTONE WRAPPER - applies halftone canvas post-processing globally */}
      {/* Halftone requires full-frame capture so can't be per-item like CSS filters */}
      {/* Always renders same DOM structure - enabled/disabled handled internally */}
      <GlobalHalftoneWrapper adjustmentLayers={visibleAdjustmentLayers}>
        {/* VIDEO LAYER - all videos in single StableVideoSequence for DOM stability */}
        {/* Per-item CSS/glitch effects applied via ItemEffectWrapper in renderVideoItem */}
        {/* No more above/below split - items never move between DOM parents */}
        <StableMaskedGroup hasMasks={hasActiveMasks}>
          <StableVideoSequence
            items={videoItems}
            premountFor={Math.round(fps * 2)}
            renderItem={renderVideoItem}
          />
        </StableMaskedGroup>

        {/* CLEARING LAYER - uses its own useCurrentFrame() to isolate per-frame re-renders */}
        <ClearingLayer videoItems={videoItems} backgroundColor={backgroundColor} />

        {/* NON-MEDIA LAYERS - all in single structure, per-item effects via ItemEffectWrapper */}
        {/* No more above/below split - items never move between DOM parents */}
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
      </GlobalHalftoneWrapper>
    </AbsoluteFill>
  );
};
