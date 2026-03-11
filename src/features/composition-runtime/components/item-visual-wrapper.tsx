import React, { useMemo } from 'react';
import { useVideoConfig } from '../hooks/use-player-compat';
import type { TimelineItem } from '@/types/timeline';
import { BLEND_MODE_CSS } from '@/types/blend-mode-css';
import { hasCornerPin, computeCornerPinMatrix3d } from '../utils/corner-pin';
import { useCornerPinStore } from '@/features/composition-runtime/deps/stores';
import { useItemVisualState } from './hooks/use-item-visual-state';
import {
  renderSvgMaskPathsToDataUrl,
} from '../utils/clip-mask-raster';
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
  const rasterSvgMaskDataUrl = useMemo(() => {
    if (state.maskType !== 'svg-mask' || !state.svgMaskPaths) {
      return null;
    }

    return renderSvgMaskPathsToDataUrl(
      state.svgMaskPaths,
      canvasWidth,
      canvasHeight,
      state.maskFeather,
      state.maskInvert,
    );
  }, [
    state.maskType,
    state.svgMaskPaths,
    state.maskFeather,
    state.maskInvert,
    canvasWidth,
    canvasHeight,
  ]);

  const maskStyle = useMemo((): React.CSSProperties => {
    if (state.maskType === 'clip' && state.maskClipPath) {
      return { clipPath: state.maskClipPath };
    }
    if (state.maskType === 'svg-mask' && rasterSvgMaskDataUrl) {
      return {
        maskImage: `url("${rasterSvgMaskDataUrl}")`,
        WebkitMaskImage: `url("${rasterSvgMaskDataUrl}")`,
        maskRepeat: 'no-repeat',
        WebkitMaskRepeat: 'no-repeat',
        maskSize: '100% 100%',
        WebkitMaskSize: '100% 100%',
        maskPosition: '0 0',
        WebkitMaskPosition: '0 0',
        transform: 'translateZ(0)',
        backfaceVisibility: 'hidden' as const,
        contain: 'paint',
      };
    }
    if (state.maskType === 'svg-mask' && state.svgMaskId) {
      return {
        mask: `url(#${state.svgMaskId})`,
        WebkitMask: `url(#${state.svgMaskId})`,
      };
    }
    return {};
  }, [state.maskType, state.maskClipPath, state.svgMaskId, rasterSvgMaskDataUrl]);

  // Corner pin CSS matrix3d — use preview during drag for smooth interaction
  const cornerPinPreview = useCornerPinStore((s) =>
    s.editingItemId === item.id ? s.previewCornerPin : null
  );
  const effectiveCornerPin = cornerPinPreview ?? item.cornerPin;

  const cornerPinStyle = useMemo((): React.CSSProperties | null => {
    if (!hasCornerPin(effectiveCornerPin)) return null;
    const w = state.transform.width;
    const h = state.transform.height;
    return {
      transformOrigin: '0 0',
      transform: computeCornerPinMatrix3d(w, h, effectiveCornerPin!),
    };
  }, [effectiveCornerPin, state.transform.width, state.transform.height]);

  // Render SVG mask defs for SVG-based masks
  const svgMaskDefs = useMemo(() => {
    if (rasterSvgMaskDataUrl || state.maskType !== 'svg-mask' || !state.svgMaskId || !state.svgMaskPaths) {
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
  }, [rasterSvgMaskDataUrl, state.maskType, state.svgMaskId, state.svgMaskPaths, state.maskFeather, state.maskInvert, canvasWidth, canvasHeight]);

  return (
    <>
      {/* SVG mask definitions (hidden, referenced via CSS) */}
      {svgMaskDefs}

      {/* Outer: Transform + Mask + Blend Mode */}
      <div
        style={{
          ...state.transformStyle,
          ...maskStyle,
          overflow: state.transform.cornerRadius > 0 && !cornerPinStyle ? 'hidden' : undefined,
          mixBlendMode: item.blendMode && item.blendMode !== 'normal'
            ? BLEND_MODE_CSS[item.blendMode]
            : undefined,
        }}
      >
        {/* Corner Pin wrapper (only when active) */}
        {/* When corner pin is active, will-change + backfaceVisibility force Chrome
            to composite through the CSS pipeline instead of video hardware overlay,
            which would otherwise ignore the matrix3d transform. */}
        <div
          style={cornerPinStyle ? {
            width: '100%',
            height: '100%',
            ...cornerPinStyle,
            willChange: 'transform',
            backfaceVisibility: 'hidden' as const,
            overflow: state.transform.cornerRadius > 0 ? 'hidden' : undefined,
          } : {
            width: '100%',
            height: '100%',
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
          </div>
        </div>
      </div>
    </>
  );
};
