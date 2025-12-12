import { memo, useMemo } from 'react';
import { Loader2 } from 'lucide-react';
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
 * Displays spinning loaders for each thumbnail slot while filmstrip thumbnails are being generated.
 */
export const FilmstripSkeleton = memo(function FilmstripSkeleton({
  clipWidth,
  height = THUMBNAIL_HEIGHT,
  className = '',
}: FilmstripSkeletonProps) {
  const placeholderCount = useMemo(() => {
    return Math.max(1, Math.ceil(clipWidth / THUMBNAIL_WIDTH));
  }, [clipWidth]);

  const loaderSize = Math.min(20, THUMBNAIL_HEIGHT * 0.4);

  return (
    <div
      className={`absolute left-0 right-0 flex items-start overflow-hidden ${className}`}
      style={{ height }}
    >
      {Array.from({ length: placeholderCount }, (_, index) => (
        <div
          key={index}
          className="flex-shrink-0 flex items-center justify-center bg-zinc-900/50"
          style={{
            width: THUMBNAIL_WIDTH,
            height: THUMBNAIL_HEIGHT,
          }}
        >
          <Loader2
            className="animate-spin text-zinc-400"
            style={{ width: loaderSize, height: loaderSize }}
          />
        </div>
      ))}
    </div>
  );
});
