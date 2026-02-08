import React, { useMemo } from 'react';
import { useSequenceContext } from '@/features/player/composition';
import type { AdjustmentItem } from '@/types/timeline';
import type { ItemEffect, GlitchEffect } from '@/types/effects';
import { effectsToCSSFilter, getGlitchEffects, getHalftoneEffect, getHalftoneStyles } from '@/features/effects/utils/effect-to-css';
import { getScanlinesStyle, getGlitchFilterString } from '@/features/effects/utils/glitch-algorithms';
import { useGizmoStore } from '@/features/preview/stores/gizmo-store';

/** Adjustment layer with its track order for scope calculation */
export interface AdjustmentLayerWithTrackOrder {
  layer: AdjustmentItem;
  trackOrder: number;
}

export interface AdjustmentWrapperProps {
  adjustmentLayers: AdjustmentLayerWithTrackOrder[];
  children: React.ReactNode;
}

/** Internal props including frame for memoization */
interface AdjustmentWrapperInternalProps extends AdjustmentWrapperProps {
  frame: number;
}

/**
 * AdjustmentWrapper applies combined effects from all active adjustment layers.
 * Effects are applied at the group level, wrapping affected items.
 *
 * Effect stacking:
 * 1. Per-clip effects apply FIRST (inside individual items via EffectWrapper)
 * 2. Adjustment layer effects apply SECOND (via this component)
 *
 * Memoized to prevent unnecessary re-renders. Frame is passed as prop
 * from FrameAwareAdjustmentWrapper to isolate per-frame updates.
 */
const AdjustmentWrapperInternal = React.memo<AdjustmentWrapperInternalProps>(({
  adjustmentLayers,
  children,
  frame,
}) => {

  // Read unified preview from gizmo store for real-time slider updates
  const preview = useGizmoStore((s) => s.preview);

  // Get effects from ACTIVE adjustment layers at current frame
  // Layers are processed in track order (lowest first) for predictable stacking
  // Uses unified preview for real-time updates during slider drag
  const activeEffects = useMemo((): ItemEffect[] => {
    if (adjustmentLayers.length === 0) return [];

    // Sort by track order (lowest first = applied first, toSorted for immutability)
    const sortedLayers = adjustmentLayers.toSorted((a, b) => a.trackOrder - b.trackOrder);

    return sortedLayers
      .filter(({ layer }) =>
        frame >= layer.from &&
        frame < layer.from + layer.durationInFrames
      )
      .flatMap(({ layer }) => {
        // Use preview effects if available, otherwise use actual effects
        const effects = preview?.[layer.id]?.effects ?? layer.effects ?? [];
        // Note: layer.effectOpacity is available for future effect intensity scaling

        // For simplicity, we just filter enabled effects for now
        // Future: implement effectOpacity scaling per effect type
        return effects.filter(e => e.enabled);
      });
  }, [adjustmentLayers, frame, preview]);

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

  // Get halftone effect for CSS-based rendering
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

  // Calculate glitch-based filters (color glitch adds hue-rotate)
  const glitchFilterString = useMemo(() => {
    if (glitchEffects.length === 0) return '';
    return getGlitchFilterString(glitchEffects, frame);
  }, [glitchEffects, frame]);

  // Combine all CSS filters (RGB split is now handled via SVG filter in glitchFilterString)
  // NOTE: No early return for empty effects - we always render the same div structure
  // to prevent DOM changes when adjustment layers activate/deactivate (prevents re-render)
  const combinedFilter = [cssFilterString, glitchFilterString].filter(Boolean).join(' ');

  // Check for scanlines effect (needs overlay div, not just CSS filter)
  const scanlinesEffect = glitchEffects.find((e) => e.variant === 'scanlines');

  // Merge halftone container filter with other filters
  const finalFilter = halftoneStyles
    ? [combinedFilter, halftoneStyles.containerStyle.filter].filter(Boolean).join(' ')
    : combinedFilter;

  // Render with CSS-based halftone (no WebGL flickering on pause)
  // NOTE: overflow:hidden is placed on a separate wrapper for the halftone pattern,
  // not on the main container. This prevents clipping of transformed/moved children.
  // NOTE: For adjustment layers, we do NOT apply halftone backgroundColor here!
  // The background would block videos on tracks below.
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
      {/* Scanlines overlay */}
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
    </div>
  );
});

/**
 * Frame-aware wrapper for AdjustmentWrapper.
 * Isolates useSequenceContext to this component so that parent components
 * don't re-render on every frame. Only this component and its children
 * will re-render per frame.
 *
 * Exported as AdjustmentWrapper for backward compatibility.
 */
export const AdjustmentWrapper: React.FC<AdjustmentWrapperProps> = (props) => {
  // Get local frame from Sequence context (0-based within this Sequence)
  const sequenceContext = useSequenceContext();
  const frame = sequenceContext?.localFrame ?? 0;
  return <AdjustmentWrapperInternal {...props} frame={frame} />;
};
