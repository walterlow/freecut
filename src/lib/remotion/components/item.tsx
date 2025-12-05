import React, { useMemo, useState, useCallback } from 'react';
import { AbsoluteFill, OffthreadVideo, Img, useVideoConfig, useCurrentFrame, interpolate, useRemotionEnvironment } from 'remotion';
import { Video } from '@remotion/media';
import { Rect, Circle, Triangle, Ellipse, Star, Polygon, Heart } from '@remotion/shapes';
import { useGizmoStore } from '@/features/preview/stores/gizmo-store';
import { usePlaybackStore } from '@/features/preview/stores/playback-store';
import type { TimelineItem, VideoItem, TextItem, ShapeItem } from '@/types/timeline';
import type { TransformProperties } from '@/types/transform';
import type { ItemEffect, GlitchEffect, HalftoneEffect } from '@/types/effects';
import { DebugOverlay } from './debug-overlay';
import { PitchCorrectedAudio } from './pitch-corrected-audio';
import { GifPlayer } from './gif-player';
import {
  resolveTransform,
  getSourceDimensions,
  toTransformStyle,
} from '../utils/transform-resolver';
import { loadFont, FONT_WEIGHT_MAP } from '../utils/fonts';
import { getShapePath, rotatePath } from '../utils/shape-path';
import { effectsToCSSFilter, getGlitchEffects, getHalftoneEffect } from '@/features/effects/utils/effect-to-css';
import { getRGBSplitStyles, getScanlinesStyle, getGlitchFilterString } from '@/features/effects/utils/glitch-algorithms';
import { HalftoneWrapper } from '@/features/effects/components/halftone-wrapper';

/** Mask information passed from composition to items */
export interface MaskInfo {
  shape: ShapeItem;
  transform: TransformProperties;
}

/**
 * Hook to calculate video audio volume with fades and preview support.
 * Returns the final volume (0-1) to apply to the video component.
 * During preview, also applies master preview volume from playback controls.
 */
