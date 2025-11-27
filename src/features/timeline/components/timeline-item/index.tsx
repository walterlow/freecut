import { useRef, useEffect, useMemo, memo, useCallback, useState } from 'react';
import type { TimelineItem as TimelineItemType } from '@/types/timeline';
import { useTimelineZoom } from '../../hooks/use-timeline-zoom';
import { useTimelineStore } from '../../stores/timeline-store';
import { useSelectionStore } from '@/features/editor/stores/selection-store';
import { useTimelineDrag, dragOffsetRef } from '../../hooks/use-timeline-drag';
import { useTimelineTrim } from '../../hooks/use-timeline-trim';
import { useRateStretch } from '../../hooks/use-rate-stretch';
import { useClipVisibility } from '../../hooks/use-clip-visibility';
import { DRAG_OPACITY } from '../../constants';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { canJoinItems, canJoinMultipleItems } from '@/utils/clip-utils';
import { ClipFilmstrip } from '../clip-filmstrip';
import { ClipWaveform } from '../clip-waveform';
import {
  CLIP_HEIGHT,
  CLIP_LABEL_HEIGHT,
  VIDEO_FILMSTRIP_HEIGHT,
  VIDEO_WAVEFORM_HEIGHT,
  AUDIO_WAVEFORM_HEIGHT,
} from '@/constants/timeline';

// Width in pixels for edge hover detection (trim/rate-stretch handles)
const EDGE_HOVER_ZONE = 8;

