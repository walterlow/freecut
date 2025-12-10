import React, { useState, useCallback, useRef, useEffect } from 'react';
import { AbsoluteFill, OffthreadVideo, Img, useVideoConfig, useCurrentFrame, interpolate, useRemotionEnvironment } from 'remotion';
import { Rect, Circle, Triangle, Ellipse, Star, Polygon, Heart } from '@remotion/shapes';
import { useGizmoStore } from '@/features/preview/stores/gizmo-store';
import { usePlaybackStore } from '@/features/preview/stores/playback-store';
import type { TimelineItem, VideoItem, TextItem, ShapeItem } from '@/types/timeline';
import type { TransformProperties } from '@/types/transform';
import { DebugOverlay } from './debug-overlay';
import { PitchCorrectedAudio } from './pitch-corrected-audio';
import { GifPlayer } from './gif-player';
import { loadFont, FONT_WEIGHT_MAP } from '../utils/fonts';
import { ItemVisualWrapper } from './item-visual-wrapper';

/** Mask information passed from composition to items */
export interface MaskInfo {
  shape: ShapeItem;
  transform: TransformProperties;
}

// Track video elements that have been connected to Web Audio API
// A video element can only be connected to ONE MediaElementSourceNode ever
const connectedVideoElements = new WeakSet<HTMLVideoElement>();
// Store gain nodes by video element for volume updates
const videoGainNodes = new WeakMap<HTMLVideoElement, GainNode>();
const videoAudioContexts = new WeakMap<HTMLVideoElement, AudioContext>();

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

  // Read preview values from unified preview system
  const itemPreview = useGizmoStore(
    useCallback((s) => s.preview?.[item.id], [item.id])
  );
  const preview = itemPreview?.properties;

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
  // +20dB = 10x, -20dB = 0.1x, -60dB ≈ 0.001x
  const linearVolume = Math.pow(10, volumeDb / 20);
  // Item volume with fades - allow values > 1 for volume boost (Remotion handles via Web Audio API)
  const itemVolume = Math.max(0, linearVolume * fadeMultiplier);

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

  // Web Audio API refs for volume boost > 1 during preview
  const containerRef = useRef<HTMLDivElement | null>(null);
  const currentVideoRef = useRef<HTMLVideoElement | null>(null);

  // Set up Web Audio API when video element is available (for volume > 1 boost)
  // OffthreadVideo renders a <video> element during preview - we find it via DOM
  useEffect(() => {
    if (!containerRef.current || !env.isPlayer) return;

    // Find the video element rendered by OffthreadVideo
    const findAndConnectVideo = () => {
      const video = containerRef.current?.querySelector('video');
      if (!video) return;

      currentVideoRef.current = video;

      // Check if this video is already connected (can only connect once ever)
      if (connectedVideoElements.has(video)) {
        // Already connected - just update the gain
        const gainNode = videoGainNodes.get(video);
        const audioContext = videoAudioContexts.get(video);
        if (gainNode) {
          gainNode.gain.value = audioVolume;
        }
        if (audioContext?.state === 'suspended') {
          audioContext.resume();
        }
        return;
      }

      // Set up Web Audio API for this video element
      try {
        const audioContext = new AudioContext();
        const gainNode = audioContext.createGain();
        gainNode.gain.value = audioVolume;
        const sourceNode = audioContext.createMediaElementSource(video);
        sourceNode.connect(gainNode);
        gainNode.connect(audioContext.destination);

        // Track this video as connected
        connectedVideoElements.add(video);
        videoGainNodes.set(video, gainNode);
        videoAudioContexts.set(video, audioContext);

        // Resume if suspended (browsers require user interaction)
        if (audioContext.state === 'suspended') {
          audioContext.resume();
        }
      } catch {
        // Failed to set up Web Audio - volume boost won't work but audio still plays
      }
    };

    // Try immediately and also observe for changes
    findAndConnectVideo();
    const observer = new MutationObserver(findAndConnectVideo);
    observer.observe(containerRef.current, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      // Don't disconnect audio - video element might be reused
    };
  }, [env.isPlayer, audioVolume]);

  // Update gain node volume (allows > 1 for boost)
  useEffect(() => {
    const video = currentVideoRef.current;
    if (video) {
      const gainNode = videoGainNodes.get(video);
      const audioContext = videoAudioContexts.get(video);
      if (gainNode) {
        gainNode.gain.value = audioVolume;
      }
      if (audioContext?.state === 'suspended') {
        audioContext.resume();
      }
    }
  }, [audioVolume]);

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
      <div ref={containerRef} style={{ width: '100%', height: '100%' }}>
        <OffthreadVideo
          src={item.src!}
          trimBefore={safeTrimBefore > 0 ? safeTrimBefore : undefined}
          volume={1} // Keep at 1 - actual volume controlled via Web Audio API GainNode
          playbackRate={playbackRate}
          pauseWhenBuffering={false}
          onError={handleError}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      </div>
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
  // Note: Volume > 1 for boost is handled by Remotion internally via Web Audio API
  // For OffthreadVideo during preview, volume boost works without additional props
};

