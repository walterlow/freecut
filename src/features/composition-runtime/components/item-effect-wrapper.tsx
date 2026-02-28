import React, { useMemo } from 'react';
import { useSequenceContext } from '@/features/composition-runtime/deps/player';
import type { AdjustmentItem } from '@/types/timeline';
import type { ItemEffect, GlitchEffect } from '@/types/effects';
import { effectsToCSSFilter, getGlitchEffects, getVignetteEffect, getVignetteStyle, getHalftoneEffect, getHalftoneStyles } from '@/features/composition-runtime/deps/effects';
import { getScanlinesStyle, getGlitchFilterString } from '@/features/composition-runtime/deps/effects';
import { useGizmoStore } from '@/features/composition-runtime/deps/stores';

/** Adjustment layer with its track order for scope calculation */
export interface AdjustmentLayerWithTrackOrder {
  layer: AdjustmentItem;
  trackOrder: number;
}

interface ItemEffectWrapperProps {
  /** The item's track order (used to determine if effects should apply) */
  itemTrackOrder: number;
  /** All adjustment layers (from visible tracks) */
  adjustmentLayers: AdjustmentLayerWithTrackOrder[];
  /** The `from` value of the nearest parent Sequence (for converting local to global frame) */
  sequenceFrom: number;
  /** Children to render */
  children: React.ReactNode;
}

/** Internal props including frame for memoization */
interface ItemEffectWrapperInternalProps extends ItemEffectWrapperProps {
  frame: number;
}

/**
 * Per-item effect wrapper that applies adjustment layer effects based on track order.
 *
 * An item is affected by an adjustment layer if:
 * - The item's track order > the adjustment layer's track order
 *   (higher track order = lower zIndex = visually BEHIND the adjustment)
 *
 * This component replaces the container-level AdjustmentWrapper approach,
 * allowing all items to stay in the same DOM location while effects are
 * applied conditionally per-item. This prevents DOM restructuring when
 * adjustment layers are added/removed.
 *
 * Memoized to prevent unnecessary re-renders. Frame is passed as prop
 * from FrameAwareItemEffectWrapper to isolate per-frame updates.
 */
