import { memo } from 'react';
import { cn } from '@/shared/ui/cn';

interface StretchHandlesProps {
  trackLocked: boolean;
  isAnyDragActive: boolean;
  isStretching: boolean;
  stretchHandle: 'start' | 'end' | null;
  activeTool: string;
  hoveredEdge: 'start' | 'end' | null;
  isMediaItem: boolean;
  onStretchStart: (e: React.MouseEvent, handle: 'start' | 'end') => void;
}

/**
 * Rate stretch handles for media items
 * Renders left and right stretch handles for adjusting playback speed
 */
export const StretchHandles = memo(function StretchHandles({
  trackLocked,
  isAnyDragActive,
  isStretching,
  stretchHandle,
  activeTool,
  hoveredEdge,
  isMediaItem,
  onStretchStart,
}: StretchHandlesProps) {
  const showLeftHandle = !trackLocked &&
    (!isAnyDragActive || isStretching) &&
    activeTool === 'rate-stretch' &&
    isMediaItem &&
    (hoveredEdge === 'start' || (isStretching && stretchHandle === 'start'));

  const showRightHandle = !trackLocked &&
    (!isAnyDragActive || isStretching) &&
    activeTool === 'rate-stretch' &&
    isMediaItem &&
    (hoveredEdge === 'end' || (isStretching && stretchHandle === 'end'));

  return (
    <>
      {/* Left stretch handle - w-2 (8px) matches EDGE_HOVER_ZONE */}
      <div
        className={cn(
          "absolute left-0 top-0 bottom-0 w-2 bg-orange-500 cursor-ew-resize transition-opacity duration-75",
          showLeftHandle ? "opacity-100" : "opacity-0 pointer-events-none"
        )}
        onMouseDown={(e) => onStretchStart(e, 'start')}
      />

      {/* Right stretch handle - w-2 (8px) matches EDGE_HOVER_ZONE */}
      <div
        className={cn(
          "absolute right-0 top-0 bottom-0 w-2 bg-orange-500 cursor-ew-resize transition-opacity duration-75",
          showRightHandle ? "opacity-100" : "opacity-0 pointer-events-none"
        )}
        onMouseDown={(e) => onStretchStart(e, 'end')}
      />
    </>
  );
});

