/**
 * NativeAudioLayer.tsx - Native audio rendering layer using custom AudioTrackManager
 *
 * This component provides an alternative to Composition's audio rendering,
 * using HTMLAudioElement with Web Audio API for better control.
 *
 * Features:
 * - Web Audio API for volume boost (>1x via GainNode)
 * - Pitch preservation when changing playback rate
 * - Preloading for smooth playback
 * - Works with the Clock system for timing
 * - Master volume and mute controls
 *
 * Usage:
 * Replace Composition's Audio rendering in MainComposition with NativeAudioLayer
 * when you want to use native audio rendering.
 */

import React, { useMemo } from 'react';
import { AudioTrackManager } from './AudioTrackManager';
import type { AudioItemData } from './types';
import type { AudioItem } from '@/types/timeline';

/**
 * Enriched audio item from MainComposition
 */
type EnrichedAudioItem = AudioItem & {
  muted: boolean;
  trackVisible: boolean;
};

interface NativeAudioLayerProps {
  /** All audio items to render */
  items: EnrichedAudioItem[];
  /** Current frame position */
  currentFrame: number;
  /** Timeline FPS */
  fps: number;
  /** Whether playback is active */
  isPlaying: boolean;
  /** Playback rate */
  playbackRate?: number;
  /** Master volume (0-1) */
  masterVolume?: number;
  /** Whether master is muted */
  masterMuted?: boolean;
  /** Number of frames to preload ahead (default: 5 seconds) */
  preloadAheadFrames?: number;
  /** Number of frames to keep loaded behind (default: 1 second) */
  preloadBehindFrames?: number;
  /** Called when an audio encounters an error */
  onAudioError?: (itemId: string, error: Error) => void;
}

/**
 * Convert EnrichedAudioItem to AudioItemData for AudioTrackManager
 */
function convertToAudioItemData(item: EnrichedAudioItem): AudioItemData {
  return {
    id: item.id,
    src: item.src ?? '',
    from: item.from,
    durationInFrames: item.durationInFrames,
    // sourceStart is in frames in the timeline, convert appropriately
    sourceStart: item.sourceStart,
    sourceEnd: item.sourceEnd,
    sourceDuration: item.sourceDuration,
    speed: item.speed,
    volume: item.volume,
    audioFadeIn: item.audioFadeIn,
    audioFadeOut: item.audioFadeOut,
    muted: item.muted,
    trackVisible: item.trackVisible,
  };
}

/**
 * NativeAudioLayer Component
 *
 * A drop-in replacement for Composition's audio rendering that uses native
 * HTMLAudioElement with Web Audio API for better control.
 */
export const NativeAudioLayer: React.FC<NativeAudioLayerProps> = ({
  items,
  currentFrame,
  fps,
  isPlaying,
  playbackRate = 1,
  masterVolume = 1,
  masterMuted = false,
  preloadAheadFrames,
  preloadBehindFrames,
  onAudioError,
}) => {
  // Convert items to AudioItemData format
  const audioItems = useMemo(
    () => items.filter((item) => item.src).map((item) => convertToAudioItemData(item)),
    [items]
  );

  return (
    <AudioTrackManager
      items={audioItems}
      currentFrame={currentFrame}
      fps={fps}
      isPlaying={isPlaying}
      playbackRate={playbackRate}
      masterVolume={masterVolume}
      masterMuted={masterMuted}
      preloadAheadFrames={preloadAheadFrames}
      preloadBehindFrames={preloadBehindFrames}
      onAudioError={onAudioError}
    />
  );
};

NativeAudioLayer.displayName = 'NativeAudioLayer';

export default NativeAudioLayer;
