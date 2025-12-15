import { memo } from 'react';

// Waveform dimensions
const WAVEFORM_HEIGHT = 32;

export interface WaveformSkeletonProps {
  /** Width of the clip in pixels */
  clipWidth: number;
  /** Height of the skeleton (default: 32px) */
  height?: number;
  /** Optional className for positioning */
  className?: string;
}

/**
 * Waveform Skeleton Component
 *
 * Displays a subtle shimmer placeholder while waveform data is loading.
 * Uses the same animation style as filmstrip skeleton for consistency.
 */
export const WaveformSkeleton = memo(function WaveformSkeleton({
  clipWidth,
  height = WAVEFORM_HEIGHT,
  className = '',
}: WaveformSkeletonProps) {
  return (
    <div
      className={`absolute left-0 right-0 overflow-hidden bg-timeline-audio/10 ${className}`}
      style={{
        height,
        width: clipWidth,
        // Subtle shimmer effect matching filmstrip
        backgroundImage: `linear-gradient(
          90deg,
          transparent 0%,
          rgba(158, 107, 214, 0.1) 50%,
          transparent 100%
        )`,
        backgroundSize: '120px 100%',
        animation: 'filmstrip-shimmer 1.5s ease-in-out infinite',
      }}
    />
  );
});
