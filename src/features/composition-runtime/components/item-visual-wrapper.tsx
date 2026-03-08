import React, { useMemo } from 'react';
import { useVideoConfig } from '../hooks/use-player-compat';
import type { TimelineItem } from '@/types/timeline';
import { BLEND_MODE_CSS } from '@/types/blend-mode-css';
import { maskVerticesToSvgPath } from '@/features/preview/utils/mask-path-utils';
import { hasCornerPin, computeCornerPinMatrix3d } from '../utils/corner-pin';
import { useCornerPinStore, useMaskEditorStore } from '@/features/composition-runtime/deps/stores';
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

  // Live mask preview during slider drag — reads from lightweight preview store
  // so updates bypass the slow React prop chain (items-store → tracks → composition).
  const previewMasks = useMaskEditorStore((s) =>
    s.editingItemId === item.id ? s.previewMasks : null
  );
  const effectiveMasks = previewMasks ?? item.masks;

  // Simple masks (no feather, full opacity, add mode): use clip-path (GPU geometry, lightweight).
  // Complex masks (feather, partial opacity, subtract/intersect): use SVG mask.
  const clipMaskResult = useMemo(() => {
    const clipMasks = effectiveMasks?.filter((m) => m.enabled && m.vertices.length >= 2);
    if (!clipMasks || clipMasks.length === 0) return { style: {} as React.CSSProperties, svgDefs: null };

    const needsSvgMask = clipMasks.some((m) =>
      m.feather > 0.5 || m.opacity < 0.99 || m.inverted || m.mode !== 'add'
    );

    const w = state.transform.width;
    const h = state.transform.height;

    if (!needsSvgMask) {
      // clip-path: GPU geometry clipping, no per-pixel compositing
      const combinedPath = clipMasks
        .map((m) => maskVerticesToSvgPath(m.vertices, w, h))
        .join(' ');
      return {
        style: { clipPath: `path('${combinedPath}')` } as React.CSSProperties,
        svgDefs: null,
      };
    }

    // SVG mask for complex cases
    const maskId = `clip-mask-${item.id}`;
    const filterId = `clip-mask-blur-${item.id}`;
    const maxFeather = clipMasks.reduce((max, m) => Math.max(max, m.feather), 0);
    const firstMode = clipMasks[0]?.mode ?? 'add';
    const bgFill = firstMode === 'add' ? 'black' : 'white';

    return {
      style: {
        mask: `url(#${maskId})`,
        WebkitMask: `url(#${maskId})`,
      } as React.CSSProperties,
      svgDefs: (
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
              <rect x="0" y="0" width={w} height={h} fill={bgFill} />
              {clipMasks.map((m) => {
                const isAdditive = m.mode === 'add' || m.mode === 'intersect';
                const fill = (isAdditive ? !m.inverted : m.inverted) ? 'white' : 'black';
                return (
                  <path
                    key={m.id}
                    d={maskVerticesToSvgPath(m.vertices, w, h)}
                    fill={fill}
                    opacity={m.opacity}
                    filter={maxFeather > 0.5 ? `url(#${filterId})` : undefined}
                  />
                );
              })}
            </mask>
          </defs>
        </svg>
      ),
    };
  }, [effectiveMasks, item.id, state.transform.width, state.transform.height]);

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
      {clipMaskResult.svgDefs}

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
          {/* Inner: Effects + Per-item ClipMask + Content */}
          <div
            style={{
              width: '100%',
              height: '100%',
              position: 'relative',
              filter: state.cssFilter || undefined,
              ...clipMaskResult.style,
            }}
          >
            {children}
          </div>
        </div>
      </div>
    </>
  );
};
