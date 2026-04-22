import React, { useMemo } from 'react';
import { useVideoConfig } from '../hooks/use-player-compat';
import type { TimelineItem } from '@/types/timeline';
import { BLEND_MODE_CSS } from '@/types/blend-mode-css';
import {
  hasCornerPin,
  computeCornerPinMatrix3d,
  drawCornerPinImage,
  resolveCornerPinTargetRect,
  resolveCornerPinForSize,
} from '../utils/corner-pin';
import { getShapePath, rotatePath } from '../utils/shape-path';
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
  const hasCornerPinnedMask = masks.some((mask) => hasCornerPin(mask.shape.cornerPin));

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
  const rasterCornerPinnedMaskDataUrl = useMemo(() => {
    if (!hasCornerPinnedMask || masks.length === 0 || typeof document === 'undefined') {
      return null;
    }

    const width = Math.max(1, Math.round(canvasWidth));
    const height = Math.max(1, Math.round(canvasHeight));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return null;
    }

    const firstMask = masks[0]!;
    const maskType = firstMask.shape.maskType ?? 'clip';
    const feather = maskType === 'alpha' ? (firstMask.shape.maskFeather ?? 0) : 0;
    const invert = firstMask.shape.maskInvert ?? false;

    ctx.clearRect(0, 0, width, height);
    if (invert) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);
      ctx.globalCompositeOperation = 'destination-out';
    } else {
      ctx.globalCompositeOperation = 'source-over';
    }

    for (const mask of masks) {
      const { shape, transform } = mask;
      const localWidth = Math.max(1, Math.round(transform.width));
      const localHeight = Math.max(1, Math.round(transform.height));
      const left = width / 2 + transform.x - transform.width / 2;
      const top = height / 2 + transform.y - transform.height / 2;
      const centerX = left + transform.width / 2;
      const centerY = top + transform.height / 2;
      const resolvedPin = resolveCornerPinForSize(shape.cornerPin, transform.width, transform.height);

      ctx.save();
      if ((transform.rotation ?? 0) !== 0) {
        ctx.translate(centerX, centerY);
        ctx.rotate(((transform.rotation ?? 0) * Math.PI) / 180);
        ctx.translate(-centerX, -centerY);
      }

      if (resolvedPin && hasCornerPin(resolvedPin)) {
        const localCanvas = document.createElement('canvas');
        localCanvas.width = localWidth;
        localCanvas.height = localHeight;
        const localCtx = localCanvas.getContext('2d');
        if (!localCtx) {
          ctx.restore();
          continue;
        }

        const localPath = getShapePath(
          shape,
          {
            x: 0,
            y: 0,
            width: localWidth,
            height: localHeight,
            rotation: 0,
            opacity: 1,
          },
          {
            canvasWidth: localWidth,
            canvasHeight: localHeight,
          },
        );

        localCtx.fillStyle = '#ffffff';
        localCtx.fill(new Path2D(localPath));
        if ((shape.strokeWidth ?? 0) > 0) {
          localCtx.strokeStyle = '#ffffff';
          localCtx.lineWidth = shape.strokeWidth ?? 0;
          localCtx.stroke(new Path2D(localPath));
        }

        drawCornerPinImage(
          ctx as unknown as OffscreenCanvasRenderingContext2D,
          localCanvas,
          localWidth,
          localHeight,
          left,
          top,
          resolvedPin,
        );
      } else {
        let svgPath = getShapePath(
          shape,
          {
            x: transform.x,
            y: transform.y,
            width: transform.width,
            height: transform.height,
            rotation: 0,
            opacity: transform.opacity ?? 1,
          },
          {
            canvasWidth: width,
            canvasHeight: height,
          },
        );

        if ((transform.rotation ?? 0) !== 0) {
          svgPath = rotatePath(svgPath, transform.rotation ?? 0, centerX, centerY);
        }

        const path2d = new Path2D(svgPath);
        ctx.fillStyle = '#ffffff';
        ctx.fill(path2d);
        if ((shape.strokeWidth ?? 0) > 0) {
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = shape.strokeWidth ?? 0;
          ctx.stroke(path2d);
        }
      }

      ctx.restore();
    }

    ctx.globalCompositeOperation = 'source-over';

    if (feather > 0) {
      const blurredCanvas = document.createElement('canvas');
      blurredCanvas.width = width;
      blurredCanvas.height = height;
      const blurredCtx = blurredCanvas.getContext('2d');
      if (!blurredCtx) {
        return canvas.toDataURL('image/png');
      }
      blurredCtx.filter = `blur(${feather}px)`;
      blurredCtx.drawImage(canvas, 0, 0);
      return blurredCanvas.toDataURL('image/png');
    }

    return canvas.toDataURL('image/png');
  }, [canvasHeight, canvasWidth, hasCornerPinnedMask, masks]);

  const maskStyle = useMemo((): React.CSSProperties => {
    if (rasterCornerPinnedMaskDataUrl) {
      return {
        maskImage: `url("${rasterCornerPinnedMaskDataUrl}")`,
        WebkitMaskImage: `url("${rasterCornerPinnedMaskDataUrl}")`,
        maskRepeat: 'no-repeat',
        WebkitMaskRepeat: 'no-repeat',
        maskSize: '100% 100%',
        WebkitMaskSize: '100% 100%',
        maskPosition: '0 0',
        WebkitMaskPosition: '0 0',
      };
    }
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
  }, [state.maskType, state.maskClipPath, state.svgMaskId, rasterCornerPinnedMaskDataUrl, rasterSvgMaskDataUrl]);

  // Corner pin CSS matrix3d — use preview during drag for smooth interaction
  const cornerPinPreview = useCornerPinStore((s) =>
    s.editingItemId === item.id ? s.previewCornerPin : null
  );
  const effectiveCornerPin = cornerPinPreview ?? item.cornerPin;
  const effectiveCrop = state.propertiesPreview?.crop ?? state.animatedCrop ?? mediaContent?.crop;
  const cornerPinTargetRect = useMemo(() => {
    if (state.maskType !== null) {
      return resolveCornerPinTargetRect(
        state.transform.width,
        state.transform.height,
      );
    }

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
    state.maskType,
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
        crop={effectiveCrop}
      >
        {children}
      </ContainedMediaLayout>
    )
    : children;

  const cornerPinFrameStyle = useMemo((): React.CSSProperties => {
    if (mediaContent?.fitMode === 'contain' && cornerPinStyle) {
      return containedMediaStyle;
    }

    return {
      width: '100%',
      height: '100%',
    };
  }, [containedMediaStyle, cornerPinStyle, mediaContent?.fitMode]);

  const pinnedMediaBody = mediaContent?.fitMode === 'contain'
    ? (
      <ContainedMediaLayout
        sourceWidth={cornerPinTargetRect.width}
        sourceHeight={cornerPinTargetRect.height}
        containerWidth={cornerPinTargetRect.width}
        containerHeight={cornerPinTargetRect.height}
        crop={effectiveCrop}
      >
        {children}
      </ContainedMediaLayout>
    )
    : children;

  const pinnedMediaContent = (
    <div
      style={{
        width: '100%',
        height: '100%',
        position: 'relative',
        filter: state.cssFilter || undefined,
      }}
    >
      {pinnedMediaBody}
    </div>
  );

  const pinnedCornerPinContent = cornerPinStyle ? (
    <div
      style={{
        ...cornerPinFrameStyle,
        ...cornerPinStyle,
        willChange: 'transform',
        backfaceVisibility: 'hidden' as const,
        overflow: state.transform.cornerRadius > 0 ? 'hidden' : undefined,
      }}
    >
      {pinnedMediaContent}
    </div>
  ) : null;

  const innerContent = cornerPinStyle
    ? (
      <div style={{ width: '100%', height: '100%', position: 'relative' }}>
        {pinnedCornerPinContent}
      </div>
    )
    : (
      <div
        style={{
          width: '100%',
          height: '100%',
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
          {effectiveMediaChildren}
        </div>
      </div>
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
