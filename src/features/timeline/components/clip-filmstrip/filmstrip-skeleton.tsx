import { memo, useMemo } from 'react';

// Thumbnail dimensions
const THUMBNAIL_WIDTH = 71;
const THUMBNAIL_HEIGHT = 40;
const THUMBNAIL_GAP = 2;

export interface FilmstripSkeletonProps {
  /** Width of the clip in pixels */
  clipWidth: number;
  /** Height of the skeleton (default: 40px) */
  height?: number;
}

/**
 * Filmstrip Skeleton Component
 *
 * Displays placeholder rectangles with shimmer animation while
 * filmstrip thumbnails are being generated.
 */
export const FilmstripSkeleton = memo(function FilmstripSkeleton({
  clipWidth,
  height = THUMBNAIL_HEIGHT,
}: FilmstripSkeletonProps) {
  // Calculate number of placeholder thumbnails to show
  const placeholderCount = useMemo(() => {
    const effectiveWidth = THUMBNAIL_WIDTH + THUMBNAIL_GAP;
    return Math.max(1, Math.ceil(clipWidth / effectiveWidth));
  }, [clipWidth]);

  // Generate placeholder positions
  const placeholders = useMemo(() => {
    const result: number[] = [];
    const effectiveWidth = THUMBNAIL_WIDTH + THUMBNAIL_GAP;

    for (let i = 0; i < placeholderCount; i++) {
      result.push(i * effectiveWidth);
    }

    return result;
  }, [placeholderCount]);

  // For very narrow clips, show single centered placeholder
  if (clipWidth < THUMBNAIL_WIDTH) {
    return (
      <div
        className="absolute inset-0 flex items-center justify-center overflow-hidden"
        style={{ height }}
      >
        <div
          className="filmstrip-skeleton rounded-sm"
          style={{
            width: Math.min(clipWidth - 4, THUMBNAIL_WIDTH),
            height: height - 8,
          }}
        />
      </div>
    );
  }

  return (
    <div
      className="absolute inset-0 flex items-center overflow-hidden"
      style={{ height, paddingTop: 4, paddingBottom: 4 }}
    >
      {placeholders.map((_left, index) => (
        <div
          key={index}
          className="filmstrip-skeleton rounded-sm flex-shrink-0"
          style={{
            width: THUMBNAIL_WIDTH,
            height: height - 8,
            marginLeft: index === 0 ? 0 : THUMBNAIL_GAP,
            // Stagger animation for visual interest
            animationDelay: `${(index * 0.1) % 0.5}s`,
          }}
        />
      ))}
    </div>
  );
});
