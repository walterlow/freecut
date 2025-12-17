import { useState, useRef, memo, useCallback, useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { createLogger } from '@/lib/logger';

const logger = createLogger('TimelineTrack');
import type { TimelineTrack as TimelineTrackType, TimelineItem as TimelineItemType, VideoItem, AudioItem, ImageItem } from '@/types/timeline';
import type { TransformProperties } from '@/types/transform';
import { TimelineItem } from './timeline-item';
import { TransitionItem } from './transition-item';
import { useTimelineStore } from '../stores/timeline-store';
import { useSelectionStore } from '@/features/editor/stores/selection-store';
import { useTimelineZoomContext } from '../contexts/timeline-zoom-context';
import { useMediaLibraryStore } from '@/features/media-library/stores/media-library-store';
import { useProjectStore } from '@/features/projects/stores/project-store';
import { mediaLibraryService } from '@/features/media-library/services/media-library-service';
import { findNearestAvailableSpace } from '../utils/collision-utils';
import { getMediaDragData } from '@/features/media-library/utils/drag-data-cache';
import { CLIP_HEIGHT } from '@/features/timeline/constants';

/**
 * Compute initial fit-to-canvas transform for an item.
 * This locks in the initial size so it doesn't change when canvas changes.
 */
function computeInitialTransform(
  sourceWidth: number,
  sourceHeight: number,
  canvasWidth: number,
  canvasHeight: number
): TransformProperties {
  const scaleX = canvasWidth / sourceWidth;
  const scaleY = canvasHeight / sourceHeight;
  const fitScale = Math.min(scaleX, scaleY);

  // Note: opacity is intentionally omitted - undefined means "use default (1.0)"
  // Only set opacity explicitly when user changes it, so we can distinguish
  // between "default 100%" and "explicitly set to 100%"
  return {
    x: 0,
    y: 0,
    width: Math.round(sourceWidth * fitScale),
    height: Math.round(sourceHeight * fitScale),
    rotation: 0,
  };
}
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';

export interface TimelineTrackProps {
  track: TimelineTrackType;
  timelineWidth?: number;
}

// Type for ghost preview items during drag
interface GhostPreviewItem {
  left: number;
  width: number;
  label: string;
  type: string;
}

/**
 * Custom equality for TimelineTrack memo - compares track and width only
 * Items are fetched from store internally, so we don't compare them here
 */
function areTrackPropsEqual(
  prev: TimelineTrackProps,
  next: TimelineTrackProps
): boolean {
  return prev.track === next.track && prev.timelineWidth === next.timelineWidth;
}

/**
 * Timeline Track Component
 *
 * Renders a single timeline track with:
 * - All items belonging to this track
 * - Appropriate height based on track settings
 * - Generic container that accepts any item types
 * - Drag-and-drop support for media from library
 */

export const TimelineTrack = memo(function TimelineTrack({ track }: TimelineTrackProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [ghostPreviews, setGhostPreviews] = useState<GhostPreviewItem[]>([]);
  const [contextMenuFrame, setContextMenuFrame] = useState<number | null>(null);
  const [menuKey, setMenuKey] = useState(0);
  const trackRef = useRef<HTMLDivElement>(null);

  // Store selectors - avoid subscribing to full items array to prevent re-renders
  // Use derived selector: only returns items for THIS track (changes only when track items change)
  // useShallow prevents infinite loops from array reference changes and enables shallow comparison
  const trackItems = useTimelineStore(
    useShallow((s) => s.items.filter((item) => item.trackId === track.id))
  );
  // Get transitions for this track
  const trackTransitions = useTimelineStore(
    useShallow((s) => s.transitions.filter((t) => t.trackId === track.id))
  );
  const addItem = useTimelineStore((s) => s.addItem);
  const fps = useTimelineStore((s) => s.fps);
  const closeGapAtPosition = useTimelineStore((s) => s.closeGapAtPosition);
  const getMedia = useMediaLibraryStore((s) => s.mediaItems);
  const currentProject = useProjectStore((s) => s.currentProject);
  const canvasWidth = currentProject?.metadata.width ?? 1920;
  const canvasHeight = currentProject?.metadata.height ?? 1080;

  // Zoom utilities for position calculation
  const { pixelsToFrame, frameToPixels } = useTimelineZoomContext();

  // Get item IDs for this track to check drag state
  const trackItemIds = useMemo(() => trackItems.map(item => item.id), [trackItems]);

  // Check if any item on this track is being dragged (granular selector)
  const hasItemBeingDragged = useSelectionStore(
    useCallback(
      (s) => s.dragState?.isDragging && s.dragState.draggedItemIds.some(id => trackItemIds.includes(id)),
      [trackItemIds]
    )
  );

  // Check if a frame position is inside a real gap (between clips, not after the last clip)
  const isFrameInGap = useCallback((frame: number) => {
    if (trackItems.length === 0) return false;

    const sortedItems = [...trackItems].sort((a, b) => a.from - b.from);

    // Check if frame is inside any clip
    for (const item of sortedItems) {
      if (frame >= item.from && frame < item.from + item.durationInFrames) {
        return false; // Inside a clip
      }
    }

    // Check if there's a clip AFTER this frame (otherwise it's just empty space, not a gap)
    const hasClipAfter = sortedItems.some((item) => item.from > frame);
    return hasClipAfter;
  }, [trackItems]);

  // Handle context menu on track (for empty space)
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    // Check if clicking on a clip (has data-item-id ancestor)
    const target = e.target as HTMLElement;
    if (target.closest('[data-item-id]')) {
      // Let the clip's context menu handle it
      return;
    }

    // Calculate clicked frame position
    if (!trackRef.current) return;
    const timelineContainer = trackRef.current.closest('.timeline-container') as HTMLElement;
    if (!timelineContainer) return;

    const scrollLeft = timelineContainer.scrollLeft || 0;
    const containerRect = timelineContainer.getBoundingClientRect();
    const offsetX = (e.clientX - containerRect.left) + scrollLeft;
    const clickedFrame = pixelsToFrame(offsetX);

    // Check if this frame is in a gap - just track the frame, let Radix handle menu
    if (isFrameInGap(clickedFrame)) {
      setContextMenuFrame(clickedFrame);
    } else {
      // Clicked on a clip area, prevent track menu so clip menu can show
      e.preventDefault();
      setContextMenuFrame(null);
    }
  }, [pixelsToFrame, isFrameInGap]);

  // Handle closing the gap
  const handleCloseGap = useCallback(() => {
    if (contextMenuFrame !== null) {
      closeGapAtPosition(track.id, contextMenuFrame);
      setContextMenuFrame(null);
    }
  }, [contextMenuFrame, closeGapAtPosition, track.id]);

  // Force menu remount on right-click to fix positioning
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button === 2) { // Right click
      setMenuKey((k) => k + 1);
    }
  }, []);

  const handleDragOver = (e: React.DragEvent) => {
    // Don't allow drops on locked tracks
    if (track.locked) {
      e.dataTransfer.dropEffect = 'none';
      return;
    }

    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setIsDragOver(true);

    // Calculate and show drop preview position
    if (trackRef.current) {
      const timelineContainer = trackRef.current.closest('.timeline-container') as HTMLElement;
      if (!timelineContainer) return;

      const scrollLeft = timelineContainer.scrollLeft || 0;
      const containerRect = timelineContainer.getBoundingClientRect();

      // Calculate position in timeline space: mouse position relative to container + scroll offset
      const offsetX = (e.clientX - containerRect.left) + scrollLeft;
      const dropFrame = pixelsToFrame(offsetX);

      // Use cached drag data for ghost preview (dataTransfer.getData() doesn't work during dragover)
      const data = getMediaDragData();
      if (!data) {
        return;
      }

      const previews: GhostPreviewItem[] = [];
      try {

        if (data.type === 'media-items' && data.items) {
          // Multi-item drop
          let currentPosition = Math.max(0, dropFrame);
          const tempItems: Array<{ from: number; durationInFrames: number; trackId: string }> = [];

          for (const item of data.items) {
            const durationInFrames = Math.round(item.duration * fps);
            const itemDuration = durationInFrames > 0 ? durationInFrames : (item.mediaType === 'image' ? fps * 3 : fps);

            // Find collision-free position - read items from store directly to avoid subscription
            const storeItems = useTimelineStore.getState().items;
            const itemsToCheck = [...storeItems, ...tempItems as unknown as TimelineItemType[]];
            const finalPosition = findNearestAvailableSpace(currentPosition, itemDuration, track.id, itemsToCheck);

            if (finalPosition !== null) {
              previews.push({
                left: frameToPixels(finalPosition),
                width: frameToPixels(itemDuration),
                label: item.fileName,
                type: item.mediaType,
              });
              tempItems.push({ from: finalPosition, durationInFrames: itemDuration, trackId: track.id });
              currentPosition = finalPosition + itemDuration;
            }
          }
        } else if (data.type === 'media-item' && data.mediaId && data.mediaType && data.fileName) {
          // Single item drop
          const media = getMedia.find((m) => m.id === data.mediaId);
          if (media) {
            const durationInFrames = Math.round(media.duration * fps);
            const itemDuration = durationInFrames > 0 ? durationInFrames : (data.mediaType === 'image' ? fps * 3 : fps);
            const proposedPosition = Math.max(0, dropFrame);
            // Read items from store directly to avoid subscription
            const storeItems = useTimelineStore.getState().items;
            const finalPosition = findNearestAvailableSpace(proposedPosition, itemDuration, track.id, storeItems);

            if (finalPosition !== null) {
              previews.push({
                left: frameToPixels(finalPosition),
                width: frameToPixels(itemDuration),
                label: data.fileName,
                type: data.mediaType,
              });
            }
          }
        }

        setGhostPreviews(previews);
      } catch {
        // Ignore parsing errors during drag
      }
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    setGhostPreviews([]);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    setGhostPreviews([]);

    // Don't allow drops on locked tracks
    if (track.locked) {
      return;
    }

    // Parse drag data
    try {
      const data = JSON.parse(e.dataTransfer.getData('application/json'));

      // Calculate drop position in frames
      if (!trackRef.current) return;

      // Get timeline container scroll position
      const timelineContainer = trackRef.current.closest('.timeline-container') as HTMLElement;
      if (!timelineContainer) return;

      const scrollLeft = timelineContainer.scrollLeft || 0;
      const containerRect = timelineContainer.getBoundingClientRect();

      // Calculate position in timeline space: mouse position relative to container + scroll offset
      const offsetX = (e.clientX - containerRect.left) + scrollLeft;
      const dropFrame = pixelsToFrame(offsetX);

      // Handle multi-item drop (media-items)
      if (data.type === 'media-items') {
        const items = data.items as Array<{
          mediaId: string;
          mediaType: string;
          fileName: string;
          duration: number;
        }>;

        // Track current position for sequential placement
        let currentPosition = Math.max(0, dropFrame);
        // Keep track of items we're adding to include in collision detection
        const addedItems: TimelineItemType[] = [];

        for (const item of items) {
          const { mediaId, mediaType, fileName, duration } = item;

          // Get media metadata from store for additional info
          const media = getMedia.find((m) => m.id === mediaId);
          if (!media) {
            logger.error('Media not found:', mediaId);
            continue;
          }

          // Calculate duration in frames
          const durationInFrames = Math.round(duration * fps);
          const itemDuration = durationInFrames > 0 ? durationInFrames : (mediaType === 'image' ? fps * 3 : fps);

          // Find nearest available space considering both existing items and items we're adding
          // Read items from store directly to avoid subscription
          const storeItems = useTimelineStore.getState().items;
          const itemsToCheck = [...storeItems, ...addedItems];
          const finalPosition = findNearestAvailableSpace(
            currentPosition,
            itemDuration,
            track.id,
            itemsToCheck
          );

          if (finalPosition === null) {
            logger.warn('Cannot drop item: no available space on track for', fileName);
            continue;
          }

          // Get media blob URL for playback
          const blobUrl = await mediaLibraryService.getMediaBlobUrl(mediaId);
          if (!blobUrl) {
            logger.error('Failed to get media blob URL for', fileName);
            continue;
          }

          // Get thumbnail URL if available
          const thumbnailUrl = await mediaLibraryService.getThumbnailBlobUrl(mediaId);

          // Create timeline item
          // sourceDuration = full source material available (enables handle calculation for transitions)
          // sourceEnd = current playback endpoint (what portion we're showing)
          const actualSourceDurationFrames = Math.round(media.duration * fps);
          const baseItem = {
            id: crypto.randomUUID(),
            trackId: track.id,
            from: finalPosition,
            durationInFrames: itemDuration,
            label: fileName,
            mediaId: mediaId,
            originId: crypto.randomUUID(),
            sourceStart: 0,
            sourceEnd: itemDuration,
            sourceDuration: actualSourceDurationFrames,
            trimStart: 0,
            trimEnd: 0,
          };

          let timelineItem: TimelineItemType;
          if (mediaType === 'video') {
            const sourceW = media.width || canvasWidth;
            const sourceH = media.height || canvasHeight;
            timelineItem = {
              ...baseItem,
              type: 'video',
              src: blobUrl,
              thumbnailUrl: thumbnailUrl || undefined,
              sourceWidth: media.width || undefined,
              sourceHeight: media.height || undefined,
              transform: computeInitialTransform(sourceW, sourceH, canvasWidth, canvasHeight),
            } as VideoItem;
          } else if (mediaType === 'audio') {
            timelineItem = {
              ...baseItem,
              type: 'audio',
              src: blobUrl,
            } as AudioItem;
          } else if (mediaType === 'image') {
            const sourceW = media.width || canvasWidth;
            const sourceH = media.height || canvasHeight;
            timelineItem = {
              ...baseItem,
              type: 'image',
              src: blobUrl,
              thumbnailUrl: thumbnailUrl || undefined,
              sourceWidth: media.width || undefined,
              sourceHeight: media.height || undefined,
              transform: computeInitialTransform(sourceW, sourceH, canvasWidth, canvasHeight),
            } as ImageItem;
          } else {
            logger.warn('Unsupported media type:', mediaType);
            continue;
          }

          // Track the item for collision detection with subsequent items
          addedItems.push(timelineItem);

          // Update current position for next item (place after this one)
          currentPosition = finalPosition + itemDuration;

          // Add the item to timeline
          logger.debug('Adding item at frame:', timelineItem.from, 'which is', timelineItem.from / fps, 'seconds');
          addItem(timelineItem);
        }
        return;
      }

      // Handle single item drop (media-item)
      if (data.type !== 'media-item') {
        return; // Not a media item drop
      }

      const { mediaId, mediaType, fileName } = data;

      // Get media metadata from store
      const media = getMedia.find((m) => m.id === mediaId);
      if (!media) {
        logger.error('Media not found:', mediaId);
        return;
      }

      // Calculate duration in frames first (needed for collision detection)
      const durationInFrames = Math.round(media.duration * fps);
      const itemDuration = durationInFrames > 0 ? durationInFrames : (mediaType === 'image' ? fps * 3 : fps);

      // Calculate proposed drop position (ensure non-negative)
      const proposedPosition = Math.max(0, dropFrame);

      // Find nearest available space (snaps forward if collision)
      // Read items from store directly to avoid subscription
      const storeItems = useTimelineStore.getState().items;
      const finalPosition = findNearestAvailableSpace(
        proposedPosition,
        itemDuration,
        track.id,
        storeItems
      );

      // If no available space found, cancel the drop
      if (finalPosition === null) {
        logger.warn('Cannot drop item: no available space on track');
        return;
      }

      // Debug logging
      logger.debug('Drop Debug:', {
        clientX: e.clientX,
        containerLeft: containerRect.left,
        scrollLeft,
        offsetX,
        dropFrame,
        proposedPosition,
        finalPosition,
        snapped: finalPosition !== proposedPosition,
        calculatedSeconds: offsetX / 100,
      });

      // Get media blob URL for playback
      // TODO: Implement blob URL cleanup when timeline items are removed
      // Currently, blob URLs persist until page close, which may cause memory leaks
      // for large files. Consider implementing a blob URL manager service.
      const blobUrl = await mediaLibraryService.getMediaBlobUrl(mediaId);
      if (!blobUrl) {
        logger.error('Failed to get media blob URL');
        return;
      }

      // Get thumbnail URL if available
      const thumbnailUrl = await mediaLibraryService.getThumbnailBlobUrl(mediaId);

      // Create timeline item at the collision-free position
      // sourceDuration = full source material available (enables handle calculation for transitions)
      // sourceEnd = current playback endpoint (what portion we're showing)
      const actualSourceDurationFrames = Math.round(media.duration * fps);
      let timelineItem: TimelineItemType;
      const baseItem = {
        id: crypto.randomUUID(),
        trackId: track.id,
        from: finalPosition,
        durationInFrames: itemDuration,
        label: fileName,
        mediaId: mediaId,
        originId: crypto.randomUUID(), // Unique origin for stable React keys
        // Initialize trim/source properties for new items
        sourceStart: 0,
        sourceEnd: itemDuration,
        sourceDuration: actualSourceDurationFrames,
        trimStart: 0,
        trimEnd: 0,
      };

      if (mediaType === 'video') {
        const sourceW = media.width || canvasWidth;
        const sourceH = media.height || canvasHeight;
        timelineItem = {
          ...baseItem,
          type: 'video',
          src: blobUrl,
          thumbnailUrl: thumbnailUrl || undefined,
          sourceWidth: media.width || undefined,
          sourceHeight: media.height || undefined,
          transform: computeInitialTransform(sourceW, sourceH, canvasWidth, canvasHeight),
        } as VideoItem;
      } else if (mediaType === 'audio') {
        timelineItem = {
          ...baseItem,
          type: 'audio',
          src: blobUrl,
        } as AudioItem;
      } else if (mediaType === 'image') {
        const sourceW = media.width || canvasWidth;
        const sourceH = media.height || canvasHeight;
        timelineItem = {
          ...baseItem,
          type: 'image',
          src: blobUrl,
          thumbnailUrl: thumbnailUrl || undefined,
          sourceWidth: media.width || undefined,
          sourceHeight: media.height || undefined,
          transform: computeInitialTransform(sourceW, sourceH, canvasWidth, canvasHeight),
        } as ImageItem;
      } else {
        logger.warn('Unsupported media type:', mediaType);
        return;
      }

      // Add the new item to timeline
      logger.debug('Adding item at frame:', timelineItem.from, 'which is', timelineItem.from / fps, 'seconds');
      addItem(timelineItem);
    } catch (error) {
      logger.error('Failed to handle media drop:', error);
    }
  };

  return (
    <ContextMenu key={menuKey} modal={false}>
      <ContextMenuTrigger asChild disabled={track.locked}>
        <div
          ref={trackRef}
          data-track-id={track.id}
          className="relative border-b border-border"
          style={{
            height: `${track.height}px`,
            // CSS containment tells browser this element's layout is independent
            // This significantly improves scroll/paint performance for large timelines
            contain: 'layout style',
            // Elevate track above others when it contains a dragging clip
            zIndex: hasItemBeingDragged ? 100 : undefined,
          }}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onMouseDown={handleMouseDown}
          onContextMenu={handleContextMenu}
        >
          {/* Ghost preview clips during drag */}
          {isDragOver && !track.locked && ghostPreviews.map((ghost, index) => (
            <div
              key={index}
              className={`absolute inset-y-0 rounded border-2 border-dashed pointer-events-none z-20 flex items-center px-2 ${
                ghost.type === 'video'
                  ? 'border-timeline-video bg-timeline-video/20'
                  : ghost.type === 'audio'
                  ? 'border-timeline-audio bg-timeline-audio/20'
                  : 'border-timeline-image bg-timeline-image/20'
              }`}
              style={{
                left: `${ghost.left}px`,
                width: `${ghost.width}px`,
                height: CLIP_HEIGHT,
              }}
            >
              <span className="text-xs text-foreground/70 truncate">{ghost.label}</span>
            </div>
          ))}

          {/* Render all items for this track - always visible in timeline UI */}
          {trackItems.map((item) => (
            <TimelineItem key={item.id} item={item} timelineDuration={30} trackLocked={track.locked} />
          ))}

          {/* Render transitions for this track */}
          {trackTransitions.map((transition) => (
            <TransitionItem key={transition.id} transition={transition} trackHeight={track.height} />
          ))}

          {/* Locked track overlay indicator */}
          {track.locked && (
            <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
              <div className="text-xs text-muted-foreground/50 font-mono">LOCKED</div>
            </div>
          )}
        </div>
      </ContextMenuTrigger>
      {trackItems.length > 0 && contextMenuFrame !== null && (
        <ContextMenuContent>
          <ContextMenuItem onClick={handleCloseGap}>
            Ripple Delete
          </ContextMenuItem>
        </ContextMenuContent>
      )}
    </ContextMenu>
  );
}, areTrackPropsEqual);