function useVideoAudioVolume(item: VideoItem & { _sequenceFrameOffset?: number }, muted: boolean): number {
  const { fps } = useVideoConfig();
  const sequenceFrame = useCurrentFrame();
  const env = useRemotionEnvironment();

  // Adjust frame for shared Sequences (split clips)
  // In a shared Sequence, useCurrentFrame() returns frame relative to the shared Sequence start,
  // not relative to this specific item. _sequenceFrameOffset corrects this.
  const frame = sequenceFrame - (item._sequenceFrameOffset ?? 0);

  // Read preview values from gizmo store
  const itemPropertiesPreview = useGizmoStore((s) => s.itemPropertiesPreview);
  const preview = itemPropertiesPreview?.[item.id];

  // Read master preview volume from playback store (only used during preview, not render)
  const previewMasterVolume = usePlaybackStore((s) => s.volume);
  const previewMasterMuted = usePlaybackStore((s) => s.muted);

  // Use preview values if available, otherwise use item's stored values
  // Volume is stored in dB (0 = unity gain)
  const volumeDb = preview?.volume ?? item.volume ?? 0;
  const audioFadeIn = preview?.audioFadeIn ?? item.audioFadeIn ?? 0;
  const audioFadeOut = preview?.audioFadeOut ?? item.audioFadeOut ?? 0;

  if (muted) return 0;

  // Calculate fade multiplier
  const fadeInFrames = Math.min(audioFadeIn * fps, item.durationInFrames);
  const fadeOutFrames = Math.min(audioFadeOut * fps, item.durationInFrames);

  let fadeMultiplier = 1;
  const hasFadeIn = fadeInFrames > 0;
  const hasFadeOut = fadeOutFrames > 0;

  if (hasFadeIn || hasFadeOut) {
    const fadeOutStart = item.durationInFrames - fadeOutFrames;

    if (hasFadeIn && hasFadeOut) {
      if (fadeInFrames >= fadeOutStart) {
        // Overlapping fades
        const midPoint = item.durationInFrames / 2;
        const peakVolume = Math.min(1, midPoint / Math.max(fadeInFrames, 1));
        fadeMultiplier = interpolate(
          frame,
          [0, midPoint, item.durationInFrames],
          [0, peakVolume, 0],
          { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
        );
      } else {
        fadeMultiplier = interpolate(
          frame,
          [0, fadeInFrames, fadeOutStart, item.durationInFrames],
          [0, 1, 1, 0],
          { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
        );
      }
    } else if (hasFadeIn) {
      fadeMultiplier = interpolate(
        frame,
        [0, fadeInFrames],
        [0, 1],
        { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
      );
    } else {
      fadeMultiplier = interpolate(
        frame,
        [fadeOutStart, item.durationInFrames],
        [1, 0],
        { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
      );
    }
  }

  // Convert dB to linear (0 dB = unity gain = 1.0)
  const linearVolume = Math.pow(10, volumeDb / 20);
  // Item volume with fades
  const itemVolume = Math.max(0, Math.min(1, linearVolume * fadeMultiplier));

  // During render, use only item volume
  // During preview, apply master preview volume from playback controls
  const isPreview = env.isPlayer || env.isStudio;
  const effectiveMasterVolume = isPreview ? (previewMasterMuted ? 0 : previewMasterVolume) : 1;

  return itemVolume * effectiveMasterVolume;
}

/**
 * Check if a URL points to a GIF file
 */
function isGifUrl(url: string): boolean {
  if (!url) return false;
  const lowerUrl = url.toLowerCase();
  return lowerUrl.endsWith('.gif') || lowerUrl.includes('.gif');
}

/**
 * Video content with audio volume/fades support.
 * Separate component so we can use hooks for audio calculation.
 *
 * Uses OffthreadVideo for preview (Player/Studio) - more resilient to main thread activity.
 * Uses @remotion/media Video for rendering - better frame extraction.
 */
const VideoContent: React.FC<{
  item: VideoItem;
  muted: boolean;
  safeTrimBefore: number;
  playbackRate: number;
}> = ({ item, muted, safeTrimBefore, playbackRate }) => {
  const audioVolume = useVideoAudioVolume(item, muted);
  const env = useRemotionEnvironment();
  const [hasError, setHasError] = useState(false);

  // Handle media errors (e.g., invalid blob URL after HMR or cache cleanup)
  const handleError = useCallback((error: Error) => {
    console.warn(`[VideoContent] Media error for item ${item.id}:`, error.message);
    setHasError(true);
  }, [item.id]);

  // Show error state if media failed to load
  if (hasError) {
    return (
      <div
        style={{
          width: '100%',
          height: '100%',
          backgroundColor: '#1a1a1a',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <p style={{ color: '#666', fontSize: 14 }}>Media unavailable</p>
      </div>
    );
  }

  // Use OffthreadVideo for preview (Player/Studio) - runs in separate thread, resilient to UI activity
  // Use @remotion/media Video for rendering - better frame extraction with mediabunny
  const isPreview = env.isPlayer || env.isStudio;

  if (isPreview) {
    return (
      <OffthreadVideo
        src={item.src!}
        trimBefore={safeTrimBefore > 0 ? safeTrimBefore : undefined}
        volume={audioVolume}
        playbackRate={playbackRate}
        pauseWhenBuffering={false}
        onError={handleError}
        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
      />
    );
  }

  // Use OffthreadVideo for server-side rendering as well
  // @remotion/media Video was falling back to OffthreadVideo anyway due to "Unknown container format"
  // Using OffthreadVideo directly ensures consistent behavior and proper trimBefore handling
  return (
    <OffthreadVideo
      src={item.src!}
      trimBefore={safeTrimBefore > 0 ? safeTrimBefore : undefined}
      volume={audioVolume}
      playbackRate={playbackRate}
      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
      onError={(err) => {
        // Log but don't crash - Remotion will retry failed frames
        console.warn('[VideoContent] Frame extraction warning:', err.message);
      }}
    />
  );
};

/**
 * Text content with live property preview support.
 * Reads preview values from gizmo store for real-time updates during slider/picker drag.
 */
const TextContent: React.FC<{ item: TextItem }> = ({ item }) => {
  // Read preview values from gizmo store
  const itemPropertiesPreview = useGizmoStore((s) => s.itemPropertiesPreview);
  const preview = itemPropertiesPreview?.[item.id];

  // Use preview values if available, otherwise use item's stored values
  const fontSize = preview?.fontSize ?? item.fontSize ?? 60;
  const letterSpacing = preview?.letterSpacing ?? item.letterSpacing ?? 0;
  const lineHeight = preview?.lineHeight ?? item.lineHeight ?? 1.2;
  const color = preview?.color ?? item.color;

  // Load the Google Font and get the CSS fontFamily value
  // loadFont() blocks rendering until the font is ready (works for both preview and server render)
  const fontName = item.fontFamily ?? 'Inter';
  const fontFamily = loadFont(fontName);

  // Get font weight from shared map
  const fontWeight = FONT_WEIGHT_MAP[item.fontWeight ?? 'normal'] ?? 400;

  // Map text align to flexbox justify-content (horizontal)
  const textAlignMap: Record<string, string> = {
    left: 'flex-start',
    center: 'center',
    right: 'flex-end',
  };
  const justifyContent = textAlignMap[item.textAlign ?? 'center'] ?? 'center';

  // Map vertical align to flexbox align-items
  const verticalAlignMap: Record<string, string> = {
    top: 'flex-start',
    middle: 'center',
    bottom: 'flex-end',
  };
  const alignItems = verticalAlignMap[item.verticalAlign ?? 'middle'] ?? 'center';

  // Build text shadow CSS if present
  const textShadow = item.textShadow
    ? `${item.textShadow.offsetX}px ${item.textShadow.offsetY}px ${item.textShadow.blur}px ${item.textShadow.color}`
    : undefined;

  // Build stroke/outline effect using text-stroke or text shadow workaround
  // Note: -webkit-text-stroke is not well supported in Remotion rendering
  // Using multiple text shadows as a fallback for stroke effect
  const strokeShadows = item.stroke
    ? [
        `${item.stroke.width}px 0 ${item.stroke.color}`,
        `-${item.stroke.width}px 0 ${item.stroke.color}`,
        `0 ${item.stroke.width}px ${item.stroke.color}`,
        `0 -${item.stroke.width}px ${item.stroke.color}`,
      ].join(', ')
    : undefined;

  const finalTextShadow = [textShadow, strokeShadows].filter(Boolean).join(', ') || undefined;

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems,
        justifyContent,
        padding: '16px',
        backgroundColor: item.backgroundColor,
        boxSizing: 'border-box',
      }}
    >
      <div
        style={{
          fontSize,
          // Use the fontFamily returned by loadFont (includes proper CSS value)
          fontFamily: fontFamily,
          fontWeight,
          fontStyle: item.fontStyle ?? 'normal',
          color,
          textAlign: item.textAlign ?? 'center',
          lineHeight,
          letterSpacing,
          textShadow: finalTextShadow,
          // Best practice: use inline-block and pre-wrap to match measureText behavior
          display: 'inline-block',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          width: '100%',
        }}
      >
        {item.text}
      </div>
    </div>
  );
};

/**
 * Shape content with live property preview support.
 * Renders Remotion shapes (Rect, Circle, Triangle, Ellipse, Star, Polygon).
 * Reads preview values from gizmo store for real-time updates during editing.
 */
const ShapeContent: React.FC<{ item: ShapeItem }> = ({ item }) => {
  // Read preview values from gizmo store for shape properties
  const itemPropertiesPreview = useGizmoStore((s) => s.itemPropertiesPreview);
  const preview = itemPropertiesPreview?.[item.id];

  // Read transform preview from gizmo store for real-time scaling
  const activeGizmo = useGizmoStore((s) => s.activeGizmo);
  const previewTransform = useGizmoStore((s) => s.previewTransform);
  const propertiesPreview = useGizmoStore((s) => s.propertiesPreview);
  const groupPreviewTransforms = useGizmoStore((s) => s.groupPreviewTransforms);

  // Use preview values if available, otherwise use item's stored values
  const fillColor = preview?.fillColor ?? item.fillColor ?? '#3b82f6';
  const strokeColor = preview?.strokeColor ?? item.strokeColor;
  const strokeWidth = preview?.strokeWidth ?? item.strokeWidth ?? 0;
  const cornerRadius = preview?.cornerRadius ?? item.cornerRadius ?? 0;
  const direction = preview?.direction ?? item.direction ?? 'up';
  const points = preview?.points ?? item.points ?? 5;
  const innerRadius = preview?.innerRadius ?? item.innerRadius ?? 0.5;
  const shapeType = preview?.shapeType ?? item.shapeType;

  // Get dimensions with preview support for real-time gizmo scaling
  // Priority: Group preview > Single gizmo preview > Properties preview > Base transform
  let width = item.transform?.width ?? 200;
  let height = item.transform?.height ?? 200;

  const groupPreviewForItem = groupPreviewTransforms?.get(item.id);
  const isGizmoPreviewActive = activeGizmo?.itemId === item.id && previewTransform !== null;
  const propertiesPreviewForItem = propertiesPreview?.[item.id];

  if (groupPreviewForItem) {
    width = groupPreviewForItem.width;
    height = groupPreviewForItem.height;
  } else if (isGizmoPreviewActive && previewTransform) {
    width = previewTransform.width;
    height = previewTransform.height;
  } else if (propertiesPreviewForItem) {
    width = propertiesPreviewForItem.width ?? width;
    height = propertiesPreviewForItem.height ?? height;
  }

  // Common stroke props
  const strokeProps = strokeWidth > 0 && strokeColor ? {
    stroke: strokeColor,
    strokeWidth,
  } : {};

  // Check if aspect ratio is locked (for squish/squash behavior)
  // Read from preview transforms if available, otherwise from item
  let aspectLocked = item.transform?.aspectRatioLocked ?? true;
  if (groupPreviewForItem?.aspectRatioLocked !== undefined) {
    aspectLocked = groupPreviewForItem.aspectRatioLocked;
  } else if (isGizmoPreviewActive && previewTransform?.aspectRatioLocked !== undefined) {
    aspectLocked = previewTransform.aspectRatioLocked;
  } else if (propertiesPreviewForItem?.aspectRatioLocked !== undefined) {
    aspectLocked = propertiesPreviewForItem.aspectRatioLocked;
  }

  // Centering wrapper style for SVG shapes
  const centerStyle: React.CSSProperties = {
    width: '100%',
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  };

  // For shapes that need to squish/squash when aspect is unlocked,
  // we render at base size and apply CSS scale transform
  const baseSize = Math.min(width, height);
  const scaleX = aspectLocked ? 1 : width / baseSize;
  const scaleY = aspectLocked ? 1 : height / baseSize;
  const needsScale = !aspectLocked && (scaleX !== 1 || scaleY !== 1);

  const scaleStyle: React.CSSProperties = needsScale ? {
    transform: `scale(${scaleX}, ${scaleY})`,
  } : {};

  // Render appropriate shape based on shapeType
  switch (shapeType) {
    case 'rectangle':
      // Rectangle fills the entire container (naturally supports non-proportional)
      return (
        <div style={centerStyle}>
          <Rect
            width={width}
            height={height}
            fill={fillColor}
            cornerRadius={cornerRadius}
            {...strokeProps}
          />
        </div>
      );

    case 'circle': {
      // Circle: squish/squash when aspect unlocked
      const radius = baseSize / 2;
      return (
        <div style={centerStyle}>
          <div style={scaleStyle}>
            <Circle
              radius={radius}
              fill={fillColor}
              {...strokeProps}
            />
          </div>
        </div>
      );
    }

    case 'triangle': {
      // Triangle: squish/squash when aspect unlocked
      return (
        <div style={centerStyle}>
          <div style={scaleStyle}>
            <Triangle
              length={baseSize}
              direction={direction}
              fill={fillColor}
              cornerRadius={cornerRadius}
              {...strokeProps}
            />
          </div>
        </div>
      );
    }

    case 'ellipse': {
      // Ellipse naturally supports non-proportional via rx/ry
      const rx = width / 2;
      const ry = height / 2;
      return (
        <div style={centerStyle}>
          <Ellipse
            rx={rx}
            ry={ry}
            fill={fillColor}
            {...strokeProps}
          />
        </div>
      );
    }

    case 'star': {
      // Star: squish/squash when aspect unlocked
      const outerRadius = baseSize / 2;
      const innerRadiusValue = outerRadius * innerRadius;
      return (
        <div style={centerStyle}>
          <div style={scaleStyle}>
            <Star
              points={points}
              outerRadius={outerRadius}
              innerRadius={innerRadiusValue}
              fill={fillColor}
              cornerRadius={cornerRadius}
              {...strokeProps}
            />
          </div>
        </div>
      );
    }

    case 'polygon': {
      // Polygon: squish/squash when aspect unlocked
      const radius = baseSize / 2;
      return (
        <div style={centerStyle}>
          <div style={scaleStyle}>
            <Polygon
              points={points}
              radius={radius}
              fill={fillColor}
              cornerRadius={cornerRadius}
              {...strokeProps}
            />
          </div>
        </div>
      );
    }

    case 'heart': {
      // Heart: use Remotion's Heart component for consistency with mask path generation
      // Heart output width = 1.1 × input height, so we scale input to fit within baseSize
      // Using height = baseSize / 1.1 ensures output width = baseSize (fits container)
      const heartHeight = baseSize / 1.1;
      return (
        <div style={centerStyle}>
          <div style={scaleStyle}>
            <Heart
              height={heartHeight}
              fill={fillColor}
              stroke={strokeColor}
              strokeWidth={strokeWidth}
            />
          </div>
        </div>
      );
    }

    default:
      // Fallback to simple colored div for unknown types
      return (
        <div
          style={{
            width: '100%',
            height: '100%',
            backgroundColor: fillColor,
            borderRadius: cornerRadius,
          }}
        />
      );
  }
};

// Set to true to show debug overlay on video items during rendering
const DEBUG_VIDEO_OVERLAY = true;

/**
 * MaskWrapper applies clipping to content using CSS clip-path.
 * This approach is more compatible with Remotion's server-side rendering than SVG foreignObject.
 * Supports real-time preview by reading from gizmo store when masks are being transformed.
 */
const MaskWrapper: React.FC<{
  masks: MaskInfo[];
  children: React.ReactNode;
}> = ({ masks, children }) => {
  const { width: canvasWidth, height: canvasHeight } = useVideoConfig();

  // Read gizmo store for real-time mask preview during drag operations
  const activeGizmo = useGizmoStore((s) => s.activeGizmo);
  const previewTransform = useGizmoStore((s) => s.previewTransform);
  const propertiesPreview = useGizmoStore((s) => s.propertiesPreview);
  const groupPreviewTransforms = useGizmoStore((s) => s.groupPreviewTransforms);

  if (!masks || masks.length === 0) {
    return <>{children}</>;
  }

  // All masks use the first mask's type settings
  const firstMask = masks[0]!;
  const maskType = firstMask.shape.maskType ?? 'clip';
  const maskFeather = firstMask.shape.maskFeather ?? 0;
  const maskInvert = firstMask.shape.maskInvert ?? false;

  // Generate paths for all masks with rotation baked in
  // Check gizmo store for real-time preview transforms (same as ShapeContent)
  const maskPathsWithStroke = masks.map(({ shape, transform }) => {
    // Check if this mask has an active preview transform
    const groupPreviewForMask = groupPreviewTransforms?.get(shape.id);
    const isGizmoPreviewActive = activeGizmo?.itemId === shape.id && previewTransform !== null;
    const propertiesPreviewForMask = propertiesPreview?.[shape.id];

    // Priority: Group preview > Single gizmo preview > Properties preview > Base transform
    let resolvedTransform = {
      x: transform.x ?? 0,
      y: transform.y ?? 0,
      width: transform.width ?? canvasWidth,
      height: transform.height ?? canvasHeight,
      rotation: transform.rotation ?? 0,
      opacity: transform.opacity ?? 1,
    };

    if (groupPreviewForMask) {
      resolvedTransform = {
        x: groupPreviewForMask.x,
        y: groupPreviewForMask.y,
        width: groupPreviewForMask.width,
        height: groupPreviewForMask.height,
        rotation: groupPreviewForMask.rotation,
        opacity: groupPreviewForMask.opacity,
      };
    } else if (isGizmoPreviewActive && previewTransform) {
      resolvedTransform = {
        x: previewTransform.x,
        y: previewTransform.y,
        width: previewTransform.width,
        height: previewTransform.height,
        rotation: previewTransform.rotation,
        opacity: previewTransform.opacity,
      };
    } else if (propertiesPreviewForMask) {
      resolvedTransform = {
        ...resolvedTransform,
        ...propertiesPreviewForMask,
      };
    }

    let path = getShapePath(shape, resolvedTransform, {
      canvasWidth,
      canvasHeight,
    });

    // Bake rotation into path coordinates for CSS clip-path compatibility
    if (resolvedTransform.rotation !== 0) {
      const centerX = canvasWidth / 2 + resolvedTransform.x;
      const centerY = canvasHeight / 2 + resolvedTransform.y;
      path = rotatePath(path, resolvedTransform.rotation, centerX, centerY);
    }

    // Include stroke width for SVG mask rendering
    const strokeWidth = shape.strokeWidth ?? 0;

    return { path, strokeWidth };
  });

  // Extract just the paths for combining
  const maskPaths = maskPathsWithStroke.map(m => m.path);

  // Combine all mask paths into one (for multiple masks)
  const combinedPath = maskPaths.join(' ');

  // Check if any mask has stroke (need SVG mask instead of clip-path for stroke support)
  const hasStroke = maskPathsWithStroke.some(m => m.strokeWidth > 0);

  // For clip mode without stroke, use CSS clip-path which works reliably in Remotion
  // If stroke is present, fall through to SVG mask (clip-path doesn't support stroke)
  if (maskType === 'clip' && !maskInvert && maskFeather === 0 && !hasStroke) {
    // Simple clip mode - use CSS clip-path directly
    return (
      <div
        style={{
          width: '100%',
          height: '100%',
          clipPath: `path('${combinedPath}')`,
        }}
      >
        {children}
      </div>
    );
  }

  // For inverted clip without stroke, use CSS clip-path with evenodd
  if (maskType === 'clip' && maskInvert && !hasStroke) {
    // Inverted clip: show everything EXCEPT the mask area
    // Use evenodd fill rule with a full-canvas rect + the mask paths
    const invertedPath = `M 0 0 L ${canvasWidth} 0 L ${canvasWidth} ${canvasHeight} L 0 ${canvasHeight} Z ${combinedPath}`;
    return (
      <div
        style={{
          width: '100%',
          height: '100%',
          clipPath: `path(evenodd, '${invertedPath}')`,
        }}
      >
        {children}
      </div>
    );
  }

  // Alpha mask, feathering, or stroke: use inline SVG mask with CSS reference
  // SVG masks support stroke which CSS clip-path doesn't
  // Generate unique ID for this mask instance
  const maskId = `svg-mask-${masks.map(m => m.shape.id).join('-')}`;
  const filterId = `blur-${maskId}`;

  return (
    <>
      {/* Hidden SVG containing mask definition */}
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
          {maskFeather > 0 && (
            <filter id={filterId} x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation={maskFeather} />
            </filter>
          )}
          <mask
            id={maskId}
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
              fill={maskInvert ? 'white' : 'black'}
            />
            {/* Mask shapes with optional stroke */}
            {maskPathsWithStroke.map(({ path: pathD, strokeWidth }, i) => (
              <path
                key={i}
                d={pathD}
                fill={maskInvert ? 'black' : 'white'}
                stroke={strokeWidth > 0 ? (maskInvert ? 'black' : 'white') : undefined}
                strokeWidth={strokeWidth > 0 ? strokeWidth : undefined}
                filter={maskFeather > 0 ? `url(#${filterId})` : undefined}
              />
            ))}
          </mask>
        </defs>
      </svg>
      {/* Content with mask applied */}
      <div
        style={{
          width: '100%',
          height: '100%',
          mask: `url(#${maskId})`,
          WebkitMask: `url(#${maskId})`,
        }}
      >
        {children}
      </div>
    </>
  );
};

export interface ItemProps {
  item: TimelineItem;
  muted?: boolean;
  /** Active masks that should clip this item's content */
  masks?: MaskInfo[];
}

/**
 * Wrapper component that applies transform properties to visual items.
 * Uses canvas-centered positioning from transform resolver.
 * Reads preview transform directly from gizmo store to avoid prop drilling
 * and unnecessary re-renders of the parent composition.
 */
const TransformWrapper: React.FC<{
  item: TimelineItem;
  children: React.ReactNode;
}> = ({ item, children }) => {
  const { width: canvasWidth, height: canvasHeight, fps } = useVideoConfig();
  const frame = useCurrentFrame();
  const canvas = { width: canvasWidth, height: canvasHeight, fps };

  // Read preview transform directly from store - only re-renders this component
  const activeGizmo = useGizmoStore((s) => s.activeGizmo);
  const previewTransform = useGizmoStore((s) => s.previewTransform);
  const propertiesPreview = useGizmoStore((s) => s.propertiesPreview);
  const itemPropertiesPreview = useGizmoStore((s) => s.itemPropertiesPreview);
  const groupPreviewTransforms = useGizmoStore((s) => s.groupPreviewTransforms);

  // Check if this item has an active single-item gizmo preview transform
  const isGizmoPreviewActive = activeGizmo?.itemId === item.id && previewTransform !== null;

  // Check if this item has an active group preview transform
  const groupPreviewForItem = groupPreviewTransforms?.get(item.id);
  const isGroupPreviewActive = groupPreviewForItem !== undefined;

  // Check if this item has a properties panel preview
  const propertiesPreviewForItem = propertiesPreview?.[item.id];

  // Check if this item has an item properties preview (fades, etc.)
  const itemPreviewForItem = itemPropertiesPreview?.[item.id];

  // Resolve base transform from item
  const baseResolved = resolveTransform(item, canvas, getSourceDimensions(item));

  // Priority: Group preview > Single gizmo preview > Properties preview > Base
  let resolved = baseResolved;
  if (isGroupPreviewActive) {
    // Use group preview transform for multi-item drag/scale/rotate
    resolved = { ...groupPreviewForItem, cornerRadius: groupPreviewForItem.cornerRadius ?? 0 };
  } else if (isGizmoPreviewActive) {
    resolved = { ...previewTransform, cornerRadius: previewTransform.cornerRadius ?? 0 };
  } else if (propertiesPreviewForItem) {
    // Merge properties preview on top of base resolved
    resolved = { ...baseResolved, ...propertiesPreviewForItem };
  }

  // Calculate fade opacity based on fadeIn/fadeOut (in seconds)
  // Use preview values if available, otherwise use item's stored values
  // frame is relative to this item's sequence (0 = start of item)
  const fadeInSeconds = itemPreviewForItem?.fadeIn ?? item.fadeIn ?? 0;
  const fadeOutSeconds = itemPreviewForItem?.fadeOut ?? item.fadeOut ?? 0;
  const fadeInFrames = Math.min(fadeInSeconds * fps, item.durationInFrames);
  const fadeOutFrames = Math.min(fadeOutSeconds * fps, item.durationInFrames);

  let fadeOpacity = 1;
  const hasFadeIn = fadeInFrames > 0;
  const hasFadeOut = fadeOutFrames > 0;

  if (hasFadeIn || hasFadeOut) {
    const fadeOutStart = item.durationInFrames - fadeOutFrames;

    if (hasFadeIn && hasFadeOut) {
      // Both fades present
      if (fadeInFrames >= fadeOutStart) {
        // Fades overlap - crossfade: fade in then immediately fade out
        const midPoint = item.durationInFrames / 2;
        const peakOpacity = Math.min(1, midPoint / Math.max(fadeInFrames, 1));
        fadeOpacity = interpolate(
          frame,
          [0, midPoint, item.durationInFrames],
          [0, peakOpacity, 0],
          { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
        );
      } else {
        // Normal case - distinct fade in/out regions
        fadeOpacity = interpolate(
          frame,
          [0, fadeInFrames, fadeOutStart, item.durationInFrames],
          [0, 1, 1, 0],
          { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
        );
      }
    } else if (hasFadeIn) {
      // Only fade in
      fadeOpacity = interpolate(
        frame,
        [0, fadeInFrames],
        [0, 1],
        { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
      );
    } else {
      // Only fade out
      fadeOpacity = interpolate(
        frame,
        [fadeOutStart, item.durationInFrames],
        [1, 0],
        { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
      );
    }
  }

  // Combine transform opacity with fade opacity
  const finalOpacity = resolved.opacity * fadeOpacity;

  // Get CSS styles for positioning, with combined opacity
  const style = toTransformStyle({ ...resolved, opacity: finalOpacity }, canvas);

  return <div style={style}>{children}</div>;
};

/**
 * EffectWrapper applies CSS filter effects, glitch animations, and canvas-based effects to content.
 * Reads effects from item and generates appropriate styles per frame.
 * Works in both browser preview and Remotion server-side export.
 */
const EffectWrapper: React.FC<{
  item: TimelineItem;
  children: React.ReactNode;
  muted?: boolean;
}> = ({ item, children, muted = false }) => {
  const frame = useCurrentFrame();

  // Read effect preview from gizmo store (for live slider updates)
  const effectsPreview = useGizmoStore((s) => s.effectsPreview);
  const previewEffects = effectsPreview?.[item.id];

  // Use preview effects if available, otherwise use item's stored effects
  const effects: ItemEffect[] = previewEffects ?? item.effects ?? [];

  // Build CSS filter string from CSS filter effects
  // All hooks must be called unconditionally (before any early returns)
  const cssFilterString = useMemo(() => {
    if (effects.length === 0) return '';
    return effectsToCSSFilter(effects);
  }, [effects]);

  // Get glitch effects for special rendering
  const glitchEffects = useMemo(() => {
    if (effects.length === 0) return [];
    return getGlitchEffects(effects) as Array<GlitchEffect & { id: string }>;
  }, [effects]);

  // Get halftone effect for canvas-based rendering
  const halftoneEffect = useMemo(() => {
    if (effects.length === 0) return null;
    return getHalftoneEffect(effects);
  }, [effects]);

  // Memoize halftone options to prevent unnecessary re-renders in HalftoneWrapper
  const halftoneOptions = useMemo(() => {
    if (!halftoneEffect) return null;
    return {
      dotSize: halftoneEffect.dotSize,
      spacing: halftoneEffect.spacing,
      angle: halftoneEffect.angle,
      intensity: halftoneEffect.intensity,
      backgroundColor: halftoneEffect.backgroundColor,
      dotColor: halftoneEffect.dotColor,
    };
  }, [halftoneEffect]);

  // Calculate glitch-based filters (color glitch adds hue-rotate)
  const glitchFilterString = useMemo(() => {
    if (glitchEffects.length === 0) return '';
    return getGlitchFilterString(glitchEffects, frame);
  }, [glitchEffects, frame]);

  // Combine all CSS filters
  // NOTE: No early return for empty effects - we always render the same div structure
  // to prevent DOM changes when effects are added/removed (prevents re-render)
  const combinedFilter = [cssFilterString, glitchFilterString].filter(Boolean).join(' ');

  // Check for RGB split effect
  const rgbSplitEffect = glitchEffects.find((e) => e.variant === 'rgb-split');

  // Check for scanlines effect
  const scanlinesEffect = glitchEffects.find((e) => e.variant === 'scanlines');

  // Helper to wrap content with halftone effect
  // ALWAYS wraps to maintain consistent DOM structure at clip boundaries (prevents stutter)
  const wrapWithHalftone = (content: React.ReactNode): React.ReactNode => {
    // Get trim and speed info for video items (needed for in/out point export)
    const videoItem = item.type === 'video' ? (item as { sourceStart?: number; trimStart?: number; offset?: number; speed?: number; volume?: number; audioFadeIn?: number; audioFadeOut?: number }) : null;
    const trimBefore = videoItem?.sourceStart ?? videoItem?.trimStart ?? videoItem?.offset ?? 0;
    const playbackRate = videoItem?.speed ?? 1;

    return (
      <HalftoneWrapper
        options={halftoneOptions}
        enabled={!!halftoneEffect}
        itemType={item.type}
        mediaSrc={item.type === 'video' || item.type === 'image' ? (item as { src?: string }).src : undefined}
        trimBefore={trimBefore}
        playbackRate={playbackRate}
        muted={muted}
        volume={videoItem?.volume ?? 0}
        audioFadeIn={videoItem?.audioFadeIn ?? 0}
        audioFadeOut={videoItem?.audioFadeOut ?? 0}
        durationInFrames={item.durationInFrames}
      >
        {content}
      </HalftoneWrapper>
    );
  };

  // RGB split requires special multi-layer rendering
  if (rgbSplitEffect) {
    const { redOffset, blueOffset, active } = getRGBSplitStyles(
      rgbSplitEffect.intensity,
      frame,
      rgbSplitEffect.speed,
      rgbSplitEffect.seed
    );

    if (active) {
      const rgbContent = (
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
      return <>{wrapWithHalftone(rgbContent)}</>;
    }
  }

  // Standard rendering with CSS filters + optional scanlines
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

  return <>{wrapWithHalftone(standardContent)}</>;
};

/**
 * Remotion Item Component
 *
 * Renders different item types following Remotion best practices:
 * - Video: OffthreadVideo for preview (resilient to UI), @remotion/media Video for rendering
 * - Audio: Uses Audio component with trim support
 * - Image: Uses img tag
 * - Text: Renders text with styling
 * - Shape: Renders solid colors or shapes
 * - Respects mute state for audio/video items (reads directly from store for reactivity)
 * - Supports trimStart/trimEnd for media trimming (uses trimStart as trimBefore)
 *
 * Memoized to prevent unnecessary re-renders when parent (MainComposition) updates.
 */
export const Item = React.memo<ItemProps>(({ item, muted = false, masks = [] }) => {
  // Use muted prop directly - MainComposition already passes track.muted
  // Avoiding store subscription here prevents re-render issues with @remotion/media Audio

  // Helper to wrap visual content with mask if masks are present
  const wrapWithMask = (content: React.ReactNode): React.ReactNode => {
    if (masks.length === 0) return content;
    return <MaskWrapper masks={masks}>{content}</MaskWrapper>;
  };

  if (item.type === 'video') {
    // Guard against missing src (media resolution failed)
    if (!item.src) {
      return (
        <AbsoluteFill style={{ backgroundColor: '#1a1a1a', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <p style={{ color: '#666', fontSize: 14 }}>Media not loaded</p>
        </AbsoluteFill>
      );
    }
    // Use sourceStart for trimBefore (absolute position in source)
    // Fall back to trimStart or offset for backward compatibility
    const trimBefore = item.sourceStart ?? item.trimStart ?? item.offset ?? 0;
    // Get playback rate from speed property (default 1x)
    const playbackRate = item.speed ?? 1;

    // Calculate source frames needed for playback
    // Use Math.round to minimize rounding errors (ceil can exceed by 1 frame)
    const sourceFramesNeeded = Math.round(item.durationInFrames * playbackRate);
    const sourceEndPosition = trimBefore + sourceFramesNeeded;
    const sourceDuration = item.sourceDuration || 0;

    // Validate sourceStart doesn't exceed source duration
    // Use small tolerance (2 frames) for floating point rounding errors
    const tolerance = 2;
    const isInvalidSeek = sourceDuration > 0 && trimBefore >= sourceDuration;
    const exceedsSource = sourceDuration > 0 && sourceEndPosition > sourceDuration + tolerance;

    // Safety check: if sourceStart is unreasonably high (>1 hour) and no sourceDuration is set,
    // this indicates corrupted metadata from split/trim operations
    // Show error state instead of crashing Remotion
    const MAX_REASONABLE_FRAMES = 30 * 60 * 60; // 1 hour at 30fps
    const hasCorruptedMetadata = sourceDuration === 0 && trimBefore > MAX_REASONABLE_FRAMES;

    if (hasCorruptedMetadata || isInvalidSeek) {
      console.error('[Remotion Item] Invalid source position detected:', {
        itemId: item.id,
        sourceStart: item.sourceStart,
        trimBefore,
        sourceDuration,
        hasCorruptedMetadata,
        isInvalidSeek,
      });
      return (
        <AbsoluteFill style={{ backgroundColor: '#2a1a1a', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <p style={{ color: '#ff6b6b', fontSize: 14 }}>Invalid source position</p>
        </AbsoluteFill>
      );
    }

    // Clamp trimBefore to valid range if source duration is known
    let safeTrimBefore = trimBefore;
    if (sourceDuration > 0) {
      // Ensure we don't seek past the source
      const maxTrimBefore = Math.max(0, sourceDuration - sourceFramesNeeded);
      if (trimBefore > maxTrimBefore) {
        safeTrimBefore = maxTrimBefore;
      }
    }

    // If clip would exceed source even after clamping, show error
    // This happens when durationInFrames * playbackRate > sourceDuration
    if (exceedsSource && safeTrimBefore === 0 && sourceFramesNeeded > sourceDuration) {
      console.error('[Remotion Item] Clip duration exceeds source duration:', {
        itemId: item.id,
        sourceFramesNeeded,
        sourceDuration,
        durationInFrames: item.durationInFrames,
        playbackRate,
      });
      return (
        <AbsoluteFill style={{ backgroundColor: '#2a1a1a', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <p style={{ color: '#ff6b6b', fontSize: 14 }}>Clip exceeds source duration</p>
        </AbsoluteFill>
      );
    }

    const videoContent = (
      <>
        <VideoContent
          item={item}
          muted={muted}
          safeTrimBefore={safeTrimBefore}
          playbackRate={playbackRate}
        />
        {DEBUG_VIDEO_OVERLAY && (
          <DebugOverlay
            id={item.id}
            speed={playbackRate}
            trimBefore={trimBefore}
            safeTrimBefore={safeTrimBefore}
            sourceStart={item.sourceStart}
            sourceDuration={sourceDuration}
            durationInFrames={item.durationInFrames}
            sourceFramesNeeded={sourceFramesNeeded}
            sourceEndPosition={sourceEndPosition}
            isInvalidSeek={isInvalidSeek}
            exceedsSource={exceedsSource}
          />
        )}
      </>
    );

    // Always use TransformWrapper for consistent rendering between preview and export
    // resolveTransform handles defaults (fit-to-canvas) when no explicit transform is set
    return wrapWithMask(
      <TransformWrapper item={item}>
        <EffectWrapper item={item} muted={muted}>{videoContent}</EffectWrapper>
      </TransformWrapper>
    );
  }

  if (item.type === 'audio') {
    // Guard against missing src (media resolution failed)
    if (!item.src) {
      return null; // Audio can fail silently
    }

    // Use sourceStart for trimBefore (absolute position in source)
    const trimBefore = item.sourceStart ?? item.trimStart ?? item.offset ?? 0;
    // Get playback rate from speed property (default 1x)
    const playbackRate = item.speed ?? 1;

    // Use PitchCorrectedAudio for pitch-preserved playback during preview
    // and toneFrequency correction during rendering
    return (
      <PitchCorrectedAudio
        src={item.src}
        itemId={item.id}
        trimBefore={trimBefore}
        volume={item.volume ?? 0}
        playbackRate={playbackRate}
        muted={muted}
        durationInFrames={item.durationInFrames}
        audioFadeIn={item.audioFadeIn}
        audioFadeOut={item.audioFadeOut}
      />
    );
  }

  if (item.type === 'image') {
    // Guard against missing src (media resolution failed)
    if (!item.src) {
      return (
        <AbsoluteFill style={{ backgroundColor: '#1a1a1a', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <p style={{ color: '#666', fontSize: 14 }}>Image not loaded</p>
        </AbsoluteFill>
      );
    }

    // Use Remotion's Gif component for animated GIFs
    // This ensures proper frame-by-frame rendering during export
    // Check both src URL and item label (original filename) for .gif extension
    const isAnimatedGif = isGifUrl(item.src) || (item.label && item.label.toLowerCase().endsWith('.gif'));

    if (isAnimatedGif) {
      // Get playback rate from speed property (default 1x)
      const gifPlaybackRate = item.speed ?? 1;

      const gifContent = (
        <GifPlayer
          mediaId={item.mediaId!}
          src={item.src}
          fit="cover"
          playbackRate={gifPlaybackRate}
          loopBehavior="loop"
        />
      );

      // Always use TransformWrapper for consistent rendering
      return wrapWithMask(
        <TransformWrapper item={item}>
          <EffectWrapper item={item}>{gifContent}</EffectWrapper>
        </TransformWrapper>
      );
    }

    // Regular static images - use Remotion's Img component for proper loading in render mode
    const imageContent = (
      <Img
        src={item.src}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover'
        }}
      />
    );

    // Always use TransformWrapper for consistent rendering between preview and export
    return wrapWithMask(
      <TransformWrapper item={item}>
        <EffectWrapper item={item}>{imageContent}</EffectWrapper>
      </TransformWrapper>
    );
  }

  if (item.type === 'text') {
    // Always use TransformWrapper for consistent rendering between preview and export
    return wrapWithMask(
      <TransformWrapper item={item}>
        <EffectWrapper item={item}>
          <TextContent item={item} />
        </EffectWrapper>
      </TransformWrapper>
    );
  }

  if (item.type === 'shape') {
    // Always use TransformWrapper for consistent rendering between preview and export
    // ShapeContent renders the appropriate Remotion shape based on shapeType
    return wrapWithMask(
      <TransformWrapper item={item}>
        <EffectWrapper item={item}>
          <ShapeContent item={item} />
        </EffectWrapper>
      </TransformWrapper>
    );
  }

  throw new Error(`Unknown item type: ${JSON.stringify(item)}`);
});