const ItemEffectWrapperInternal = React.memo<ItemEffectWrapperInternalProps>(({
  itemTrackOrder,
  adjustmentLayers,
  sequenceFrom,
  children,
  frame,
}) => {
  // Read unified preview from gizmo store for real-time slider updates
  const preview = useGizmoStore((s) => s.preview);

  // Convert local frame (relative to parent Sequence) to global frame
  // This is necessary because useCurrentFrame() returns local frame, but
  // adjustment layer from/durationInFrames are in global frames
  const globalFrame = frame + sequenceFrom;

  // Find adjustment layers that affect this item (adjustment trackOrder < item trackOrder)
  // AND are active at the current frame
  const activeEffects = useMemo((): ItemEffect[] => {
    if (adjustmentLayers.length === 0) return [];

    // Filter to layers that:
    // 1. Are visually ABOVE this item (adjustment trackOrder < item trackOrder)
    // 2. Are active at current frame (using global frame for comparison)
    const affectingLayers = adjustmentLayers.filter(({ layer, trackOrder }) => {
      // Item must be BEHIND the adjustment (higher track order = lower zIndex)
      if (itemTrackOrder <= trackOrder) return false;
      // Adjustment must be active at current frame (global frame comparison)
      return globalFrame >= layer.from && globalFrame < layer.from + layer.durationInFrames;
    });

    if (affectingLayers.length === 0) return [];

    // Sort by track order (lowest first = applied first) and collect effects
    return affectingLayers
      .toSorted((a, b) => a.trackOrder - b.trackOrder)
      .flatMap(({ layer }) => {
        // Use preview effects if available, otherwise use actual effects
        const effects = preview?.[layer.id]?.effects ?? layer.effects ?? [];
        return effects.filter(e => e.enabled);
      });
  }, [adjustmentLayers, itemTrackOrder, globalFrame, preview]);

  // Build CSS filter string from CSS filter effects
  const cssFilterString = useMemo(() => {
    if (activeEffects.length === 0) return '';
    return effectsToCSSFilter(activeEffects);
  }, [activeEffects]);

  // Get glitch effects for special rendering
  const glitchEffects = useMemo(() => {
    if (activeEffects.length === 0) return [];
    return getGlitchEffects(activeEffects) as Array<GlitchEffect & { id: string }>;
  }, [activeEffects]);

  // Calculate glitch-based filters (color glitch adds hue-rotate, RGB split via SVG)
  const glitchFilterString = useMemo(() => {
    if (glitchEffects.length === 0) return '';
    return getGlitchFilterString(glitchEffects, globalFrame);
  }, [glitchEffects, globalFrame]);

  // Combine all CSS filters
  const combinedFilter = [cssFilterString, glitchFilterString].filter(Boolean).join(' ');

  // Check for scanlines effect (needs overlay div, not just CSS filter)
  const scanlinesEffect = glitchEffects.find((e) => e.variant === 'scanlines');

  // Get vignette effect for overlay rendering
  const vignetteEffect = useMemo(() => {
    if (activeEffects.length === 0) return null;
    return getVignetteEffect(activeEffects);
  }, [activeEffects]);

  // Get halftone effect for CSS-based rendering (per-item, respects track order)
  const halftoneEffect = useMemo(() => {
    if (activeEffects.length === 0) return null;
    return getHalftoneEffect(activeEffects);
  }, [activeEffects]);

  // Get CSS halftone styles (pure CSS approach - no WebGL flickering)
  // Background is always transparent so lower tracks show through
  const halftoneStyles = useMemo(() => {
    if (!halftoneEffect) return null;
    return getHalftoneStyles(halftoneEffect);
  }, [halftoneEffect]);

  // Merge halftone container filter with other filters
  const finalFilter = halftoneStyles
    ? [combinedFilter, halftoneStyles.containerStyle.filter].filter(Boolean).join(' ')
    : combinedFilter;

  // IMPORTANT: Always render the same div structure to prevent DOM changes
  // when effects activate/deactivate. Use empty filter instead of conditional wrapper.
  // Halftone is now CSS-based (no WebGL flickering on pause).
  // NOTE: overflow:hidden is placed on a separate wrapper for the halftone pattern,
  // not on the main container. This prevents clipping of transformed/moved children.
  // NOTE: For adjustment layers, we do NOT apply halftone backgroundColor here!
  // The background would block videos on tracks below. The halftone pattern overlay
  // is sufficient - it blends with the content underneath.
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        position: 'relative',
        filter: finalFilter || undefined,
        // Don't apply overflow:hidden here - it clips transformed children!
        // Don't apply backgroundColor here - it blocks lower tracks!
      }}
    >
      {children}
      {/* Scanlines overlay - only rendered when effect is active */}
      {scanlinesEffect && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            pointerEvents: 'none',
            ...getScanlinesStyle(scanlinesEffect.intensity),
          }}
        />
      )}
      {/* CSS Halftone dot pattern overlay - wrapped with overflow:hidden to contain the 200% pattern */}
      {/* mixBlendMode is on the wrapper so it blends with content below (not inside the overflow context) */}
      {halftoneStyles && (
        <div style={{
          position: 'absolute',
          inset: 0,
          overflow: 'hidden',
          pointerEvents: 'none',
          mixBlendMode: halftoneStyles.patternStyle.mixBlendMode,
          opacity: halftoneStyles.patternStyle.opacity,
        }}>
          {halftoneStyles.fadeWrapperStyle ? (
            <div style={halftoneStyles.fadeWrapperStyle}>
              <div style={{ ...halftoneStyles.patternStyle, mixBlendMode: undefined, opacity: undefined }} />
            </div>
          ) : (
            <div style={{ ...halftoneStyles.patternStyle, mixBlendMode: undefined, opacity: undefined }} />
          )}
        </div>
      )}
      {/* Vignette overlay - renders on top of all other effects */}
      {vignetteEffect && (
        <div style={getVignetteStyle(vignetteEffect)} />
      )}
    </div>
  );
});

/**
 * Frame-aware wrapper for ItemEffectWrapper.
 * Isolates useSequenceContext to this component so that parent components
 * don't re-render on every frame. Only this component and its children
 * will re-render per frame.
 */
export const ItemEffectWrapper: React.FC<ItemEffectWrapperProps> = (props) => {
  // Get local frame from Sequence context (0-based within this Sequence)
  const sequenceContext = useSequenceContext();
  const frame = sequenceContext?.localFrame ?? 0;
  return <ItemEffectWrapperInternal {...props} frame={frame} />;
};
