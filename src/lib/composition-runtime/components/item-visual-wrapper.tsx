import React, { useMemo } from 'react';
import { useVideoConfig } from '../hooks/use-player-compat';
import type { TimelineItem } from '@/types/timeline';
import { useItemVisualState, getScanlinesStyle } from './hooks/use-item-visual-state';
import type { MaskInfo } from './item';

interface ItemVisualWrapperProps {
  item: TimelineItem;
  masks?: MaskInfo[];
  children: React.ReactNode;
}

/**
 * Combined visual wrapper for timeline items.
 *
 * Replaces TransformWrapper + EffectWrapper + MaskWrapper with a fixed DOM structure:
 * - Outer div: Transform positioning + mask (clip-path or SVG mask reference)
 * - Inner div: Effects (CSS filter) + overlay container
 *
 * Key design decisions:
 * - FIXED DOM STRUCTURE: Always renders the same divs regardless of effects/masks
 * - Effect overlays use CSS visibility instead of conditional rendering
 * - Single hook (useItemVisualState) provides all computed state
 * - No redundant store subscriptions (consolidated in hook)
 */
export const ItemVisualWrapper: React.FC<ItemVisualWrapperProps> = ({
  item,
  masks = [],
  children,
}) => {
  const { width: canvasWidth, height: canvasHeight } = useVideoConfig();

  // Get all visual state from consolidated hook
  const state = useItemVisualState(item, masks);

  // Compute mask style based on mask type
  const maskStyle = useMemo((): React.CSSProperties => {
    if (state.maskType === 'clip' && state.maskClipPath) {
      return { clipPath: state.maskClipPath };
    }
    if (state.maskType === 'svg-mask' && state.svgMaskId) {
      return {
        mask: `url(#${state.svgMaskId})`,
        WebkitMask: `url(#${state.svgMaskId})`,
      };
    }
    return {};
  }, [state.maskType, state.maskClipPath, state.svgMaskId]);

  // Check if any overlay effects are active
  const hasOverlays = state.scanlinesEffect || state.halftoneStyles || state.vignetteStyle;

  // Scanlines style (or hidden)
  const scanlinesStyle = useMemo((): React.CSSProperties => {
    if (!state.scanlinesEffect) {
      return { display: 'none' };
    }
    return {
      position: 'absolute',
      inset: 0,
      pointerEvents: 'none',
      ...getScanlinesStyle(state.scanlinesEffect.intensity),
    };
  }, [state.scanlinesEffect]);

  // Halftone wrapper style
  const halftoneWrapperStyle = useMemo((): React.CSSProperties => {
    if (!state.halftoneStyles) {
      return { display: 'none' };
    }
    return {
      position: 'absolute',
      inset: 0,
      overflow: 'hidden',
      pointerEvents: 'none',
      mixBlendMode: state.halftoneStyles.patternStyle.mixBlendMode,
      opacity: state.halftoneStyles.patternStyle.opacity,
    };
  }, [state.halftoneStyles]);

  // Halftone pattern style (without blendMode/opacity which is on wrapper)
  const halftonePatternStyle = useMemo((): React.CSSProperties => {
    if (!state.halftoneStyles) {
      return {};
    }
    return {
      ...state.halftoneStyles.patternStyle,
      mixBlendMode: undefined,
      opacity: undefined,
    };
  }, [state.halftoneStyles]);

  // Vignette style (or hidden)
  const vignetteContainerStyle = useMemo((): React.CSSProperties => {
    if (!state.vignetteStyle) {
      return { display: 'none' };
    }
    return state.vignetteStyle;
  }, [state.vignetteStyle]);

  // Render SVG mask defs for SVG-based masks
  const svgMaskDefs = useMemo(() => {
    if (state.maskType !== 'svg-mask' || !state.svgMaskId || !state.svgMaskPaths) {
      return null;
    }

    const filterId = `blur-${state.svgMaskId}`;

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
          {state.maskFeather > 0 && (
            <filter id={filterId} x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation={state.maskFeather} />
            </filter>
          )}
          <mask
            id={state.svgMaskId}
            maskUnits="userSpaceOnUse"
            x="0"
            y="0"
            width={canvasWidth}
            height={canvasHeight}
          >
            {/* Background: black=hidden, white=visible */}
            <rect
              x="0"
              y="0"
              width={canvasWidth}
              height={canvasHeight}
              fill={state.maskInvert ? 'white' : 'black'}
            />
            {/* Mask shapes with optional stroke */}
            {state.svgMaskPaths.map(({ path: pathD, strokeWidth }, i) => (
              <path
                key={i}
                d={pathD}
                fill={state.maskInvert ? 'black' : 'white'}
                stroke={strokeWidth > 0 ? (state.maskInvert ? 'black' : 'white') : undefined}
                strokeWidth={strokeWidth > 0 ? strokeWidth : undefined}
                filter={state.maskFeather > 0 ? `url(#${filterId})` : undefined}
              />
            ))}
          </mask>
        </defs>
      </svg>
    );
  }, [state.maskType, state.svgMaskId, state.svgMaskPaths, state.maskFeather, state.maskInvert, canvasWidth, canvasHeight]);

  return (
    <>
      {/* SVG mask definitions (hidden, referenced via CSS) */}
      {svgMaskDefs}

      {/* Outer: Transform + Mask */}
      <div
        style={{
          ...state.transformStyle,
          ...maskStyle,
          overflow: state.transform.cornerRadius > 0 ? 'hidden' : undefined,
        }}
      >
        {/* Inner: Effects + Content */}
        <div
          style={{
            width: '100%',
            height: '100%',
            position: 'relative',
            filter: state.cssFilter || undefined,
          }}
        >
          {children}

          {/* Overlay container - ALWAYS rendered, hidden via CSS when unused */}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              pointerEvents: 'none',
              display: hasOverlays ? 'block' : 'none',
            }}
          >
            {/* Scanlines overlay */}
            <div style={scanlinesStyle} />

            {/* Halftone pattern overlay */}
            <div style={halftoneWrapperStyle}>
              {state.halftoneStyles?.fadeWrapperStyle ? (
                <div style={state.halftoneStyles.fadeWrapperStyle}>
                  <div style={halftonePatternStyle} />
                </div>
              ) : (
                <div style={halftonePatternStyle} />
              )}
            </div>

            {/* Vignette overlay - renders on top of all other effects */}
            <div style={vignetteContainerStyle} />
          </div>
        </div>
      </div>
    </>
  );
};