/**
 * Text content with live property preview support.
 * Reads preview values from gizmo store for real-time updates during slider/picker drag.
 */
const TextContent: React.FC<{ item: TextItem }> = ({ item }) => {
  // Read preview values from unified preview system
  const itemPreview = useGizmoStore(
    useCallback((s) => s.preview?.[item.id], [item.id])
  );
  const preview = itemPreview?.properties;

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
  // Read transform preview from gizmo store for real-time scaling
  const activeGizmo = useGizmoStore((s) => s.activeGizmo);
  const previewTransform = useGizmoStore((s) => s.previewTransform);
  // Read from unified preview system (includes transforms, properties, and effects)
  const itemPreview = useGizmoStore(
    useCallback((s) => s.preview?.[item.id], [item.id])
  );

  // Use preview values if available, otherwise use item's stored values
  const shapePropsPreview = itemPreview?.properties;
  const fillColor = shapePropsPreview?.fillColor ?? item.fillColor ?? '#3b82f6';
  const strokeColor = shapePropsPreview?.strokeColor ?? item.strokeColor;
  const strokeWidth = shapePropsPreview?.strokeWidth ?? item.strokeWidth ?? 0;
  const cornerRadius = shapePropsPreview?.cornerRadius ?? item.cornerRadius ?? 0;
  const direction = shapePropsPreview?.direction ?? item.direction ?? 'up';
  const points = shapePropsPreview?.points ?? item.points ?? 5;
  const innerRadius = shapePropsPreview?.innerRadius ?? item.innerRadius ?? 0.5;
  const shapeType = shapePropsPreview?.shapeType ?? item.shapeType;

  // Get dimensions with preview support for real-time gizmo scaling
  // Priority: Unified preview (group/properties) > Single gizmo preview > Base transform
  let width = item.transform?.width ?? 200;
  let height = item.transform?.height ?? 200;

  const itemPreviewTransform = itemPreview?.transform;
  const isGizmoPreviewActive = activeGizmo?.itemId === item.id && previewTransform !== null;

  if (itemPreviewTransform) {
    width = itemPreviewTransform.width ?? width;
    height = itemPreviewTransform.height ?? height;
  } else if (isGizmoPreviewActive && previewTransform) {
    width = previewTransform.width;
    height = previewTransform.height;
  }

  // Common stroke props
  const strokeProps = strokeWidth > 0 && strokeColor ? {
    stroke: strokeColor,
    strokeWidth,
  } : {};

  // Check if aspect ratio is locked (for squish/squash behavior)
  // Read from preview transforms if available, otherwise from item
  let aspectLocked = item.transform?.aspectRatioLocked ?? true;
  if (itemPreviewTransform?.aspectRatioLocked !== undefined) {
    aspectLocked = itemPreviewTransform.aspectRatioLocked;
  } else if (isGizmoPreviewActive && previewTransform?.aspectRatioLocked !== undefined) {
    aspectLocked = previewTransform.aspectRatioLocked;
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
const DEBUG_VIDEO_OVERLAY = false;

export interface ItemProps {
  item: TimelineItem;
  muted?: boolean;
  /** Active masks that should clip this item's content */
  masks?: MaskInfo[];
}

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

    // Use new ItemVisualWrapper for consolidated state and fixed DOM structure
    // resolveTransform handles defaults (fit-to-canvas) when no explicit transform is set
    return (
      <ItemVisualWrapper item={item} masks={masks}>
        {videoContent}
      </ItemVisualWrapper>
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

      // Use new ItemVisualWrapper for consolidated state and fixed DOM structure
      return (
        <ItemVisualWrapper item={item} masks={masks}>
          {gifContent}
        </ItemVisualWrapper>
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

    // Use new ItemVisualWrapper for consolidated state and fixed DOM structure
    return (
      <ItemVisualWrapper item={item} masks={masks}>
        {imageContent}
      </ItemVisualWrapper>
    );
  }

  if (item.type === 'text') {
    // Use new ItemVisualWrapper for consolidated state and fixed DOM structure
    return (
      <ItemVisualWrapper item={item} masks={masks}>
        <TextContent item={item} />
      </ItemVisualWrapper>
    );
  }

  if (item.type === 'shape') {
    // Use new ItemVisualWrapper for consolidated state and fixed DOM structure
    // ShapeContent renders the appropriate Remotion shape based on shapeType
    return (
      <ItemVisualWrapper item={item} masks={masks}>
        <ShapeContent item={item} />
      </ItemVisualWrapper>
    );
  }

  throw new Error(`Unknown item type: ${JSON.stringify(item)}`);
});
