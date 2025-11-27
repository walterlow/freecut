import { memo, useMemo } from 'react';

// Waveform dimensions
const WAVEFORM_HEIGHT = 32;
const BAR_WIDTH = 2;
const BAR_GAP = 1;

// Predefined bar heights for organic feel
const BAR_PATTERNS = [
  [0.3, 0.5, 0.7, 0.4, 0.6, 0.8, 0.5, 0.3, 0.6, 0.4],
  [0.4, 0.6, 0.5, 0.7, 0.4, 0.6, 0.8, 0.6, 0.4, 0.5],
  [0.5, 0.7, 0.6, 0.4, 0.8, 0.5, 0.7, 0.4, 0.6, 0.5],
  [0.6, 0.4, 0.7, 0.5, 0.6, 0.4, 0.7, 0.8, 0.5, 0.6],
];

export interface WaveformSkeletonProps {
  /** Width of the clip in pixels */
  clipWidth: number;
  /** Height of the skeleton (default: 32px) */
  height?: number;
}

/**
 * Waveform Skeleton Component
 *
 * Displays placeholder bars with pulse animation while
 * waveform data is being generated.
 */
export const WaveformSkeleton = memo(function WaveformSkeleton({
  clipWidth,
  height = WAVEFORM_HEIGHT,
}: WaveformSkeletonProps) {
  // Calculate number of placeholder bars
  const barCount = useMemo(() => {
    const effectiveWidth = BAR_WIDTH + BAR_GAP;
    return Math.max(3, Math.floor(clipWidth / effectiveWidth));
  }, [clipWidth]);

  // Generate bar heights using patterns
  const bars = useMemo(() => {
    const patternIndex = Math.floor(Math.random() * BAR_PATTERNS.length);
    const pattern = BAR_PATTERNS[patternIndex] ?? BAR_PATTERNS[0]!;
    const result: number[] = [];

    for (let i = 0; i < barCount; i++) {
      result.push(pattern[i % pattern.length] ?? 0.5);
    }

    return result;
  }, [barCount]);

  // For very narrow clips, show simplified view
  if (clipWidth < 20) {
    return (
      <div
        className="absolute inset-0 flex items-center justify-center overflow-hidden"
        style={{ height }}
      >
        <div
          className="waveform-skeleton-bar rounded-sm bg-timeline-audio/30"
          style={{
            width: BAR_WIDTH,
            height: height * 0.5,
          }}
        />
      </div>
    );
  }

  return (
    <div
      className="absolute inset-0 flex items-center justify-center overflow-hidden"
      style={{ height }}
    >
      <div className="flex items-center gap-px">
        {bars.map((barHeight, index) => (
          <div
            key={index}
            className="waveform-skeleton-bar rounded-sm bg-timeline-audio/30"
            style={{
              width: BAR_WIDTH,
              height: Math.round(height * barHeight),
              // Stagger animation for wave effect
              // @ts-expect-error CSS custom property
              '--bar-index': index,
              animationDelay: `${(index * 0.05) % 0.6}s`,
            }}
          />
        ))}
      </div>
    </div>
  );
});
