import React from 'react';
import { AbsoluteFill, OffthreadVideo, useVideoConfig, useCurrentFrame, interpolate } from 'remotion';
import { useGizmoStore } from '@/features/preview/stores/gizmo-store';
import type { TimelineItem, VideoItem } from '@/types/timeline';
import { DebugOverlay } from './debug-overlay';
import { PitchCorrectedAudio } from './pitch-corrected-audio';
import { GifPlayer } from './gif-player';
import {
  resolveTransform,
  getSourceDimensions,
  toTransformStyle,
} from '../utils/transform-resolver';

/**
 * Hook to calculate video audio volume with fades and preview support.
 * Returns the final volume (0-1) to apply to OffthreadVideo.
 */
function useVideoAudioVolume(item: VideoItem, muted: boolean): number {
  const { fps } = useVideoConfig();
  const frame = useCurrentFrame();

  // Read preview values from gizmo store
  const itemPropertiesPreview = useGizmoStore((s) => s.itemPropertiesPreview);
  const preview = itemPropertiesPreview?.[item.id];

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
  return Math.max(0, Math.min(1, linearVolume * fadeMultiplier));
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
 */
const VideoContent: React.FC<{
  item: VideoItem;
  muted: boolean;
  safeTrimBefore: number;
  playbackRate: number;
}> = ({ item, muted, safeTrimBefore, playbackRate }) => {
  const audioVolume = useVideoAudioVolume(item, muted);

  return (
    <OffthreadVideo
      src={item.src!}
      trimBefore={safeTrimBefore > 0 ? safeTrimBefore : undefined}
      volume={audioVolume}
      playbackRate={playbackRate}
      pauseWhenBuffering={false}
      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
    />
  );
};

// Set to true to show debug overlay on video items during rendering
const DEBUG_VIDEO_OVERLAY = false;

export interface ItemProps {
  item: TimelineItem;
  muted?: boolean;
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

  // Check if this item has an active gizmo preview transform
  const isGizmoPreviewActive = activeGizmo?.itemId === item.id && previewTransform !== null;

  // Check if this item has a properties panel preview
  const propertiesPreviewForItem = propertiesPreview?.[item.id];

  // Check if this item has an item properties preview (fades, etc.)
  const itemPreviewForItem = itemPropertiesPreview?.[item.id];

  // Resolve base transform from item
  const baseResolved = resolveTransform(item, canvas, getSourceDimensions(item));

  // Use gizmo preview if active, otherwise merge properties preview if available
  let resolved = baseResolved;
  if (isGizmoPreviewActive) {
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
 * Remotion Item Component
 *
 * Renders different item types following Remotion best practices:
 * - Video: Uses OffthreadVideo for better performance with trim support
 * - Audio: Uses Audio component with trim support
 * - Image: Uses img tag
 * - Text: Renders text with styling
 * - Shape: Renders solid colors or shapes
 * - Respects mute state for audio/video items (reads directly from store for reactivity)
 * - Supports trimStart/trimEnd for media trimming (uses trimStart as trimBefore)
 */
export const Item: React.FC<ItemProps> = ({ item, muted = false }) => {
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
        console.warn('[Remotion Item] trimBefore exceeds valid range, clamping:', {
          original: trimBefore,
          clamped: maxTrimBefore,
          sourceDuration,
          sourceFramesNeeded,
        });
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
    return <TransformWrapper item={item}>{videoContent}</TransformWrapper>;
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
      return <TransformWrapper item={item}>{gifContent}</TransformWrapper>;
    }

    // Regular static images
    const imageContent = (
      <img
        src={item.src}
        alt=""
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover'
        }}
      />
    );

    // Always use TransformWrapper for consistent rendering between preview and export
    return <TransformWrapper item={item}>{imageContent}</TransformWrapper>;
  }

  if (item.type === 'text') {
    const textContent = (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <h1
          style={{
            fontSize: item.fontSize || 60,
            fontFamily: item.fontFamily || 'Arial, sans-serif',
            color: item.color,
            textAlign: 'center',
          }}
        >
          {item.text}
        </h1>
      </div>
    );

    // Always use TransformWrapper for consistent rendering between preview and export
    return <TransformWrapper item={item}>{textContent}</TransformWrapper>;
  }

  if (item.type === 'shape') {
    const shapeContent = (
      <div
        style={{
          width: '100%',
          height: '100%',
          backgroundColor: item.fillColor
        }}
      />
    );

    // Always use TransformWrapper for consistent rendering between preview and export
    return <TransformWrapper item={item}>{shapeContent}</TransformWrapper>;
  }

  throw new Error(`Unknown item type: ${JSON.stringify(item)}`);
};