export interface TimelineItemProps {
  item: TimelineItemType;
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
export const TimelineItem = memo(function TimelineItem({ item, timelineDuration = 30, trackLocked = false }: TimelineItemProps) {
  const { timeToPixels, pixelsToFrame } = useTimelineZoom();
  const selectedItemIds = useSelectionStore((s) => s.selectedItemIds);
  const selectItems = useSelectionStore((s) => s.selectItems);
  const activeTool = useSelectionStore((s) => s.activeTool);
  const splitItem = useTimelineStore((s) => s.splitItem);
  const joinItems = useTimelineStore((s) => s.joinItems);
  const removeItems = useTimelineStore((s) => s.removeItems);
  const rippleDeleteItems = useTimelineStore((s) => s.rippleDeleteItems);
  // Access items via getState() in callbacks to avoid re-renders when items array changes
  // const items = useTimelineStore((s) => s.items);

  const isSelected = selectedItemIds.includes(item.id);

  // Use ref for activeTool to avoid callback recreation on mode changes (prevents playback lag)
  const activeToolRef = useRef(activeTool);
  activeToolRef.current = activeTool;

  // Track which edge is being hovered for showing trim/rate-stretch handles
  const [hoveredEdge, setHoveredEdge] = useState<'start' | 'end' | null>(null);

  // Drag-and-drop functionality (local state for anchor item) - disabled if track is locked
  const { isDragging, dragOffset, handleDragStart } = useTimelineDrag(item, timelineDuration, trackLocked);

  // Trim functionality - disabled if track is locked
  const { isTrimming, trimHandle, trimDelta, handleTrimStart } = useTimelineTrim(item, timelineDuration, trackLocked);

  // Rate stretch functionality - disabled if track is locked
  const { isStretching, stretchHandle, handleStretchStart, getVisualFeedback } = useRateStretch(item, timelineDuration, trackLocked);

  // Granular selector: only re-render when THIS item's drag participation changes
  const isPartOfMultiDrag = useSelectionStore(
    useCallback(
      (s) => s.dragState?.isDragging && s.dragState.draggedItemIds.includes(item.id),
      [item.id]
    )
  );

  // Granular selector: check if Alt key is held during drag (for duplication indicator)
  const isAltDrag = useSelectionStore(
    useCallback(
      (s) => s.dragState?.isDragging && s.dragState.draggedItemIds.includes(item.id) && s.dragState.isAltDrag,
      [item.id]
    )
  );

  // Check if this item is part of a multi-drag (but not the anchor)
  const isPartOfDrag = isPartOfMultiDrag && !isDragging;

  // Ref for transform style (updated via RAF for smooth dragging without re-renders)
  const transformRef = useRef<HTMLDivElement>(null);
  const ghostRef = useRef<HTMLDivElement>(null); // Ghost element for alt-drag followers
  const wasDraggingRef = useRef(false);

  // Visibility detection for lazy filmstrip loading
  const isClipVisible = useClipVisibility(transformRef);

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
  // During alt-drag, items stay in place (no transform applied) but ghost follows cursor
  useEffect(() => {
    if (!isPartOfDrag || !transformRef.current) return;

    let rafId: number;
    const updateTransform = () => {
      if (transformRef.current && isPartOfDrag) {
        const offset = dragOffsetRef.current;

        // During alt-drag, keep items in place (no transform/opacity change)
        if (isAltDrag) {
          transformRef.current.style.transform = '';
          transformRef.current.style.opacity = '';
          transformRef.current.style.transition = 'none';
          transformRef.current.style.pointerEvents = 'none';

          // Update ghost position for alt-drag (ghost is a sibling, needs absolute positioning)
          if (ghostRef.current) {
            ghostRef.current.style.transform = `translate(${offset.x}px, ${offset.y}px)`;
            ghostRef.current.style.display = 'block';
          }
        } else {
          transformRef.current.style.transform = `translate(${offset.x}px, ${offset.y}px)`;
          transformRef.current.style.opacity = String(DRAG_OPACITY);
          transformRef.current.style.transition = 'none';
          transformRef.current.style.pointerEvents = 'none';

          // Hide ghost during normal drag
          if (ghostRef.current) {
            ghostRef.current.style.display = 'none';
          }
        }
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
      // Hide ghost
      if (ghostRef.current) {
        ghostRef.current.style.display = 'none';
      }
    };
  }, [isPartOfDrag, isAltDrag]);

  // Determine if this item is being dragged (anchor or follower)
  const isBeingDragged = isDragging || isPartOfDrag;

  // Get visual feedback for rate stretch
  const stretchFeedback = isStretching ? getVisualFeedback() : null;

  // Check if this is a media item (video/audio) that supports rate stretch
  const isMediaItem = item.type === 'video' || item.type === 'audio';

  // Current speed for badge display
  const currentSpeed = item.speed || 1;

  // Get FPS for frame-to-time conversion
  const fps = useTimelineStore((s) => s.fps);

  // Calculate position and width (convert frames to seconds, then to pixels)
  // Round both left AND right positions to prevent gaps/overlaps at certain zoom levels.
  // We derive width from (right - left) to ensure adjacent clips share exact pixel boundaries.
  const left = Math.round(timeToPixels(item.from / fps));
  const right = Math.round(timeToPixels((item.from + item.durationInFrames) / fps));
  const width = right - left;

  // Calculate trim visual feedback (convert frames to pixels for preview)
  const minWidthPixels = timeToPixels(1 / fps); // Minimum 1 frame width
  const trimDeltaPixels = isTrimming ? timeToPixels(trimDelta / fps) : 0;

  // Get source boundaries for clamping (in source frames)
  const currentSourceStart = item.sourceStart || 0;
  const sourceDuration = item.sourceDuration || (item.durationInFrames * currentSpeed);
  const currentSourceEnd = item.sourceEnd || sourceDuration;

  // Clamp visual feedback to prevent showing invalid states
  let trimVisualLeft = left;
  let trimVisualWidth = width;

  if (isTrimming) {
    if (trimHandle === 'start') {
      // Start handle: adjust both position and width
      // Convert source frames to timeline frames (source / speed = timeline)
      const maxExtendTimelineFrames = currentSourceStart / currentSpeed;
      const maxExtendPixels = timeToPixels(maxExtendTimelineFrames / fps);

      // Prevent trimming more than available (keep at least 1 timeline frame)
      const maxTrimPixels = width - minWidthPixels;

      // Clamp delta considering both constraints
      const clampedDelta = Math.max(
        -maxExtendPixels, // Don't extend past source start
        Math.min(maxTrimPixels, trimDeltaPixels) // Don't trim too much
      );

      trimVisualLeft = Math.round(left + clampedDelta);
      trimVisualWidth = Math.round(width - clampedDelta);
    } else {
      // End handle: adjust width only
      // Convert source frames to timeline frames (source / speed = timeline)
      const maxExtendSourceFrames = sourceDuration - currentSourceEnd;
      const maxExtendTimelineFrames = maxExtendSourceFrames / currentSpeed;
      const maxExtendPixels = timeToPixels(maxExtendTimelineFrames / fps);

      // Prevent trimming more than available (keep at least 1 timeline frame)
      const maxTrimPixels = width - minWidthPixels;

      // Clamp delta considering both constraints
      const clampedDelta = Math.max(
        -maxExtendPixels, // Don't extend past source end
        Math.min(maxTrimPixels, -trimDeltaPixels) // Don't trim too much (note: trimDelta is negative for extending)
      );

      trimVisualWidth = Math.round(width - clampedDelta);
    }
  }

  // Calculate stretch visual feedback
  let stretchVisualLeft = trimVisualLeft;
  let stretchVisualWidth = trimVisualWidth;

  if (isStretching && stretchFeedback) {
    // Use same left/right rounding approach for consistent boundaries
    stretchVisualLeft = Math.round(timeToPixels(stretchFeedback.from / fps));
    const stretchVisualRight = Math.round(timeToPixels((stretchFeedback.from + stretchFeedback.duration) / fps));
    stretchVisualWidth = stretchVisualRight - stretchVisualLeft;
  }

  // Get color based on item type (using timeline theme colors) - memoized
  const itemColorClasses = useMemo(() => {
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
  }, [item.type]);

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();

    // Don't allow interaction on locked tracks
    if (trackLocked) {
      return;
    }

    // Razor tool: split item at click position
    if (activeTool === 'razor') {
      const rect = e.currentTarget.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const clickOffsetFrames = pixelsToFrame(clickX);
      const splitFrame = Math.round(item.from + clickOffsetFrames);

      // Perform split
      splitItem(item.id, splitFrame);
      return;
    }

    // Selection tool: handle item selection
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

  // Handle mouse move to detect edge hover for trim/rate-stretch handles
  // Use ref for activeTool to prevent callback recreation on mode changes (prevents playback lag)
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (trackLocked || activeToolRef.current === 'razor') {
      setHoveredEdge(null);
      return;
    }

    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const itemWidth = rect.width;

    if (x <= EDGE_HOVER_ZONE) {
      setHoveredEdge('start');
    } else if (x >= itemWidth - EDGE_HOVER_ZONE) {
      setHoveredEdge('end');
    } else {
      setHoveredEdge(null);
    }
  }, [trackLocked]); // Stable - reads activeTool from ref

  // Determine cursor class based on tool, state, and edge hover
  const cursorClass = trackLocked
    ? 'cursor-not-allowed opacity-60'
    : activeTool === 'razor'
    ? 'cursor-scissors'
    : hoveredEdge !== null && (activeTool === 'select' || activeTool === 'rate-stretch')
    ? 'cursor-ew-resize'
    : isBeingDragged
    ? 'cursor-grabbing'
    : 'cursor-grab';

  // Check if join is available when multiple items are selected
  // Read items from store to avoid re-renders during playback
  const canJoinSelected = useMemo(() => {
    if (selectedItemIds.length < 2) return false;
    const items = useTimelineStore.getState().items;
    const selectedItems = selectedItemIds
      .map((id) => items.find((i) => i.id === id))
      .filter((i): i is NonNullable<typeof i> => i !== undefined);
    return canJoinMultipleItems(selectedItems);
  }, [selectedItemIds]);

  // Subscribe to adjacent neighbors for join indicator updates
  // Uses a selector that only returns the neighbor info we need, minimizing re-renders
  const leftNeighbor = useTimelineStore(
    useCallback(
      (s) => s.items.find(
        (other) =>
          other.id !== item.id &&
          other.trackId === item.trackId &&
          other.from + other.durationInFrames === item.from
      ),
      [item.id, item.trackId, item.from]
    )
  );

  const rightNeighbor = useTimelineStore(
    useCallback(
      (s) => s.items.find(
        (other) =>
          other.id !== item.id &&
          other.trackId === item.trackId &&
          other.from === item.from + item.durationInFrames
      ),
      [item.id, item.trackId, item.from, item.durationInFrames]
    )
  );

  // Check if this clip has a joinable neighbor on the left (this clip is the "right" one)
  const hasJoinableLeft = useMemo(() => {
    if (!leftNeighbor) return false;
    return canJoinItems(leftNeighbor, item);
  }, [leftNeighbor, item]);

  // Check if this clip has a joinable neighbor on the right (this clip is the "left" one)
  const hasJoinableRight = useMemo(() => {
    if (!rightNeighbor) return false;
    return canJoinItems(item, rightNeighbor);
  }, [rightNeighbor, item]);

  // For context menu: can join if this clip has any joinable neighbor
  const canJoinFromContextMenu = hasJoinableLeft || hasJoinableRight;

  // Handle join action for multiple selected clips
  const handleJoinSelected = useCallback(() => {
    if (selectedItemIds.length >= 2) {
      const items = useTimelineStore.getState().items;
      const selectedItems = selectedItemIds
        .map((id) => items.find((i) => i.id === id))
        .filter((i): i is NonNullable<typeof i> => i !== undefined);
      if (canJoinMultipleItems(selectedItems)) {
        joinItems(selectedItemIds);
      }
    }
  }, [selectedItemIds, joinItems]);

  // Handle join with left neighbor
  const handleJoinLeft = useCallback(() => {
    if (leftNeighbor) {
      joinItems([leftNeighbor.id, item.id]);
    }
  }, [joinItems, leftNeighbor, item.id]);

  // Handle join with right neighbor
  const handleJoinRight = useCallback(() => {
    if (rightNeighbor) {
      joinItems([item.id, rightNeighbor.id]);
    }
  }, [joinItems, rightNeighbor, item.id]);

  // Handle delete action
  const handleDelete = useCallback(() => {
    if (selectedItemIds.length > 0) {
      removeItems(selectedItemIds);
    }
  }, [selectedItemIds, removeItems]);

  // Handle ripple delete action (delete + close gap)
  const handleRippleDelete = useCallback(() => {
    if (selectedItemIds.length > 0) {
      rippleDeleteItems(selectedItemIds);
    }
  }, [selectedItemIds, rippleDeleteItems]);

  return (
    <>
    <ContextMenu>
      <ContextMenuTrigger asChild disabled={trackLocked}>
    <div
      ref={transformRef}
      data-item-id={item.id}
      className={`
        absolute inset-y-0 rounded overflow-hidden
        ${itemColorClasses}
        ${cursorClass}
        ${!isBeingDragged && !isStretching && !trackLocked && 'hover:brightness-110'}
      `}
      style={{
        left: isStretching ? `${stretchVisualLeft}px` : isTrimming ? `${trimVisualLeft}px` : `${left}px`,
        width: isStretching ? `${stretchVisualWidth}px` : isTrimming ? `${trimVisualWidth}px` : `${width}px`,
        // Anchor item uses its own dragOffset, followers get updated via RAF
        // During alt-drag, original stays in place (no transform) - only show ghost
        transform: isDragging && !isAltDrag ? `translate(${dragOffset.x}px, ${dragOffset.y}px)` : undefined,
        opacity: isDragging && !isAltDrag ? DRAG_OPACITY : trackLocked ? 0.6 : 1,
        pointerEvents: isDragging ? 'none' : 'auto',
        // Browser-native virtualization - skip rendering off-screen items without removing from DOM
        contentVisibility: 'auto',
        containIntrinsicSize: `0 ${CLIP_HEIGHT}px`,
      }}
      onClick={handleClick}
      onMouseDown={trackLocked || isTrimming || isStretching || activeTool === 'razor' || activeTool === 'rate-stretch' || hoveredEdge !== null ? undefined : handleDragStart}
      onMouseMove={handleMouseMove}
      onMouseLeave={() => setHoveredEdge(null)}
    >
      {/* Selection indicator - inset to prevent overlap with adjacent clips */}
      {isSelected && !trackLocked && (
        <div
          className="absolute inset-0 rounded pointer-events-none z-20 ring-2 ring-inset ring-primary"
        />
      )}

      {/* Video clip 3-row layout: label | filmstrip | waveform */}
      {item.type === 'video' && item.mediaId && (
        <div className="absolute inset-0 flex flex-col">
          {/* Row 1: Label */}
          <div
            className="px-2 text-[11px] font-medium truncate"
            style={{ height: CLIP_LABEL_HEIGHT, lineHeight: `${CLIP_LABEL_HEIGHT}px` }}
          >
            {item.label}
          </div>
          {/* Row 2: Filmstrip */}
          <div className="relative overflow-hidden" style={{ height: VIDEO_FILMSTRIP_HEIGHT }}>
            <ClipFilmstrip
              mediaId={item.mediaId}
              clipWidth={isStretching ? stretchVisualWidth : isTrimming ? trimVisualWidth : width}
              sourceStart={(item.sourceStart ?? 0) / fps}
              sourceDuration={(item.sourceDuration ?? item.durationInFrames) / fps}
              trimStart={(item.trimStart ?? 0) / fps}
              speed={item.speed ?? 1}
              fps={fps}
              isVisible={isClipVisible}
              height={VIDEO_FILMSTRIP_HEIGHT}
              className="top-0"
            />
          </div>
          {/* Row 3: Waveform */}
          <div className="relative overflow-hidden" style={{ height: VIDEO_WAVEFORM_HEIGHT }}>
            <ClipWaveform
              mediaId={item.mediaId}
              clipWidth={isStretching ? stretchVisualWidth : isTrimming ? trimVisualWidth : width}
              sourceStart={(item.sourceStart ?? 0) / fps}
              sourceDuration={(item.sourceDuration ?? item.durationInFrames) / fps}
              trimStart={(item.trimStart ?? 0) / fps}
              speed={item.speed ?? 1}
              fps={fps}
              isVisible={isClipVisible}
              height={VIDEO_WAVEFORM_HEIGHT}
              className="top-0"
            />
          </div>
        </div>
      )}

      {/* Audio clip 2-row layout: label | waveform */}
      {item.type === 'audio' && item.mediaId && (
        <div className="absolute inset-0 flex flex-col">
          {/* Row 1: Label */}
          <div
            className="px-2 text-[11px] font-medium truncate"
            style={{ height: CLIP_LABEL_HEIGHT, lineHeight: `${CLIP_LABEL_HEIGHT}px` }}
          >
            {item.label}
          </div>
          {/* Row 2: Waveform */}
          <div className="relative overflow-hidden" style={{ height: AUDIO_WAVEFORM_HEIGHT }}>
            <ClipWaveform
              mediaId={item.mediaId}
              clipWidth={isStretching ? stretchVisualWidth : isTrimming ? trimVisualWidth : width}
              sourceStart={(item.sourceStart ?? 0) / fps}
              sourceDuration={(item.sourceDuration ?? item.durationInFrames) / fps}
              trimStart={(item.trimStart ?? 0) / fps}
              speed={item.speed ?? 1}
              fps={fps}
              isVisible={isClipVisible}
              height={AUDIO_WAVEFORM_HEIGHT}
              className="top-0"
            />
          </div>
        </div>
      )}

      {/* Item label - only for non-media items (video/audio have labels in flex layout) */}
      {item.type !== 'video' && item.type !== 'audio' && (
        <div className="px-2 py-1 text-xs font-medium truncate">
          {item.label}
        </div>
      )}

      {/* Speed badge - show when speed is not 1x */}
      {currentSpeed !== 1 && !isStretching && (
        <div className="absolute top-1 right-1 px-1 py-0.5 text-[10px] font-bold bg-black/60 text-white rounded font-mono">
          {currentSpeed >= 1 ? `${currentSpeed.toFixed(1)}x` : `${currentSpeed.toFixed(2)}x`}
        </div>
      )}

      {/* Preview speed overlay during stretch */}
      {isStretching && stretchFeedback && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/50 pointer-events-none z-10">
          <span className="text-white font-mono text-sm font-bold">
            {stretchFeedback.speed.toFixed(2)}x
          </span>
        </div>
      )}

      {/* Trim handles - show on edge hover or while actively trimming */}
      {!trackLocked && activeTool === 'select' && (
        <>
          {/* Left trim handle - w-2 (8px) matches EDGE_HOVER_ZONE */}
          {(hoveredEdge === 'start' || (isTrimming && trimHandle === 'start')) && (
            <div
              className="absolute left-0 top-0 bottom-0 w-2 bg-primary cursor-ew-resize"
              onMouseDown={(e) => handleTrimStart(e, 'start')}
            />
          )}
          {/* Right trim handle - w-2 (8px) matches EDGE_HOVER_ZONE */}
          {(hoveredEdge === 'end' || (isTrimming && trimHandle === 'end')) && (
            <div
              className="absolute right-0 top-0 bottom-0 w-2 bg-primary cursor-ew-resize"
              onMouseDown={(e) => handleTrimStart(e, 'end')}
            />
          )}
        </>
      )}

      {/* Rate stretch handles - show on edge hover or while actively stretching */}
      {!trackLocked && activeTool === 'rate-stretch' && isMediaItem && (
        <>
          {/* Left stretch handle - w-2 (8px) matches EDGE_HOVER_ZONE */}
          {(hoveredEdge === 'start' || (isStretching && stretchHandle === 'start')) && (
            <div
              className="absolute left-0 top-0 bottom-0 w-2 bg-orange-500 cursor-ew-resize"
              onMouseDown={(e) => handleStretchStart(e, 'start')}
            />
          )}
          {/* Right stretch handle - w-2 (8px) matches EDGE_HOVER_ZONE */}
          {(hoveredEdge === 'end' || (isStretching && stretchHandle === 'end')) && (
            <div
              className="absolute right-0 top-0 bottom-0 w-2 bg-orange-500 cursor-ew-resize"
              onMouseDown={(e) => handleStretchStart(e, 'end')}
            />
          )}
        </>
      )}

      {/* Join indicator - glowing edge when clip can be joined with neighbor */}
      {/* Hidden when hovering edge (to not interfere with trim/stretch handles) */}
      {hasJoinableLeft && !trackLocked && hoveredEdge !== 'start' && !isTrimming && !isStretching && (
        <div
          className="absolute left-0 top-0 bottom-0 w-px bg-green-400 shadow-[0_0_6px_1px_rgba(74,222,128,0.7)] pointer-events-none"
          title="Can join with previous clip (J)"
        />
      )}
      {hasJoinableRight && !trackLocked && hoveredEdge !== 'end' && !isTrimming && !isStretching && (
        <div
          className="absolute right-0 top-0 bottom-0 w-px bg-green-400 shadow-[0_0_6px_1px_rgba(74,222,128,0.7)] pointer-events-none"
          title="Can join with next clip (J)"
        />
      )}

    </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        {/* Show "Join Selected" when multiple clips are selected and joinable */}
        {canJoinSelected && (
          <ContextMenuItem onClick={handleJoinSelected}>
            Join Selected
            <ContextMenuShortcut>J</ContextMenuShortcut>
          </ContextMenuItem>
        )}
        {/* Show directional join options for single clip with joinable neighbors */}
        {!canJoinSelected && hasJoinableLeft && (
          <ContextMenuItem onClick={handleJoinLeft}>
            Join with Previous
          </ContextMenuItem>
        )}
        {!canJoinSelected && hasJoinableRight && (
          <ContextMenuItem onClick={handleJoinRight}>
            Join with Next
          </ContextMenuItem>
        )}
        {(canJoinSelected || canJoinFromContextMenu) && <ContextMenuSeparator />}
        <ContextMenuItem
          onClick={handleRippleDelete}
          disabled={selectedItemIds.length === 0}
          className="text-destructive focus:text-destructive"
        >
          Ripple Delete
          <ContextMenuShortcut>Ctrl+Del</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem
          onClick={handleDelete}
          disabled={selectedItemIds.length === 0}
          className="text-destructive focus:text-destructive"
        >
          Delete
          <ContextMenuShortcut>Del</ContextMenuShortcut>
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>

      {/* Alt-drag ghost for anchor item: rendered outside clipped container */}
      {isAltDrag && isDragging && (
        <div
          className="absolute inset-y-0 rounded border-2 border-dashed border-primary bg-primary/20 pointer-events-none z-50"
          style={{
            left: `${left + dragOffset.x}px`,
            width: `${width}px`,
            transform: `translateY(${dragOffset.y}px)`,
          }}
        >
          {/* Duplication indicator on ghost */}
          <div className="absolute -top-1 -right-1 w-5 h-5 bg-primary rounded-full flex items-center justify-center text-xs font-bold text-primary-foreground shadow-md">
            +
          </div>
        </div>
      )}

      {/* Alt-drag ghost for follower items: updated via RAF, rendered outside clipped container */}
      {isPartOfDrag && (
        <div
          ref={ghostRef}
          className="absolute inset-y-0 rounded border-2 border-dashed border-primary bg-primary/20 pointer-events-none z-50"
          style={{
            left: `${left}px`,
            width: `${width}px`,
            display: 'none',
          }}
        >
          {/* Duplication indicator on ghost */}
          <div className="absolute -top-1 -right-1 w-5 h-5 bg-primary rounded-full flex items-center justify-center text-xs font-bold text-primary-foreground shadow-md">
            +
          </div>
        </div>
      )}
    </>
  );
}, (prevProps, nextProps) => {
  // Custom equality check - only re-render when relevant props change
  return (
    prevProps.item.id === nextProps.item.id &&
    prevProps.item.from === nextProps.item.from &&
    prevProps.item.durationInFrames === nextProps.item.durationInFrames &&
    prevProps.item.trackId === nextProps.item.trackId &&
    prevProps.item.type === nextProps.item.type &&
    prevProps.item.label === nextProps.item.label &&
    prevProps.item.mediaId === nextProps.item.mediaId &&
    prevProps.item.sourceStart === nextProps.item.sourceStart &&
    prevProps.item.sourceEnd === nextProps.item.sourceEnd &&
    prevProps.item.sourceDuration === nextProps.item.sourceDuration &&
    prevProps.item.trimStart === nextProps.item.trimStart &&
    prevProps.item.speed === nextProps.item.speed &&
    prevProps.timelineDuration === nextProps.timelineDuration &&
    prevProps.trackLocked === nextProps.trackLocked
  );
});
