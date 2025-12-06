import { useRef, useEffect, useMemo, memo, useCallback, useState } from 'react';
import type { TimelineItem as TimelineItemType } from '@/types/timeline';
import { useTimelineZoom } from '../../hooks/use-timeline-zoom';
import { useTimelineStore } from '../../stores/timeline-store';
import { useSelectionStore } from '@/features/editor/stores/selection-store';
import { useMediaLibraryStore } from '@/features/media-library/stores/media-library-store';
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
import { cn } from '@/lib/utils';
import { ClipFilmstrip } from '../clip-filmstrip';
import { ClipWaveform } from '../clip-waveform';
import { Link2Off } from 'lucide-react';
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
  const { timeToPixels, pixelsToFrame, pixelsPerSecond } = useTimelineZoom();

  // Granular selector: only re-render when THIS item's selection state changes
  const isSelected = useSelectionStore(
    useCallback((s) => s.selectedItemIds.includes(item.id), [item.id])
  );

  // Granular selector: check if this item's media is broken (missing/permission denied)
  const isBroken = useMediaLibraryStore(
    useCallback(
      (s) => (item.mediaId ? s.brokenMediaIds.includes(item.mediaId) : false),
      [item.mediaId]
    )
  );

  // Use refs for actions to avoid selector re-renders - read from store in callbacks
  const activeTool = useSelectionStore((s) => s.activeTool);

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

  // Track global drag state via ref subscription to avoid re-renders on ALL clips
  // when ANY drag starts/stops - this is a major performance optimization
  const isAnyDragActiveRef = useRef(false);
  useEffect(() => {
    return useSelectionStore.subscribe((state) => {
      isAnyDragActiveRef.current = !!state.dragState?.isDragging;
    });
  }, []);

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
          // Elevate follower clips above other clips during drag
          transformRef.current.style.zIndex = '50';

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
        transformRef.current.style.zIndex = '';
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

  // Ref for drag state to avoid callback recreation (prevents playback lag)
  const isBeingDraggedRef = useRef(isBeingDragged);
  isBeingDraggedRef.current = isBeingDragged;


  // Get visual feedback for rate stretch
  const stretchFeedback = isStretching ? getVisualFeedback() : null;

  // Check if this is a media item (video/audio/gif) that supports rate stretch
  // GIFs are animated images that can have their playback speed adjusted
  const isGifImage = item.type === 'image' && item.label?.toLowerCase().endsWith('.gif');
  const isMediaItem = item.type === 'video' || item.type === 'audio' || isGifImage;

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

  // Items that can extend infinitely (no source duration limit)
  // - Images/GIFs: can loop
  // - Text/Shapes/Adjustments: no source media, just duration
  const canExtendInfinitely = item.type === 'image' || item.type === 'text' || item.type === 'shape' || item.type === 'adjustment';

  // Clamp visual feedback to prevent showing invalid states
  let trimVisualLeft = left;
  let trimVisualWidth = width;

  if (isTrimming) {
    if (trimHandle === 'start') {
      // Start handle: adjust both position and width
      // For infinitely extensible items, only limit by timeline frame 0
      // For media items, also clamp to source start
      const maxExtendBySource = canExtendInfinitely ? Infinity : (currentSourceStart / currentSpeed);
      const maxExtendByTimeline = item.from; // Can't go before frame 0
      const maxExtendTimelineFrames = Math.min(maxExtendBySource, maxExtendByTimeline);
      const maxExtendPixels = timeToPixels(maxExtendTimelineFrames / fps);

      // Prevent trimming more than available (keep at least 1 timeline frame)
      const maxTrimPixels = width - minWidthPixels;

      // Clamp delta considering both constraints
      const clampedDelta = Math.max(
        -maxExtendPixels, // Don't extend past source start or frame 0
        Math.min(maxTrimPixels, trimDeltaPixels) // Don't trim too much
      );

      trimVisualLeft = Math.round(left + clampedDelta);
      trimVisualWidth = Math.round(width - clampedDelta);
    } else {
      // End handle: adjust width only
      // For infinitely extensible items, allow unlimited extension
      // For media items, clamp to source duration
      const maxExtendSourceFrames = canExtendInfinitely ? Infinity : (sourceDuration - currentSourceEnd);
      const maxExtendTimelineFrames = maxExtendSourceFrames / currentSpeed;
      const maxExtendPixels = canExtendInfinitely ? Infinity : timeToPixels(maxExtendTimelineFrames / fps);

      // Prevent trimming more than available (keep at least 1 timeline frame)
      const maxTrimPixels = width - minWidthPixels;

      // Clamp delta considering both constraints
      const clampedDelta = Math.max(
        -maxExtendPixels, // Don't extend past source end (or infinite for extensible items)
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
      case 'adjustment':
        return 'bg-purple-500/30 border-purple-400';
      default:
        return 'bg-timeline-video/30 border-timeline-video';
    }
  }, [item.type]);

  const handleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();

    // Don't allow interaction on locked tracks
    if (trackLocked) {
      return;
    }

    // Razor tool: split item at click position
    if (activeToolRef.current === 'razor') {
      const rect = e.currentTarget.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const clickOffsetFrames = pixelsToFrame(clickX);
      const splitFrame = Math.round(item.from + clickOffsetFrames);

      // Perform split - use getState() to avoid selector
      useTimelineStore.getState().splitItem(item.id, splitFrame);
      return;
    }

    // Selection tool: handle item selection - read current selection from store
    const { selectedItemIds, selectItems } = useSelectionStore.getState();
    if (e.metaKey || e.ctrlKey) {
      // Multi-select: add to selection
      if (selectedItemIds.includes(item.id)) {
        selectItems(selectedItemIds.filter((id) => id !== item.id));
      } else {
        selectItems([...selectedItemIds, item.id]);
      }
    } else {
      // Single select
      selectItems([item.id]);
    }
  }, [trackLocked, pixelsToFrame, item.from, item.id]);

  // Handle mouse move to detect edge hover for trim/rate-stretch handles
  // Use ref for activeTool to prevent callback recreation on mode changes (prevents playback lag)
  // Use ref for hoveredEdge to avoid re-renders when value hasn't changed
  const hoveredEdgeRef = useRef(hoveredEdge);
  hoveredEdgeRef.current = hoveredEdge;

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    // Don't show trim handles while any clip is being dragged
    if (trackLocked || activeToolRef.current === 'razor' || isAnyDragActiveRef.current) {
      if (hoveredEdgeRef.current !== null) setHoveredEdge(null);
      return;
    }

    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const itemWidth = rect.width;

    if (x <= EDGE_HOVER_ZONE) {
      if (hoveredEdgeRef.current !== 'start') setHoveredEdge('start');
    } else if (x >= itemWidth - EDGE_HOVER_ZONE) {
      if (hoveredEdgeRef.current !== 'end') setHoveredEdge('end');
    } else {
      if (hoveredEdgeRef.current !== null) setHoveredEdge(null);
    }
  }, [trackLocked]); // Stable - reads activeTool, isBeingDragged, and hoveredEdge from refs

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
  // Computed on demand via callback, not reactive - prevents re-renders on selection change
  const getCanJoinSelected = useCallback(() => {
    const selectedItemIds = useSelectionStore.getState().selectedItemIds;
    if (selectedItemIds.length < 2) return false;
    const items = useTimelineStore.getState().items;
    const selectedItems = selectedItemIds
      .map((id) => items.find((i) => i.id === id))
      .filter((i): i is NonNullable<typeof i> => i !== undefined);
    return canJoinMultipleItems(selectedItems);
  }, []);

  // Track item count on this track for neighbor detection
  // Uses a lightweight count + boundaries check instead of full string signature
  const trackItemCount = useTimelineStore(
    useCallback(
      (s) => s.items.filter(i => i.trackId === item.trackId).length,
      [item.trackId]
    )
  );

  // Track neighbor speeds so join indicators update when neighbor's speed changes
  // This is needed because canJoinItems checks if speeds match
  const neighborSpeeds = useTimelineStore(
    useCallback(
      (s) => {
        const left = s.items.find(
          (other) =>
            other.id !== item.id &&
            other.trackId === item.trackId &&
            other.from + other.durationInFrames === item.from
        );
        const right = s.items.find(
          (other) =>
            other.id !== item.id &&
            other.trackId === item.trackId &&
            other.from === item.from + item.durationInFrames
        );
        // Return a stable string key that changes when neighbor speeds change
        return `${left?.speed ?? 1}|${right?.speed ?? 1}`;
      },
      [item.id, item.trackId, item.from, item.durationInFrames]
    )
  );

  // Neighbor calculation for join indicators
  // Re-computes when this item changes OR when track items change OR when neighbor speeds change
  const { leftNeighbor, rightNeighbor, hasJoinableLeft, hasJoinableRight } = useMemo(() => {
    const items = useTimelineStore.getState().items;

    const left = items.find(
      (other) =>
        other.id !== item.id &&
        other.trackId === item.trackId &&
        other.from + other.durationInFrames === item.from
    ) ?? null;

    const right = items.find(
      (other) =>
        other.id !== item.id &&
        other.trackId === item.trackId &&
        other.from === item.from + item.durationInFrames
    ) ?? null;

    return {
      leftNeighbor: left,
      rightNeighbor: right,
      hasJoinableLeft: left ? canJoinItems(left, item) : false,
      hasJoinableRight: right ? canJoinItems(item, right) : false,
    };
  }, [item, trackItemCount, neighborSpeeds]);

  // For context menu: can join if this clip has any joinable neighbor
  const canJoinFromContextMenu = hasJoinableLeft || hasJoinableRight;

  // Handle join action for multiple selected clips
  const handleJoinSelected = useCallback(() => {
    const selectedItemIds = useSelectionStore.getState().selectedItemIds;
    if (selectedItemIds.length >= 2) {
      const items = useTimelineStore.getState().items;
      const selectedItems = selectedItemIds
        .map((id) => items.find((i) => i.id === id))
        .filter((i): i is NonNullable<typeof i> => i !== undefined);
      if (canJoinMultipleItems(selectedItems)) {
        useTimelineStore.getState().joinItems(selectedItemIds);
      }
    }
  }, []);

  // Handle join with left neighbor
  const handleJoinLeft = useCallback(() => {
    if (leftNeighbor) {
      useTimelineStore.getState().joinItems([leftNeighbor.id, item.id]);
    }
  }, [leftNeighbor, item.id]);

  // Handle join with right neighbor
  const handleJoinRight = useCallback(() => {
    if (rightNeighbor) {
      useTimelineStore.getState().joinItems([item.id, rightNeighbor.id]);
    }
  }, [rightNeighbor, item.id]);

  // Handle delete action
  const handleDelete = useCallback(() => {
    const selectedItemIds = useSelectionStore.getState().selectedItemIds;
    if (selectedItemIds.length > 0) {
      useTimelineStore.getState().removeItems(selectedItemIds);
    }
  }, []);

  // Handle ripple delete action (delete + close gap)
  const handleRippleDelete = useCallback(() => {
    const selectedItemIds = useSelectionStore.getState().selectedItemIds;
    if (selectedItemIds.length > 0) {
      useTimelineStore.getState().rippleDeleteItems(selectedItemIds);
    }
  }, []);

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
        // Elevate dragged clips above other clips in the timeline
        zIndex: isBeingDragged ? 50 : undefined,
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

      {/* Video clip 2-row layout: filmstrip (with overlayed label) | waveform */}
      {item.type === 'video' && item.mediaId && (
        <div className="absolute inset-0 flex flex-col">
          {/* Row 1: Filmstrip with overlayed label */}
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
              pixelsPerSecond={pixelsPerSecond}
              height={VIDEO_FILMSTRIP_HEIGHT}
              className="top-0"
            />
            {/* Overlayed label */}
            <div
              className="absolute top-0 left-0 max-w-full px-2 text-[11px] font-medium truncate"
              style={{ lineHeight: `${CLIP_LABEL_HEIGHT}px` }}
            >
              {item.label}
            </div>
          </div>
          {/* Row 2: Waveform */}
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
              pixelsPerSecond={pixelsPerSecond}
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
              pixelsPerSecond={pixelsPerSecond}
              height={AUDIO_WAVEFORM_HEIGHT}
              className="top-0"
            />
          </div>
        </div>
      )}

      {/* Text item - show text content preview */}
      {item.type === 'text' && (
        <div className="absolute inset-0 flex flex-col px-2 py-1 overflow-hidden">
          <div className="text-[10px] text-muted-foreground truncate">Text</div>
          <div className="text-xs font-medium truncate flex-1">
            {item.text || 'Empty text'}
          </div>
        </div>
      )}

      {/* Adjustment layer - show effects summary */}
      {item.type === 'adjustment' && (
        <div className="absolute inset-0 flex flex-col px-2 py-1 overflow-hidden">
          <div className="text-[10px] text-muted-foreground truncate">Adjustment Layer</div>
          <div className="text-xs font-medium truncate flex-1">
            {item.effects?.filter(e => e.enabled).length
              ? `${item.effects.filter(e => e.enabled).length} effect${item.effects.filter(e => e.enabled).length > 1 ? 's' : ''}`
              : 'No effects'}
          </div>
        </div>
      )}

      {/* Item label - for image and shape items */}
      {item.type !== 'video' && item.type !== 'audio' && item.type !== 'text' && item.type !== 'adjustment' && (
        <div className="px-2 py-1 text-xs font-medium truncate">
          {item.label}
        </div>
      )}

      {/* Mask indicator for shape items */}
      {item.type === 'shape' && item.isMask && (
        <div className="absolute top-1 right-1 px-1 py-0.5 text-[10px] font-bold bg-cyan-500/80 text-white rounded">
          M
        </div>
      )}

      {/* Speed badge - show when speed is not 1x (use tolerance for floating point) */}
      {Math.abs(currentSpeed - 1) > 0.005 && !isStretching && (
        <div className="absolute top-1 right-1 px-1 py-0.5 text-[10px] font-bold bg-black/60 text-white rounded font-mono">
          {currentSpeed.toFixed(2)}x
        </div>
      )}

      {/* Missing media indicator - show when media file is broken */}
      {isBroken && item.mediaId && (
        <div
          className="absolute bottom-1 left-1 p-0.5 rounded bg-destructive/90 text-destructive-foreground"
          title="Media file missing - relink in Media Library"
        >
          <Link2Off className="w-3 h-3" />
        </div>
      )}

      {/* Preview speed overlay during stretch - always rendered, visibility controlled via CSS */}
      <div
        className={cn(
          "absolute inset-0 flex items-center justify-center bg-black/50 pointer-events-none z-10 transition-opacity duration-75",
          isStretching && stretchFeedback ? "opacity-100" : "opacity-0"
        )}
      >
        <span className="text-white font-mono text-sm font-bold">
          {stretchFeedback?.speed.toFixed(2) ?? '1.00'}x
        </span>
      </div>

      {/* Trim handles - always rendered, visibility controlled via CSS to prevent DOM churn */}
      {/* Left trim handle - w-2 (8px) matches EDGE_HOVER_ZONE */}
      <div
        className={cn(
          "absolute left-0 top-0 bottom-0 w-2 bg-primary cursor-ew-resize transition-opacity duration-75",
          !trackLocked && (!isAnyDragActiveRef.current || isTrimming) && activeTool === 'select' && (hoveredEdge === 'start' || (isTrimming && trimHandle === 'start'))
            ? "opacity-100"
            : "opacity-0 pointer-events-none"
        )}
        onMouseDown={(e) => handleTrimStart(e, 'start')}
      />
      {/* Right trim handle - w-2 (8px) matches EDGE_HOVER_ZONE */}
      <div
        className={cn(
          "absolute right-0 top-0 bottom-0 w-2 bg-primary cursor-ew-resize transition-opacity duration-75",
          !trackLocked && (!isAnyDragActiveRef.current || isTrimming) && activeTool === 'select' && (hoveredEdge === 'end' || (isTrimming && trimHandle === 'end'))
            ? "opacity-100"
            : "opacity-0 pointer-events-none"
        )}
        onMouseDown={(e) => handleTrimStart(e, 'end')}
      />

      {/* Rate stretch handles - always rendered, visibility controlled via CSS to prevent DOM churn */}
      {/* Left stretch handle - w-2 (8px) matches EDGE_HOVER_ZONE */}
      <div
        className={cn(
          "absolute left-0 top-0 bottom-0 w-2 bg-orange-500 cursor-ew-resize transition-opacity duration-75",
          !trackLocked && (!isAnyDragActiveRef.current || isStretching) && activeTool === 'rate-stretch' && isMediaItem && (hoveredEdge === 'start' || (isStretching && stretchHandle === 'start'))
            ? "opacity-100"
            : "opacity-0 pointer-events-none"
        )}
        onMouseDown={(e) => handleStretchStart(e, 'start')}
      />
      {/* Right stretch handle - w-2 (8px) matches EDGE_HOVER_ZONE */}
      <div
        className={cn(
          "absolute right-0 top-0 bottom-0 w-2 bg-orange-500 cursor-ew-resize transition-opacity duration-75",
          !trackLocked && (!isAnyDragActiveRef.current || isStretching) && activeTool === 'rate-stretch' && isMediaItem && (hoveredEdge === 'end' || (isStretching && stretchHandle === 'end'))
            ? "opacity-100"
            : "opacity-0 pointer-events-none"
        )}
        onMouseDown={(e) => handleStretchStart(e, 'end')}
      />

      {/* Join indicator - glowing edge when clip can be joined with neighbor */}
      {/* Always rendered, visibility controlled via CSS to prevent DOM churn */}
      <div
        className={cn(
          "absolute left-0 top-0 bottom-0 w-px pointer-events-none transition-opacity duration-75",
          hasJoinableLeft && !trackLocked && !isAnyDragActiveRef.current && hoveredEdge !== 'start' && !isTrimming && !isStretching
            ? "opacity-100"
            : "opacity-0"
        )}
        style={{ backgroundColor: 'var(--color-timeline-join)', boxShadow: '0 0 6px 1px var(--color-timeline-join)' }}
        title="Can join with previous clip (J)"
      />
      <div
        className={cn(
          "absolute right-0 top-0 bottom-0 w-px pointer-events-none transition-opacity duration-75",
          hasJoinableRight && !trackLocked && !isAnyDragActiveRef.current && hoveredEdge !== 'end' && !isTrimming && !isStretching
            ? "opacity-100"
            : "opacity-0"
        )}
        style={{ backgroundColor: 'var(--color-timeline-join)', boxShadow: '0 0 6px 1px var(--color-timeline-join)' }}
        title="Can join with next clip (J)"
      />

    </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        {/* Show "Join Selected" when multiple clips are selected and joinable - computed on open */}
        {getCanJoinSelected() && (
          <ContextMenuItem onClick={handleJoinSelected}>
            Join Selected
            <ContextMenuShortcut>J</ContextMenuShortcut>
          </ContextMenuItem>
        )}
        {/* Show directional join options for single clip with joinable neighbors */}
        {!getCanJoinSelected() && hasJoinableLeft && (
          <ContextMenuItem onClick={handleJoinLeft}>
            Join with Previous
          </ContextMenuItem>
        )}
        {!getCanJoinSelected() && hasJoinableRight && (
          <ContextMenuItem onClick={handleJoinRight}>
            Join with Next
          </ContextMenuItem>
        )}
        {(getCanJoinSelected() || canJoinFromContextMenu) && <ContextMenuSeparator />}
        <ContextMenuItem
          onClick={handleRippleDelete}
          disabled={!isSelected}
          className="text-destructive focus:text-destructive"
        >
          Ripple Delete
          <ContextMenuShortcut>Ctrl+Del</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem
          onClick={handleDelete}
          disabled={!isSelected}
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
  const prevItem = prevProps.item;
  const nextItem = nextProps.item;

  // Check shape-specific mask property
  const prevIsMask = prevItem.type === 'shape' ? prevItem.isMask : undefined;
  const nextIsMask = nextItem.type === 'shape' ? nextItem.isMask : undefined;

  return (
    prevItem.id === nextItem.id &&
    prevItem.from === nextItem.from &&
    prevItem.durationInFrames === nextItem.durationInFrames &&
    prevItem.trackId === nextItem.trackId &&
    prevItem.type === nextItem.type &&
    prevItem.label === nextItem.label &&
    prevItem.mediaId === nextItem.mediaId &&
    prevItem.sourceStart === nextItem.sourceStart &&
    prevItem.sourceEnd === nextItem.sourceEnd &&
    prevItem.sourceDuration === nextItem.sourceDuration &&
    prevItem.trimStart === nextItem.trimStart &&
    prevItem.speed === nextItem.speed &&
    prevIsMask === nextIsMask &&
    prevProps.timelineDuration === nextProps.timelineDuration &&
    prevProps.trackLocked === nextProps.trackLocked
  );
});
