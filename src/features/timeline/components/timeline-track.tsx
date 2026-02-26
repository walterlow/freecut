import { useState, useRef, memo, useCallback, useMemo } from 'react';
import { createLogger } from '@/lib/logger';

const logger = createLogger('TimelineTrack');
import type { TimelineTrack as TimelineTrackType, TimelineItem as TimelineItemType, VideoItem, AudioItem, ImageItem, CompositionItem } from '@/types/timeline';
import type { MediaMetadata } from '@/types/storage';
import { TimelineItem } from './timeline-item';
import { TransitionItem } from './transition-item';
import { useTimelineStore } from '../stores/timeline-store';
import { useVisibleItems } from '../hooks/use-visible-items';
import { useItemsStore } from '../stores/items-store';
import { useSelectionStore } from '@/features/editor/stores/selection-store';
import { useTimelineZoomContext } from '../contexts/timeline-zoom-context';
import { useMediaLibraryStore } from '@/features/media-library/stores/media-library-store';
import { useProjectStore } from '@/features/projects/stores/project-store';
import { mediaLibraryService } from '@/features/media-library/services/media-library-service';
import { resolveMediaUrl } from '@/features/preview/utils/media-resolver';
import { findNearestAvailableSpace, type CollisionRect } from '../utils/collision-utils';
import { getMediaDragData, type CompositionDragData } from '@/features/media-library/utils/drag-data-cache';
import { mapWithConcurrency } from '@/lib/async-utils';
import { useCompositionNavigationStore } from '../stores/composition-navigation-store';
import { DEFAULT_TRACK_HEIGHT } from '@/features/timeline/constants';
import { computeInitialTransform } from '../utils/transform-init';
import { toast } from 'sonner';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';

