import React, { useMemo } from 'react';
import { useVideoConfig } from '../hooks/use-player-compat';
import type { TimelineItem } from '@/types/timeline';
import { BLEND_MODE_CSS } from '@/types/blend-mode-css';
import { maskVerticesToSvgPath } from '@/features/preview/utils/mask-path-utils';
import { useItemVisualState } from './hooks/use-item-visual-state';
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

  // Per-item ClipMask (bezier paths) — rendered as clip-path or SVG mask
  const clipMaskStyle = useMemo((): React.CSSProperties => {
    const clipMasks = item.masks?.filter((m) => m.enabled && m.vertices.length >= 2);
    if (!clipMasks || clipMasks.length === 0) return {};

    // For ClipMask, vertices are in normalized 0-1 space relative to item bounds.
    // We use the resolved transform dimensions for the SVG viewBox.
    const w = state.transform.width;
    const h = state.transform.height;

    // Build combined SVG path from all enabled masks
    const paths = clipMasks.map((m) => maskVerticesToSvgPath(m.vertices, w, h));
    const hasFeather = clipMasks.some((m) => m.feather > 0.5);
    const hasInverted = clipMasks.some((m) => m.inverted);

    if (!hasFeather && !hasInverted && clipMasks.length === 1) {
      // Simple clip-path (fastest path)
      return { clipPath: `path('${paths[0]}')` };
    }

    // For complex masks (feather, invert, multiple), use SVG mask via inline style
    // The SVG defs are rendered below in clipMaskSvgDefs
    return {
      mask: `url(#clip-mask-${item.id})`,
      WebkitMask: `url(#clip-mask-${item.id})`,
    };
  }, [item.masks, item.id, state.transform.width, state.transform.height]);

  // SVG defs for per-item ClipMask (when feather/invert/multiple masks needed)
  const clipMaskSvgDefs = useMemo(() => {
    const clipMasks = item.masks?.filter((m) => m.enabled && m.vertices.length >= 2);
    if (!clipMasks || clipMasks.length === 0) return null;

    const hasFeather = clipMasks.some((m) => m.feather > 0.5);
    const hasInverted = clipMasks.some((m) => m.inverted);
    if (!hasFeather && !hasInverted && clipMasks.length === 1) return null;

    const w = state.transform.width;
    const h = state.transform.height;
    const maskId = `clip-mask-${item.id}`;
    const filterId = `clip-mask-blur-${item.id}`;
    const maxFeather = clipMasks.reduce((max, m) => Math.max(max, m.feather), 0);
    const allInverted = clipMasks.every((m) => m.inverted);

    return (
      <svg
        style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden', pointerEvents: 'none' }}
        aria-hidden="true"
      >
        <defs>
          {maxFeather > 0.5 && (
            <filter id={filterId} x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation={maxFeather} />
            </filter>
          )}
          <mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width={w} height={h}>
            <rect x="0" y="0" width={w} height={h} fill={allInverted ? 'white' : 'black'} />
            {clipMasks.map((m) => (
              <path
                key={m.id}
                d={maskVerticesToSvgPath(m.vertices, w, h)}
                fill={m.inverted ? 'black' : 'white'}
                opacity={m.opacity}
                filter={m.feather > 0.5 ? `url(#${filterId})` : undefined}
              />
            ))}
          </mask>
        </defs>
      </svg>
    );
  }, [item.masks, item.id, state.transform.width, state.transform.height]);

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
      {clipMaskSvgDefs}

      {/* Outer: Transform + Mask + Blend Mode */}
      <div
        style={{
          ...state.transformStyle,
          ...maskStyle,
          overflow: state.transform.cornerRadius > 0 ? 'hidden' : undefined,
          mixBlendMode: item.blendMode && item.blendMode !== 'normal'
            ? BLEND_MODE_CSS[item.blendMode]
            : undefined,
        }}
      >
        {/* Inner: Effects + Per-item ClipMask + Content */}
        <div
          style={{
            width: '100%',
            height: '100%',
            position: 'relative',
            filter: state.cssFilter || undefined,
            ...clipMaskStyle,
          }}
        >
          {children}
        </div>
      </div>
    </>
  );
};
