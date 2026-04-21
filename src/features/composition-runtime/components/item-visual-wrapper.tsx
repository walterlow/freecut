import React, { useMemo } from 'react';
import { useVideoConfig } from '../hooks/use-player-compat';
import type { TimelineItem } from '@/types/timeline';
import { BLEND_MODE_CSS } from '@/types/blend-mode-css';
import {
  hasCornerPin,
  computeCornerPinMatrix3d,
  resolveCornerPinTargetRect,
  resolveCornerPinForSize,
} from '../utils/corner-pin';
import { useCornerPinStore } from '@/features/composition-runtime/deps/stores';
import { useItemVisualState } from './hooks/use-item-visual-state';
import {
  renderSvgMaskPathsToDataUrl,
} from '../utils/clip-mask-raster';
import type { MaskInfo } from './item';
import type { CropSettings } from '@/types/transform';
import { ContainedMediaLayout } from './contained-media-layout';

interface ItemVisualWrapperProps {
  item: TimelineItem;
  masks?: MaskInfo[];
  mediaContent?: {
    fitMode: 'contain';
    sourceWidth?: number;
    sourceHeight?: number;
    crop?: CropSettings;
  };
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
  mediaContent,
  children,
}) => {
  const { width: canvasWidth, height: canvasHeight } = useVideoConfig();

  // Get all visual state from consolidated hook
  const state = useItemVisualState(item, masks);
  const shouldRasterizeSvgMask = state.maskType === 'svg-mask'
    && !!state.svgMaskPaths
    && state.maskFeather > 0;

  // Compute mask style based on mask type
  const rasterSvgMaskDataUrl = useMemo(() => {
    if (!shouldRasterizeSvgMask || !state.svgMaskPaths) {
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
    shouldRasterizeSvgMask,
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
  const effectiveCrop = state.propertiesPreview?.crop ?? mediaContent?.crop;
  const cornerPinTargetRect = useMemo(() => {
    if (mediaContent?.fitMode === 'contain') {
      return resolveCornerPinTargetRect(
        state.transform.width,
        state.transform.height,
        {
          sourceWidth: mediaContent.sourceWidth ?? state.transform.width,
          sourceHeight: mediaContent.sourceHeight ?? state.transform.height,
          crop: effectiveCrop,
        },
      );
    }

    return resolveCornerPinTargetRect(
      state.transform.width,
      state.transform.height,
    );
  }, [
    effectiveCrop,
    mediaContent?.fitMode,
    mediaContent?.sourceHeight,
    mediaContent?.sourceWidth,
    state.transform.height,
    state.transform.width,
  ]);
  const containedMediaStyle = useMemo((): React.CSSProperties => {
    const width = state.transform.width;
    const height = state.transform.height;
    const toPercent = (value: number, total: number) => {
      if (!Number.isFinite(value) || !Number.isFinite(total) || total <= 0) {
        return '0%';
      }
      return `${(value / total) * 100}%`;
    };

    return {
      position: 'absolute',
      left: toPercent(cornerPinTargetRect.x, width),
      top: toPercent(cornerPinTargetRect.y, height),
      width: toPercent(cornerPinTargetRect.width, width),
      height: toPercent(cornerPinTargetRect.height, height),
    };
  }, [
    cornerPinTargetRect.height,
    cornerPinTargetRect.width,
    cornerPinTargetRect.x,
    cornerPinTargetRect.y,
    state.transform.height,
    state.transform.width,
  ]);

  const cornerPinStyle = useMemo((): React.CSSProperties | null => {
    const w = cornerPinTargetRect.width;
    const h = cornerPinTargetRect.height;
    const resolvedCornerPin = resolveCornerPinForSize(effectiveCornerPin, w, h);
    if (!resolvedCornerPin || !hasCornerPin(resolvedCornerPin)) return null;
    const activeCornerPin = resolvedCornerPin;
    return {
      transformOrigin: '0 0',
      transform: computeCornerPinMatrix3d(w, h, activeCornerPin),
    };
  }, [cornerPinTargetRect.height, cornerPinTargetRect.width, effectiveCornerPin]);

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

  const blendModeCss = item.blendMode && item.blendMode !== 'normal'
    ? BLEND_MODE_CSS[item.blendMode]
    : undefined;

  const maskContainerStyle = useMemo((): React.CSSProperties => {
    return {
      position: 'absolute',
      left: 0,
      top: 0,
      width: '100%',
      height: '100%',
      ...maskStyle,
      mixBlendMode: blendModeCss,
    };
  }, [maskStyle, blendModeCss]);

  const effectiveMediaChildren = mediaContent?.fitMode === 'contain'
    ? (
      <ContainedMediaLayout
        sourceWidth={mediaContent.sourceWidth ?? state.transform.width}
        sourceHeight={mediaContent.sourceHeight ?? state.transform.height}
        containerWidth={state.transform.width}
        containerHeight={state.transform.height}
        crop={state.propertiesPreview?.crop ?? mediaContent.crop}
      >
        {children}
      </ContainedMediaLayout>
    )
    : children;

  const innerContent = mediaContent?.fitMode === 'contain' && cornerPinStyle ? (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <div
        style={{
          ...containedMediaStyle,
          ...cornerPinStyle,
          willChange: 'transform',
          backfaceVisibility: 'hidden' as const,
          overflow: state.transform.cornerRadius > 0 ? 'hidden' : undefined,
        }}
      >
        <div
          style={{
            width: '100%',
            height: '100%',
            position: 'relative',
            filter: state.cssFilter || undefined,
          }}
        >
          <ContainedMediaLayout
            sourceWidth={cornerPinTargetRect.width}
            sourceHeight={cornerPinTargetRect.height}
            containerWidth={cornerPinTargetRect.width}
            containerHeight={cornerPinTargetRect.height}
            crop={effectiveCrop}
          >
            {children}
          </ContainedMediaLayout>
        </div>
      </div>
    </div>
  ) : (
    <>
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
          {effectiveMediaChildren}
        </div>
      </div>
    </>
  );

  // When there's no mask, skip the full-canvas mask container div entirely
  if (state.maskType === null) {
    return (
      <div
        style={{
          ...state.transformStyle,
          overflow: state.transform.cornerRadius > 0 && !cornerPinStyle ? 'hidden' : undefined,
          mixBlendMode: blendModeCss,
        }}
      >
        {innerContent}
      </div>
    );
  }

  return (
    <>
      {/* SVG mask definitions (hidden, referenced via CSS) */}
      {svgMaskDefs}

      {/* Masks are authored in composition space, so they must be applied on a
          full-canvas wrapper instead of the item-sized transform node. */}
      <div style={maskContainerStyle}>
        <div
          style={{
            ...state.transformStyle,
            overflow: state.transform.cornerRadius > 0 && !cornerPinStyle ? 'hidden' : undefined,
          }}
        >
          {innerContent}
        </div>
      </div>
    </>
  );
};