interface TimelineTrackProps {
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

interface DragMediaItem {
  mediaId: string;
  mediaType: string;
  fileName: string;
  duration: number;
}

interface TimelineBaseItem {
  id: string;
  trackId: string;
  from: number;
  durationInFrames: number;
  label: string;
  mediaId: string;
  originId: string;
  sourceStart: number;
  sourceEnd: number;
  sourceDuration: number;
  sourceFps: number;
  trimStart: number;
  trimEnd: number;
}

interface PlannedDroppedMediaItem {
  dragItem: DragMediaItem;
  media: MediaMetadata;
  finalPosition: number;
  itemDuration: number;
}

const MULTI_DROP_METADATA_CONCURRENCY = 3;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isValidDragMediaItem(value: unknown): value is DragMediaItem {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<DragMediaItem>;
  return isNonEmptyString(candidate.mediaId)
    && isNonEmptyString(candidate.mediaType)
    && isNonEmptyString(candidate.fileName)
    && typeof candidate.duration === 'number'
    && Number.isFinite(candidate.duration);
}

function buildTimelineBaseItem(params: {
  media: MediaMetadata;
  mediaId: string;
  label: string;
  trackId: string;
  from: number;
  durationInFrames: number;
  timelineFps: number;
}): TimelineBaseItem {
  const { media, mediaId, label, trackId, from, durationInFrames, timelineFps } = params;
  const sourceFps = media.fps || timelineFps;
  const actualSourceDurationFrames = Math.round(media.duration * sourceFps);
  const sourceFramesForItemDuration = Math.min(
    actualSourceDurationFrames,
    Math.round(durationInFrames * sourceFps / timelineFps)
  );

  return {
    id: crypto.randomUUID(),
    trackId,
    from,
    durationInFrames,
    label,
    mediaId,
    originId: crypto.randomUUID(),
    sourceStart: 0,
    sourceEnd: sourceFramesForItemDuration,
    sourceDuration: actualSourceDurationFrames,
    sourceFps,
    trimStart: 0,
    trimEnd: 0,
  };
}

function buildTypedTimelineItem(params: {
  baseItem: TimelineBaseItem;
  mediaType: string;
  blobUrl: string;
  thumbnailUrl: string | null;
  media: MediaMetadata;
  canvasWidth: number;
  canvasHeight: number;
}): TimelineItemType | null {
  const { baseItem, mediaType, blobUrl, thumbnailUrl, media, canvasWidth, canvasHeight } = params;

  if (mediaType === 'video') {
    const sourceW = media.width || canvasWidth;
    const sourceH = media.height || canvasHeight;
    return {
      ...baseItem,
      type: 'video',
      src: blobUrl,
      thumbnailUrl: thumbnailUrl || undefined,
      sourceWidth: media.width || undefined,
      sourceHeight: media.height || undefined,
      transform: computeInitialTransform(sourceW, sourceH, canvasWidth, canvasHeight),
    } as VideoItem;
  }

  if (mediaType === 'audio') {
    return {
      ...baseItem,
      type: 'audio',
      src: blobUrl,
    } as AudioItem;
  }

  if (mediaType === 'image') {
    const sourceW = media.width || canvasWidth;
    const sourceH = media.height || canvasHeight;
    return {
      ...baseItem,
      type: 'image',
      src: blobUrl,
      thumbnailUrl: thumbnailUrl || undefined,
      sourceWidth: media.width || undefined,
      sourceHeight: media.height || undefined,
      transform: computeInitialTransform(sourceW, sourceH, canvasWidth, canvasHeight),
    } as ImageItem;
  }

  logger.warn('Unsupported media type:', mediaType);
  return null;
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

  // Virtualized items/transitions — only those overlapping the visible viewport + buffer
  const { visibleItems: trackItems, visibleTransitions: trackTransitions } = useVisibleItems(track.id);
  // Full item count — used for context menu guard (must not depend on virtualized subset)
  const hasAnyItems = useItemsStore((s) => (s.itemsByTrackId[track.id]?.length ?? 0) > 0);
  const addItem = useTimelineStore((s) => s.addItem);
  const addItems = useTimelineStore((s) => s.addItems);
  const fps = useTimelineStore((s) => s.fps);
  const closeGapAtPosition = useTimelineStore((s) => s.closeGapAtPosition);
  const getMedia = useMediaLibraryStore((s) => s.mediaItems);
  const currentProject = useProjectStore((s) => s.currentProject);
  const canvasWidth = currentProject?.metadata.width ?? 1920;
  const canvasHeight = currentProject?.metadata.height ?? 1080;

  // Zoom utilities for position calculation
  const { pixelsToFrame, frameToPixels } = useTimelineZoomContext();

  // Get item IDs from the full store (not virtualized subset) so drag detection
  // works even if the source item scrolls out of the visible buffer mid-drag.
  const allTrackItems = useItemsStore((s) => s.itemsByTrackId[track.id]);
  const trackItemIds = useMemo(() => allTrackItems?.map(item => item.id) ?? [], [allTrackItems]);

  // Check if any item on this track is being dragged (granular selector)
  const hasItemBeingDragged = useSelectionStore(
    useCallback(
      (s) => s.dragState?.isDragging && s.dragState.draggedItemIds.some(id => trackItemIds.includes(id)),
      [trackItemIds]
    )
  );

  // Check if a frame position is inside a real gap (between clips, not after the last clip).
  // Reads full item list from store (not the virtualized subset) so gaps near viewport edges
  // are detected correctly even when the clip after the gap is outside the visible buffer.
  const isFrameInGap = useCallback((frame: number) => {
    const allTrackItems = useItemsStore.getState().itemsByTrackId[track.id];
    if (!allTrackItems || allTrackItems.length === 0) return false;

    const sortedItems = allTrackItems.toSorted((a, b) => a.from - b.from);

    // Check if frame is inside any clip
    for (const item of sortedItems) {
      if (frame >= item.from && frame < item.from + item.durationInFrames) {
        return false; // Inside a clip
      }
    }

    // Check if there's a clip AFTER this frame (otherwise it's just empty space, not a gap)
    const hasClipAfter = sortedItems.some((item) => item.from > frame);
    return hasClipAfter;
  }, [track.id]);

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
    // Don't allow drops on locked or group tracks
    if (track.locked || track.isGroup) {
      e.preventDefault();
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
        // Composition drop preview
        if (data.type === 'composition') {
          const isInsideSubComp = useCompositionNavigationStore.getState().activeCompositionId !== null;
          if (isInsideSubComp) {
            // Block composition drops inside sub-compositions
            e.dataTransfer.dropEffect = 'none';
            setGhostPreviews([]);
            return;
          }
          const compData = data as CompositionDragData;
          const itemDuration = compData.durationInFrames;
          const proposedPosition = Math.max(0, dropFrame);
          const storeItems = useTimelineStore.getState().items;
          const finalPosition = findNearestAvailableSpace(proposedPosition, itemDuration, track.id, storeItems);

          if (finalPosition !== null) {
            previews.push({
              left: frameToPixels(finalPosition),
              width: frameToPixels(itemDuration),
              label: compData.name,
              type: 'composition',
            });
          }
          setGhostPreviews(previews);
          return;
        }

        if (data.type === 'media-items' && data.items) {
          // Multi-item drop
          const rawItems = Array.isArray(data.items) ? data.items : [];
          const validItems = rawItems.filter(isValidDragMediaItem);
          if (validItems.length !== rawItems.length) {
            logger.warn('Skipping invalid media-items preview payload entries', {
              invalidCount: rawItems.length - validItems.length,
            });
          }
          let currentPosition = Math.max(0, dropFrame);
          const tempItems: CollisionRect[] = [];

          for (const item of validItems) {
            const durationInFrames = Math.round(item.duration * fps);
            const itemDuration = durationInFrames > 0 ? durationInFrames : (item.mediaType === 'image' ? fps * 3 : fps);

            // Find collision-free position - read items from store directly to avoid subscription
            const storeItems = useTimelineStore.getState().items;
            const itemsToCheck: CollisionRect[] = [...storeItems, ...tempItems];
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

    // Don't allow drops on locked or group tracks
    if (track.locked || track.isGroup) {
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

      // Handle composition drop
      if (data.type === 'composition') {
        const isInsideSubComp = useCompositionNavigationStore.getState().activeCompositionId !== null;
        if (isInsideSubComp) return; // Block inside sub-compositions

        const { compositionId, name, durationInFrames, width, height } = data;
        const proposedPosition = Math.max(0, dropFrame);
        const storeItems = useTimelineStore.getState().items;
        const finalPosition = findNearestAvailableSpace(
          proposedPosition,
          durationInFrames,
          track.id,
          storeItems
        );

        if (finalPosition === null) {
          logger.warn('Cannot drop composition: no available space on track');
          return;
        }

        const compositionItem: CompositionItem = {
          id: crypto.randomUUID(),
          type: 'composition',
          trackId: track.id,
          from: finalPosition,
          durationInFrames,
          label: name,
          compositionId,
          compositionWidth: width,
          compositionHeight: height,
          transform: {
            x: 0,
            y: 0,
            rotation: 0,
            opacity: 1,
          },
        };

        addItem(compositionItem);
        return;
      }

      // Handle multi-item drop (media-items)
      if (data.type === 'media-items') {
        const rawItems = Array.isArray(data.items) ? data.items : [];
        const validItems = rawItems.filter(isValidDragMediaItem);
        if (validItems.length === 0) {
          return;
        }
        if (validItems.length !== rawItems.length) {
          logger.warn('Skipping invalid media-items payload entries', {
            invalidCount: rawItems.length - validItems.length,
          });
        }

        let currentPosition = Math.max(0, dropFrame);
        const mediaById = new Map(getMedia.map((media) => [media.id, media]));
        const storeItems = useTimelineStore.getState().items;
        const reservedRanges: CollisionRect[] = [];
        const plannedItems: PlannedDroppedMediaItem[] = [];

        for (const dragItem of validItems) {
          const { mediaId, mediaType, fileName, duration } = dragItem;
          const media = mediaById.get(mediaId);
          if (!media) {
            logger.error('Media not found:', mediaId);
            continue;
          }

          const durationInFrames = Math.round(duration * fps);
          const itemDuration = durationInFrames > 0 ? durationInFrames : (mediaType === 'image' ? fps * 3 : fps);
          const itemsToCheck: CollisionRect[] = [...storeItems, ...reservedRanges];
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

          plannedItems.push({
            dragItem,
            media,
            finalPosition,
            itemDuration,
          });
          reservedRanges.push({ from: finalPosition, durationInFrames: itemDuration, trackId: track.id });
          currentPosition = finalPosition + itemDuration;
        }

        if (plannedItems.length === 0) {
          return;
        }

        const resolvedTimelineItems = await mapWithConcurrency(
          plannedItems,
          MULTI_DROP_METADATA_CONCURRENCY,
          async (planned): Promise<TimelineItemType | null> => {
            const { dragItem, media, finalPosition, itemDuration } = planned;
            const needsThumbnail = dragItem.mediaType === 'video' || dragItem.mediaType === 'image';
            const [blobUrl, thumbnailUrl] = await Promise.all([
              resolveMediaUrl(dragItem.mediaId),
              needsThumbnail
                ? mediaLibraryService.getThumbnailBlobUrl(dragItem.mediaId)
                : Promise.resolve(null),
            ]);

            if (!blobUrl) {
              logger.error('Failed to get media blob URL for', dragItem.fileName);
              return null;
            }

            const baseItem = buildTimelineBaseItem({
              media,
              mediaId: dragItem.mediaId,
              label: dragItem.fileName,
              trackId: track.id,
              from: finalPosition,
              durationInFrames: itemDuration,
              timelineFps: fps,
            });
            return buildTypedTimelineItem({
              baseItem,
              mediaType: dragItem.mediaType,
              blobUrl,
              thumbnailUrl,
              media,
              canvasWidth,
              canvasHeight,
            });
          }
        );

        const timelineItemsToAdd = resolvedTimelineItems.filter(
          (timelineItem): timelineItem is TimelineItemType => timelineItem !== null
        );
        const resolvedCount = timelineItemsToAdd.length;

        if (resolvedCount === 0 && plannedItems.length > 0) {
          logger.error('Failed to resolve URLs for all dropped media items', {
            plannedCount: plannedItems.length,
          });
          toast.error('Unable to add dropped media items');
          return;
        }

        if (resolvedCount < plannedItems.length) {
          const failedCount = plannedItems.length - resolvedCount;
          logger.warn('Some dropped media items could not be resolved', {
            plannedCount: plannedItems.length,
            resolvedCount,
          });
          toast.warning(`Some dropped media items could not be added: ${failedCount} failed`);
        }

        if (resolvedCount > 0) {
          addItems(timelineItemsToAdd);
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

      const blobUrl = await resolveMediaUrl(mediaId);
      if (!blobUrl) {
        logger.error('Failed to get media blob URL');
        return;
      }

      // Get thumbnail URL if available
      const needsThumbnail = mediaType === 'video' || mediaType === 'image';
      const thumbnailUrl = needsThumbnail
        ? await mediaLibraryService.getThumbnailBlobUrl(mediaId)
        : null;

      // Create timeline item at the collision-free position.
      // source* fields are stored in source-native frame units.
      const baseItem = buildTimelineBaseItem({
        media,
        mediaId,
        label: fileName,
        trackId: track.id,
        from: finalPosition,
        durationInFrames: itemDuration,
        timelineFps: fps,
      });
      const timelineItem = buildTypedTimelineItem({
        baseItem,
        mediaType,
        blobUrl,
        thumbnailUrl,
        media,
        canvasWidth,
        canvasHeight,
      });
      if (!timelineItem) {
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
          className={`relative border-b border-border${track.isGroup ? ' bg-group-stripes' : ''}`}
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
                ghost.type === 'composition'
                  ? 'border-violet-400 bg-violet-600/20'
                  : ghost.type === 'video'
                  ? 'border-timeline-video bg-timeline-video/20'
                  : ghost.type === 'audio'
                  ? 'border-timeline-audio bg-timeline-audio/20'
                  : 'border-timeline-image bg-timeline-image/20'
              }`}
              style={{
                left: `${ghost.left}px`,
                width: `${ghost.width}px`,
                height: DEFAULT_TRACK_HEIGHT,
              }}
            >
              <span className="text-xs text-foreground/70 truncate">{ghost.label}</span>
            </div>
          ))}

          {/* Render all items for this track - dimmed when track is hidden */}
          {trackItems.map((item) => (
            <TimelineItem key={item.id} item={item} timelineDuration={30} trackLocked={track.locked} trackHidden={!track.visible} />
          ))}

          {/* Render transitions for this track */}
          {trackTransitions.map((transition) => (
            <TransitionItem key={transition.id} transition={transition} trackHeight={track.height} trackHidden={!track.visible} />
          ))}

          {/* Locked track overlay indicator */}
          {track.locked && (
            <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
              <div className="text-xs text-muted-foreground/50 font-mono">LOCKED</div>
            </div>
          )}
        </div>
      </ContextMenuTrigger>
      {hasAnyItems && contextMenuFrame !== null && (
        <ContextMenuContent>
          <ContextMenuItem onClick={handleCloseGap}>
            Ripple Delete
          </ContextMenuItem>
        </ContextMenuContent>
      )}
    </ContextMenu>
  );
}, areTrackPropsEqual);
