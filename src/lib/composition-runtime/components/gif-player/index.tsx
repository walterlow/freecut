import React, { useMemo } from 'react';
import { AbsoluteFill, useSequenceContext } from '@/features/player/composition';
import { useVideoConfig } from '../../hooks/use-player-compat';
import { useGifFrames } from '../../../../features/timeline/hooks/use-gif-frames';
import { GifCanvas } from './gif-canvas';

export interface GifPlayerProps {
  /** Media ID for cache lookup */
  mediaId: string;
  /** Blob URL for the GIF file */
  src: string;
  /** How to fit the GIF within the container */
  fit?: 'cover' | 'contain' | 'fill';
  /** Playback speed multiplier */
  playbackRate?: number;
  /** Loop behavior */
  loopBehavior?: 'loop' | 'pause-at-end';
  /** Additional styles */
  style?: React.CSSProperties;
}

/**
 * Custom GIF Player
 *
 * Pre-extracts GIF frames for:
 * - Lag-free scrubbing via O(1) frame lookup
 * - Memory-efficient caching
 * - IndexedDB persistence
 */
export const GifPlayer: React.FC<GifPlayerProps> = ({
  mediaId,
  src,
  fit = 'cover',
  playbackRate = 1,
  loopBehavior = 'loop',
  style,
}) => {
  // Get local frame from Sequence context (0-based within this Sequence)
  const sequenceContext = useSequenceContext();
  const currentFrame = sequenceContext?.localFrame ?? 0;
  const { fps } = useVideoConfig();

  const { getFrameAtTime, totalDuration, isLoading, isComplete, frames, error } = useGifFrames({
    mediaId,
    blobUrl: src,
    isVisible: true,
    enabled: true,
  });

  // Calculate which GIF frame to show based on current timeline frame
  const gifFrame = useMemo(() => {
    if (!frames || frames.length === 0 || !totalDuration) {
      return null;
    }

    // Convert timeline frame to milliseconds
    const timeMs = (currentFrame / fps) * 1000 * playbackRate;

    // Handle loop behavior
    let effectiveTimeMs: number;
    if (loopBehavior === 'loop') {
      effectiveTimeMs = timeMs % totalDuration;
    } else {
      // Pause at end - clamp to last frame
      effectiveTimeMs = Math.min(timeMs, totalDuration - 1);
    }

    return getFrameAtTime(effectiveTimeMs);
  }, [currentFrame, fps, frames, totalDuration, playbackRate, loopBehavior, getFrameAtTime]);

  // Loading state
  if (isLoading || !isComplete || !frames || frames.length === 0) {
    return (
      <AbsoluteFill
        style={{
          backgroundColor: '#1a1a1a',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          ...style,
        }}
      >
        {error ? (
          <span style={{ color: '#ff6b6b', fontSize: 14 }}>GIF load failed</span>
        ) : (
          <span style={{ color: '#666', fontSize: 14 }}>Loading GIF...</span>
        )}
      </AbsoluteFill>
    );
  }

  return (
    <AbsoluteFill style={style}>
      <GifCanvas frame={gifFrame} fit={fit} />
    </AbsoluteFill>
  );
};
