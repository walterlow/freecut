import { useRef, useEffect } from 'react';
import type { TimelineItem } from '@/types/timeline';
import { useTimelineZoom } from '../../hooks/use-timeline-zoom';
import { useTimelineStore } from '../../stores/timeline-store';
import { useSelectionStore } from '@/features/editor/stores/selection-store';
import { useTimelineDrag, dragOffsetRef } from '../../hooks/use-timeline-drag';
import { useTimelineTrim } from '../../hooks/use-timeline-trim';
import { DRAG_OPACITY } from '../../constants';

export interface TimelineItemProps {
  item: TimelineItem;
  timelineDuration?: number;
  trackLocked?: boolean;
}

/**
 * Timeline Item Component
 *
 * Renders an individual item on the timeline with full interaction support:
 * - Positioned based on start frame (from)
 * - Width based on duration in frames
 * - Visual styling based on item type
 * - Selection state
 * - Click to select
 * - Drag to move (horizontal and vertical)
 * - Trim handles (start/end) for media trimming
 * - Grid snapping support
 *
 * Trim functionality:
 * - Start handle: trims from beginning, adjusts position and duration
 * - End handle: trims from end, adjusts duration only
 * - Stores trimStart, trimEnd, sourceStart, sourceEnd for each item
 */
export function TimelineItem({ item, timelineDuration = 30, trackLocked = false }: TimelineItemProps) {
  const { timeToPixels } = useTimelineZoom();
  const selectedItemIds = useSelectionStore((s) => s.selectedItemIds);
  const selectItems = useSelectionStore((s) => s.selectItems);
  const dragState = useSelectionStore((s) => s.dragState);

  const isSelected = selectedItemIds.includes(item.id);

  // Drag-and-drop functionality (local state for anchor item) - disabled if track is locked
  const { isDragging, dragOffset, handleDragStart } = useTimelineDrag(item, timelineDuration, trackLocked);

  // Trim functionality - disabled if track is locked
  const { isTrimming, trimHandle, trimDelta, handleTrimStart } = useTimelineTrim(item, trackLocked);

  // Check if this item is part of a multi-drag (but not the anchor)
  const isPartOfDrag = dragState?.isDragging && dragState.draggedItemIds.includes(item.id) && !isDragging;

  // Ref for transform style (updated via RAF for smooth dragging without re-renders)
  const transformRef = useRef<HTMLDivElement>(null);
  const wasDraggingRef = useRef(false);

  // Disable transition when anchor item drag ends to avoid animation
  useEffect(() => {
    if (wasDraggingRef.current && !isDragging && transformRef.current) {
      // Drag just ended - disable transition temporarily
      transformRef.current.style.transition = 'none';
      requestAnimationFrame(() => {
        if (transformRef.current) {
          transformRef.current.style.transition = '';
        }
      });
    }
    wasDraggingRef.current = isDragging;
  }, [isDragging]);

  // Use RAF to update transform for items being dragged along (not the anchor)
  useEffect(() => {
    if (!isPartOfDrag || !transformRef.current) return;

    let rafId: number;
    const updateTransform = () => {
      if (transformRef.current && isPartOfDrag) {
        const offset = dragOffsetRef.current;
        transformRef.current.style.transform = `translate(${offset.x}px, ${offset.y}px)`;
        transformRef.current.style.opacity = String(DRAG_OPACITY);
        transformRef.current.style.transition = 'none';
        transformRef.current.style.pointerEvents = 'none';
        rafId = requestAnimationFrame(updateTransform);
      }
    };

    rafId = requestAnimationFrame(updateTransform);
    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      // Reset styles when drag ends
      if (transformRef.current) {
        transformRef.current.style.transition = 'none';
        transformRef.current.style.transform = '';
        transformRef.current.style.opacity = '';
        transformRef.current.style.pointerEvents = '';
        // Re-enable transitions after position updates (next frame)
        requestAnimationFrame(() => {
          if (transformRef.current) {
            transformRef.current.style.transition = '';
          }
        });
      }
    };
  }, [isPartOfDrag]);

  // Determine if this item is being dragged (anchor or follower)
  const isBeingDragged = isDragging || isPartOfDrag;

  // Get FPS for frame-to-time conversion
  const fps = useTimelineStore((s) => s.fps);

  // Calculate position and width (convert frames to seconds, then to pixels)
  const left = timeToPixels(item.from / fps);
  const width = timeToPixels(item.durationInFrames / fps);

  // Calculate trim visual feedback (convert frames to pixels for preview)
  const minWidthPixels = timeToPixels(1 / fps); // Minimum 1 frame width
  const trimDeltaPixels = isTrimming ? timeToPixels(trimDelta / fps) : 0;

  // Get source boundaries for clamping
  const currentSourceStart = item.sourceStart || 0;
  const sourceDuration = item.sourceDuration || item.durationInFrames;
  const currentSourceEnd = item.sourceEnd || sourceDuration;

  // Clamp visual feedback to prevent showing invalid states
  let trimVisualLeft = left;
  let trimVisualWidth = width;

  if (isTrimming) {
    if (trimHandle === 'start') {
      // Start handle: adjust both position and width
      // Prevent extending before source start (currentSourceStart + trimDelta < 0)
      const maxExtendFrames = currentSourceStart; // Can extend up to frame 0
      const maxExtendPixels = timeToPixels(maxExtendFrames / fps);

      // Prevent trimming more than available
      const maxTrimPixels = width - minWidthPixels;

      // Clamp delta considering both constraints
      const clampedDelta = Math.max(
        -maxExtendPixels, // Don't extend past source start
        Math.min(maxTrimPixels, trimDeltaPixels) // Don't trim too much
      );

      trimVisualLeft = left + clampedDelta;
      trimVisualWidth = width - clampedDelta;
    } else {
      // End handle: adjust width only
      // Prevent extending beyond source duration (currentSourceEnd - trimDelta > sourceDuration)
      const maxExtendFrames = sourceDuration - currentSourceEnd; // Can extend up to source duration
      const maxExtendPixels = timeToPixels(maxExtendFrames / fps);

      // Prevent trimming more than available
      const maxTrimPixels = width - minWidthPixels;

      // Clamp delta considering both constraints
      const clampedDelta = Math.max(
        -maxExtendPixels, // Don't extend past source end
        Math.min(maxTrimPixels, -trimDeltaPixels) // Don't trim too much (note: trimDelta is negative for extending)
      );

      trimVisualWidth = width - clampedDelta;
    }
  }

  // Get color based on item type (using timeline theme colors)
  const getItemColor = () => {
    switch (item.type) {
      case 'video':
        return 'bg-timeline-video/30 border-timeline-video';
      case 'audio':
        return 'bg-timeline-audio/30 border-timeline-audio';
      case 'image':
        return 'bg-timeline-image/30 border-timeline-image';
      case 'text':
        return 'bg-timeline-text/30 border-timeline-text';
      case 'shape':
        return 'bg-timeline-shape/30 border-timeline-shape';
      default:
        return 'bg-timeline-video/30 border-timeline-video';
    }
  };

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();

    // Don't allow selection on locked tracks
    if (trackLocked) {
      return;
    }

    if (e.metaKey || e.ctrlKey) {
      // Multi-select: add to selection
      if (isSelected) {
        selectItems(selectedItemIds.filter((id) => id !== item.id));
      } else {
        selectItems([...selectedItemIds, item.id]);
      }
    } else {
      // Single select
      selectItems([item.id]);
    }
  };

  return (
    <div
      ref={transformRef}
      data-item-id={item.id}
      className={`
        absolute top-2 h-12 rounded overflow-hidden transition-all
        ${getItemColor()}
        ${isSelected && !trackLocked ? 'ring-2 ring-primary ring-offset-1 ring-offset-background' : ''}
        ${trackLocked ? 'cursor-not-allowed opacity-60' : isBeingDragged ? 'cursor-grabbing' : 'cursor-grab'}
        ${!isBeingDragged && !trackLocked && 'hover:brightness-110'}
      `}
      style={{
        left: isTrimming ? `${trimVisualLeft}px` : `${left}px`,
        width: isTrimming ? `${trimVisualWidth}px` : `${width}px`,
        // Anchor item uses its own dragOffset, followers get updated via RAF
        transform: isDragging ? `translate(${dragOffset.x}px, ${dragOffset.y}px)` : undefined,
        opacity: isDragging ? DRAG_OPACITY : trackLocked ? 0.6 : 1,
        transition: isDragging || isTrimming ? 'none' : 'all 0.2s',
        pointerEvents: isDragging ? 'none' : 'auto',
      }}
      onClick={handleClick}
      onMouseDown={trackLocked || isTrimming ? undefined : handleDragStart}
    >
      {/* Item label */}
      <div className="px-2 py-1 text-xs font-medium text-primary-foreground truncate">
        {item.label}
      </div>

      {/* Trim handles - disabled on locked tracks */}
      {isSelected && !trackLocked && (
        <>
          {/* Left trim handle */}
          <div
            className="absolute left-0 top-0 bottom-0 w-1 bg-primary cursor-ew-resize"
            onMouseDown={(e) => handleTrimStart(e, 'start')}
          />
          {/* Right trim handle */}
          <div
            className="absolute right-0 top-0 bottom-0 w-1 bg-primary cursor-ew-resize"
            onMouseDown={(e) => handleTrimStart(e, 'end')}
          />
        </>
      )}
    </div>
  );
}
