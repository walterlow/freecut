import { memo } from 'react';
import { THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT } from '@/features/timeline/constants';

export interface FilmstripSkeletonProps {
  /** Width of the clip in pixels */
  clipWidth: number;
  /** Height of the skeleton (defaults to THUMBNAIL_HEIGHT from constants) */
  height?: number;
  /** Optional className for positioning */
  className?: string;
}

/**
 * Filmstrip Skeleton Component
 *
 * Displays empty placeholder slots while filmstrip thumbnails are loading.
 * Uses a subtle gradient to indicate loading without visual noise from spinners.
 */
export const FilmstripSkeleton = memo(function FilmstripSkeleton({
  clipWidth,
  height = THUMBNAIL_HEIGHT,
  className = '',
}: FilmstripSkeletonProps) {
  return (
    <div
      className={`absolute left-0 right-0 overflow-hidden bg-zinc-900/30 ${className}`}
      style={{
        height,
        width: clipWidth,
        // Subtle shimmer effect using CSS animation
        backgroundImage: `linear-gradient(
          90deg,
          transparent 0%,
          rgba(255,255,255,0.03) 50%,
          transparent 100%
        )`,
        backgroundSize: `${THUMBNAIL_WIDTH * 2}px 100%`,
        animation: 'filmstrip-shimmer 1.5s ease-in-out infinite',
      }}
    />
  );
});
