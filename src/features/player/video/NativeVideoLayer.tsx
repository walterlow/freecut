/**
 * NativeVideoLayer.tsx - Native video rendering layer using VideoSourcePool
 *
 * This component provides an alternative to Remotion's video rendering,
 * using HTMLVideoElement directly for better control over playback.
 *
 * Features:
 * - Element reuse by source URL (split clips share elements)
 * - Frame-accurate seeking via requestVideoFrameCallback
 * - Web Audio API for volume boost (>1x)
 * - Preloading for smooth playback
 * - Works with the Clock system for timing
 *
 * Usage:
 * Replace StableVideoSequence with NativeVideoLayer in MainComposition
 * when you want to use native video rendering instead of Remotion.
 */

import React, { useMemo } from 'react';
import { PooledVideoLayer } from './PooledVideoLayer';
import type { VideoItemData } from './types';
import type { VideoItem } from '@/types/timeline';

/**
 * Enriched video item from MainComposition
 */
type EnrichedVideoItem = VideoItem & {
  zIndex: number;
  muted: boolean;
  trackOrder: number;
  trackVisible: boolean;
};

interface NativeVideoLayerProps {
  /** All video items to render */
  items: EnrichedVideoItem[];
  /** Current frame position */
  currentFrame: number;
  /** Timeline FPS */
  fps: number;
  /** Whether playback is active */
  isPlaying: boolean;
  /** Playback rate */
  playbackRate?: number;
  /** Number of frames to preload ahead (default: 5 seconds) */
  preloadAheadFrames?: number;
  /** Number of frames to keep loaded behind (default: 1 second) */
  preloadBehindFrames?: number;
  /** Called when a video encounters an error */
  onVideoError?: (itemId: string, error: Error) => void;
}

/**
 * Convert EnrichedVideoItem to VideoItemData for PooledVideoLayer
 */
function convertToVideoItemData(item: EnrichedVideoItem): VideoItemData {
  return {
    id: item.id,
    src: item.src ?? '',
    from: item.from,
    durationInFrames: item.durationInFrames,
    sourceStart: item.sourceStart,
    sourceEnd: item.sourceEnd,
    sourceDuration: item.sourceDuration,
    speed: item.speed,
    volume: item.volume,
    audioFadeIn: item.audioFadeIn,
    audioFadeOut: item.audioFadeOut,
    muted: item.muted,
    zIndex: item.zIndex,
    trackOrder: item.trackOrder,
    trackVisible: item.trackVisible,
  };
}

/**
 * NativeVideoLayer Component
 *
 * A drop-in replacement for StableVideoSequence that uses native
 * HTMLVideoElement rendering with source pooling for efficiency.
 *
 * Split clips from the same source file share video elements,
 * dramatically reducing memory usage and improving performance.
 */
export const NativeVideoLayer: React.FC<NativeVideoLayerProps> = ({
  items,
  currentFrame,
  fps,
  isPlaying,
  playbackRate = 1,
  preloadAheadFrames,
  preloadBehindFrames,
  onVideoError,
}) => {
  // Convert items to VideoItemData format (filter out items without src)
  const videoClips = useMemo(
    () => items.filter((item) => item.src).map(convertToVideoItemData),
    [items]
  );

  return (
    <PooledVideoLayer
      clips={videoClips}
      currentFrame={currentFrame}
      fps={fps}
      isPlaying={isPlaying}
      playbackRate={playbackRate}
      preloadAheadFrames={preloadAheadFrames}
      preloadBehindFrames={preloadBehindFrames}
      onClipError={onVideoError}
    />
  );
};

NativeVideoLayer.displayName = 'NativeVideoLayer';

export default NativeVideoLayer;
