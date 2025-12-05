import React, { useMemo } from 'react';
import { useCurrentFrame } from 'remotion';
import type { AdjustmentItem } from '@/types/timeline';
import type { ItemEffect, GlitchEffect } from '@/types/effects';
import { effectsToCSSFilter, getGlitchEffects, getHalftoneEffect } from '@/features/effects/utils/effect-to-css';
import { getRGBSplitStyles, getScanlinesStyle, getGlitchFilterString } from '@/features/effects/utils/glitch-algorithms';
import { useGizmoStore } from '@/features/preview/stores/gizmo-store';
import { AdjustmentPostProcessor } from '@/features/effects/components/adjustment-post-processor';
import type { PostProcessingEffect } from '@/features/effects/utils/post-processing-pipeline';

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

  // Read effects preview from gizmo store for real-time slider updates
  const effectsPreview = useGizmoStore((s) => s.effectsPreview);

  // Get effects from ACTIVE adjustment layers at current frame
  // Layers are processed in track order (lowest first) for predictable stacking
  // Uses effectsPreview for real-time updates during slider drag
  const activeEffects = useMemo((): ItemEffect[] => {
    if (adjustmentLayers.length === 0) return [];

    // Sort by track order (lowest first = applied first)
    const sortedLayers = [...adjustmentLayers].sort((a, b) => a.trackOrder - b.trackOrder);

    return sortedLayers
      .filter(({ layer }) =>
        frame >= layer.from &&
        frame < layer.from + layer.durationInFrames
      )
      .flatMap(({ layer }) => {
        // Use preview effects if available, otherwise use actual effects
        const effects = effectsPreview?.[layer.id] ?? layer.effects ?? [];
        // Note: layer.effectOpacity is available for future effect intensity scaling

        // For simplicity, we just filter enabled effects for now
        // Future: implement effectOpacity scaling per effect type
        return effects.filter(e => e.enabled);
      });
  }, [adjustmentLayers, frame, effectsPreview]);

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

  // Get halftone effect for canvas-based rendering
  const halftoneEffect = useMemo(() => {
    if (activeEffects.length === 0) return null;
    return getHalftoneEffect(activeEffects);
  }, [activeEffects]);

  // Build post-processing effect config for halftone
  const postProcessingEffect = useMemo((): PostProcessingEffect | null => {
    if (!halftoneEffect) return null;
    return {
      type: 'halftone',
      options: {
        dotSize: halftoneEffect.dotSize,
        spacing: halftoneEffect.spacing,
        angle: halftoneEffect.angle,
        intensity: halftoneEffect.intensity,
        backgroundColor: halftoneEffect.backgroundColor,
        dotColor: halftoneEffect.dotColor,
      },
    };
  }, [halftoneEffect]);

  // Calculate glitch-based filters (color glitch adds hue-rotate)
  const glitchFilterString = useMemo(() => {
    if (glitchEffects.length === 0) return '';
    return getGlitchFilterString(glitchEffects, frame);
  }, [glitchEffects, frame]);

  // Combine all CSS filters
  // NOTE: No early return for empty effects - we always render the same div structure
  // to prevent DOM changes when adjustment layers activate/deactivate (prevents re-render)
  const combinedFilter = [cssFilterString, glitchFilterString].filter(Boolean).join(' ');

  // Check for RGB split effect
  const rgbSplitEffect = glitchEffects.find((e) => e.variant === 'rgb-split');

  // Check for scanlines effect
  const scanlinesEffect = glitchEffects.find((e) => e.variant === 'scanlines');

  // RGB split requires special multi-layer rendering
  if (rgbSplitEffect) {
    const { redOffset, blueOffset, active } = getRGBSplitStyles(
      rgbSplitEffect.intensity,
      frame,
      rgbSplitEffect.speed,
      rgbSplitEffect.seed
    );

    if (active) {
      const rgbSplitContent = (
        <div
          style={{
            position: 'relative',
            width: '100%',
            height: '100%',
            filter: combinedFilter || undefined,
          }}
        >
          {/* Red channel - offset right */}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              transform: `translateX(${redOffset}px)`,
              mixBlendMode: 'screen',
              opacity: 0.8,
            }}
          >
            <div
              style={{
                width: '100%',
                height: '100%',
                filter: 'saturate(0) brightness(1.2)',
                mixBlendMode: 'multiply',
              }}
            >
              <div style={{ width: '100%', height: '100%', backgroundColor: 'red', mixBlendMode: 'multiply' }}>
                {children}
              </div>
            </div>
          </div>
          {/* Blue channel - offset left */}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              transform: `translateX(${blueOffset}px)`,
              mixBlendMode: 'screen',
              opacity: 0.8,
            }}
          >
            <div
              style={{
                width: '100%',
                height: '100%',
                filter: 'saturate(0) brightness(1.2)',
                mixBlendMode: 'multiply',
              }}
            >
              <div style={{ width: '100%', height: '100%', backgroundColor: 'cyan', mixBlendMode: 'multiply' }}>
                {children}
              </div>
            </div>
          </div>
          {/* Base layer (green channel stays centered) */}
          <div style={{ position: 'relative', width: '100%', height: '100%' }}>{children}</div>
          {/* Scanlines overlay if present */}
          {scanlinesEffect && (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                ...getScanlinesStyle(scanlinesEffect.intensity),
              }}
            />
          )}
        </div>
      );

      // Wrap with halftone post-processor if halftone effect is also present
      if (postProcessingEffect) {
        return (
          <AdjustmentPostProcessor
            effect={postProcessingEffect}
            enabled={true}
          >
            {rgbSplitContent}
          </AdjustmentPostProcessor>
        );
      }

      return rgbSplitContent;
    }
  }

  // Standard rendering with CSS filters + optional scanlines + optional halftone
  const standardContent = (
    <div
      style={{
        width: '100%',
        height: '100%',
        position: 'relative',
        filter: combinedFilter || undefined,
      }}
    >
      {children}
      {/* Scanlines overlay */}
      {scanlinesEffect && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            ...getScanlinesStyle(scanlinesEffect.intensity),
          }}
        />
      )}
    </div>
  );

  // Wrap with halftone post-processor if halftone effect is present
  if (postProcessingEffect) {
    return (
      <AdjustmentPostProcessor
        effect={postProcessingEffect}
        enabled={true}
      >
        {standardContent}
      </AdjustmentPostProcessor>
    );
  }

  return standardContent;
});

/**
 * Frame-aware wrapper for AdjustmentWrapper.
 * Isolates useCurrentFrame() to this component so that parent components
 * don't re-render on every frame. Only this component and its children
 * will re-render per frame.
 *
 * Exported as AdjustmentWrapper for backward compatibility.
 */
export const AdjustmentWrapper: React.FC<AdjustmentWrapperProps> = (props) => {
  const frame = useCurrentFrame();
  return <AdjustmentWrapperInternal {...props} frame={frame} />;
};
