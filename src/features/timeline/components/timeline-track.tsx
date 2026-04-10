import { useState, useRef, memo, useCallback, useMemo } from 'react';
import { createLogger } from '@/shared/logging/logger';

const logger = createLogger('TimelineTrack');
import type { TimelineTrack as TimelineTrackType, TimelineItem as TimelineItemType } from '@/types/timeline';
import type { MediaMetadata } from '@/types/storage';
import { TimelineDropGhostPreviews } from './timeline-drop-ghost-previews';
import { TimelineItem } from './timeline-item';
import { TransitionItem } from './transition-item';
import { useTimelineStore } from '../stores/timeline-store';
import { useTrackDropPreviewStore, type TrackDropGhostPreview } from '../stores/track-drop-preview-store';
import { useVisibleItems } from '../hooks/use-visible-items';
import { useItemsStore } from '../stores/items-store';
import { useCompositionsStore } from '../stores/compositions-store';
import { useSelectionStore } from '@/shared/state/selection';
import { useMediaLibraryStore } from '@/features/timeline/deps/media-library-store';
import { useProjectStore } from '@/features/timeline/deps/projects';
import { mediaLibraryService } from '@/features/timeline/deps/media-library-service';
import {
  resolveMediaUrl,
  getMediaDragData,
  type CompositionDragData,
} from '@/features/timeline/deps/media-library-resolver';
import { findNearestAvailableSpace } from '../utils/collision-utils';
import { resolveEffectiveTrackStates } from '../utils/group-utils';
import { mapWithConcurrency } from '@/shared/async/async-utils';
import { useExternalDragPreview } from '../hooks/use-external-drag-preview';
import { useCompositionNavigationStore } from '../stores/composition-navigation-store';
import { wouldCreateCompositionCycle } from '../utils/composition-graph';
import {
  createTimelineTemplateItem,
  getDefaultGeneratedLayerDurationInFrames,
  isTimelineTemplateDragData,
} from '../utils/generated-layer-items';
import { findCompatibleTrackForItemType } from '../utils/track-item-compatibility';
import {
  buildDroppedMediaTimelineItems,
  getDroppedMediaDurationInFrames,
  type DroppableMediaType,
} from '../utils/dropped-media';
import {
  buildDroppedCompositionTimelineItems,
  compositionHasOwnedAudio,
} from '../utils/dropped-composition';
import {
  buildGhostPreviewsFromTrackMediaDropPlan,
  planTrackMediaDropPlacements,
} from '../utils/track-media-drop';
import {
  applyResolvedTimelineDrop,
  resolveDroppedMediaEntriesFromExternalFiles,
  resolveDroppedMediaEntriesFromPayload,
  type DroppedMediaEntry,
} from '../utils/drop-execution';
import { toast } from 'sonner';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import {
  isDroppableMediaType,
  isValidDragMediaItem,
} from '../utils/drag-drop-preview';
import { useZoomStore } from '../stores/zoom-store';

interface TimelineTrackProps {
  track: TimelineTrackType;
}

type GhostPreviewItem = TrackDropGhostPreview;

const MULTI_DROP_METADATA_CONCURRENCY = 3;

/**
 * Custom equality for TimelineTrack memo - only track identity matters.
 * Items and transitions are fetched from stores internally.
 */
function areTrackPropsEqual(
  prev: TimelineTrackProps,
  next: TimelineTrackProps
): boolean {
  return prev.track === next.track;
}

function frameToPixelsNow(frame: number): number {
  const fps = useTimelineStore.getState().fps;
  const pixelsPerSecond = useZoomStore.getState().pixelsPerSecond;
  return fps > 0 ? (frame / fps) * pixelsPerSecond : 0;
}

function pixelsToFrameNow(pixels: number): number {
  const fps = useTimelineStore.getState().fps;
  const pixelsPerSecond = useZoomStore.getState().pixelsPerSecond;
  return fps > 0 && pixelsPerSecond > 0
    ? Math.round((pixels / pixelsPerSecond) * fps)
    : 0;
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
  const [isExternalDragOver, setIsExternalDragOver] = useState(false);
  const [contextMenuFrame, setContextMenuFrame] = useState<number | null>(null);
  const [menuKey, setMenuKey] = useState(0);
  const trackRef = useRef<HTMLDivElement>(null);

  // Resolve whether this track is effectively disabled for drops.
  // Uses the shared resolveEffectiveTrackStates helper so group-inherited
  // locked/visible/muted flags are consistent with the rest of the codebase.
  const isDropDisabled = useTimelineStore((s) => {
    const effective = resolveEffectiveTrackStates(s.tracks).find((t) => t.id === track.id);
    if (!effective) return track.locked;
    if (effective.locked) return true;
    const kind = effective.kind;
    if (kind === 'audio') return effective.muted;
    if (kind === 'video') return effective.visible === false;
    return effective.visible === false || effective.muted;
  });

  // Virtualized items/transitions â€” only those overlapping the visible viewport + buffer
  const { visibleItems: trackItems, visibleTransitions: trackTransitions } = useVisibleItems(track.id);
  // Full item count â€” used for context menu guard (must not depend on virtualized subset)
  const hasAnyItems = useItemsStore((s) => (s.itemsByTrackId[track.id]?.length ?? 0) > 0);
  const addItem = useTimelineStore((s) => s.addItem);
  const addItems = useTimelineStore((s) => s.addItems);
  const fps = useTimelineStore((s) => s.fps);
  const closeGapAtPosition = useTimelineStore((s) => s.closeGapAtPosition);
  const allGhostPreviews = useTrackDropPreviewStore((s) => s.ghostPreviews);
  const setTrackGhostPreviews = useTrackDropPreviewStore((s) => s.setGhostPreviews);
  const clearTrackGhostPreviews = useTrackDropPreviewStore((s) => s.clearGhostPreviews);
  const getMedia = useMediaLibraryStore((s) => s.mediaItems);
  const importHandlesForPlacement = useMediaLibraryStore((s) => s.importHandlesForPlacement);

  const ghostPreviews = useMemo(
    () => allGhostPreviews.filter((ghost) => ghost.targetTrackId === track.id),
    [allGhostPreviews, track.id]
  );

  const getDropFrame = useCallback((event: React.DragEvent): number | null => {
    if (!trackRef.current) {
      return null;
    }

    const timelineContainer = trackRef.current.closest('.timeline-container') as HTMLElement | null;
    if (!timelineContainer) {
      return null;
    }

    const scrollLeft = timelineContainer.scrollLeft || 0;
    const containerRect = timelineContainer.getBoundingClientRect();
    const offsetX = (event.clientX - containerRect.left) + scrollLeft;
    return pixelsToFrameNow(offsetX);
  }, []);

  const getCurrentCanvasSize = useCallback(() => {
    const liveProject = useProjectStore.getState().currentProject;
    return {
      width: liveProject?.metadata.width ?? 1920,
      height: liveProject?.metadata.height ?? 1080,
    };
  }, []);

  const resolveTimelineItemsForEntries = useCallback(async (
    entries: DroppedMediaEntry[],
    dropFrame: number
  ): Promise<{ items: TimelineItemType[]; tracks: TimelineTrackType[] }> => {
    const { plannedItems, tracks: workingTracks } = planTrackMediaDropPlacements({
      entries: entries.map((entry) => ({
        payload: entry,
        label: entry.label,
        mediaType: entry.mediaType,
        durationInFrames: getDroppedMediaDurationInFrames(entry.media, entry.mediaType, fps),
        hasLinkedAudio: entry.mediaType === 'video' && !!entry.media.audioCodec,
      })),
      dropFrame,
      tracks: useTimelineStore.getState().tracks,
      existingItems: useTimelineStore.getState().items,
      dropTargetTrackId: track.id,
    });

    if (plannedItems.length === 0) {
      return { items: [], tracks: workingTracks };
    }

    const resolvedTimelineItems = await mapWithConcurrency(
      plannedItems,
      MULTI_DROP_METADATA_CONCURRENCY,
      async (planned): Promise<TimelineItemType[] | null> => {
        const { entry, placements } = planned;
        const droppedEntry = entry.payload;
        const needsThumbnail = entry.mediaType === 'video' || entry.mediaType === 'image';
        const [blobUrl, thumbnailUrl] = await Promise.all([
          resolveMediaUrl(droppedEntry.mediaId),
          needsThumbnail
            ? mediaLibraryService.getThumbnailBlobUrl(droppedEntry.mediaId)
            : Promise.resolve(null),
        ]);

        if (!blobUrl) {
          logger.error('Failed to get media blob URL for', entry.label);
          return null;
        }

        const primaryPlacement = placements.find((placement) => placement.mediaType !== 'audio') ?? placements[0]!;
        const linkedAudioPlacement = placements.find((placement) => placement.mediaType === 'audio');
        const canvasSize = getCurrentCanvasSize();

        return buildDroppedMediaTimelineItems({
          media: droppedEntry.media,
          mediaId: droppedEntry.mediaId,
          mediaType: entry.mediaType,
          label: entry.label,
          timelineFps: fps,
          blobUrl,
          thumbnailUrl,
          canvasWidth: canvasSize.width,
          canvasHeight: canvasSize.height,
          placement: {
            primary: {
              trackId: primaryPlacement.trackId,
              from: primaryPlacement.from,
              durationInFrames: primaryPlacement.durationInFrames,
            },
            linkedAudio: linkedAudioPlacement
              ? {
                trackId: linkedAudioPlacement.trackId,
                from: linkedAudioPlacement.from,
                durationInFrames: linkedAudioPlacement.durationInFrames,
              }
              : undefined,
          },
          linkVideoAudio: planned.linkVideoAudio,
        });
      }
    );

    return {
      items: resolvedTimelineItems.flatMap((timelineItems) => timelineItems ?? []),
      tracks: workingTracks,
    };
  }, [fps, getCurrentCanvasSize, track.id]);

  const buildGhostPreviewsForEntries = useCallback((
    entries: Array<{ label: string; mediaType: DroppableMediaType; duration?: number; hasLinkedAudio?: boolean }>,
    dropFrame: number
  ): GhostPreviewItem[] => {
    const { plannedItems } = planTrackMediaDropPlacements({
      entries: entries.map((entry) => ({
        payload: entry,
        label: entry.label,
        mediaType: entry.mediaType,
        durationInFrames: getDroppedMediaDurationInFrames(
          { duration: entry.duration ?? 0 } as Pick<MediaMetadata, 'duration'>,
          entry.mediaType,
          fps
        ),
        hasLinkedAudio: entry.hasLinkedAudio,
      })),
      dropFrame,
      tracks: useTimelineStore.getState().tracks,
      existingItems: useTimelineStore.getState().items,
      dropTargetTrackId: track.id,
    });

    return buildGhostPreviewsFromTrackMediaDropPlan({
      plannedItems,
      frameToPixels: frameToPixelsNow,
    });
  }, [fps, track.id]);

  const buildGenericExternalGhostPreviews = useCallback((
    dropFrame: number,
    itemCount: number
  ): GhostPreviewItem[] => {
    const placeholderDuration = fps * 3;
    const finalPosition = findNearestAvailableSpace(
      Math.max(0, dropFrame),
      placeholderDuration,
      track.id,
      useTimelineStore.getState().items
    );

    if (finalPosition === null) {
      return [];
    }

    return [{
      left: frameToPixelsNow(finalPosition),
      width: frameToPixelsNow(placeholderDuration),
      label: itemCount > 1 ? `${itemCount} files` : 'Drop media',
      type: 'external-file',
      targetTrackId: track.id,
    }];
  }, [fps, track.id]);

  const buildGhostPreviewForTemplate = useCallback((
    template: unknown,
    dropFrame: number,
  ): GhostPreviewItem[] => {
    if (!isTimelineTemplateDragData(template)) {
      return [];
    }

    const store = useTimelineStore.getState();
    const durationInFrames = getDefaultGeneratedLayerDurationInFrames(fps);
    const targetTrack = findCompatibleTrackForItemType({
      tracks: store.tracks,
      items: store.items,
      itemType: template.itemType,
      preferredTrackId: track.id,
      allowPreferredTrackFallback: false,
    });
    if (!targetTrack) {
      return [];
    }

    const finalPosition = findNearestAvailableSpace(
      Math.max(0, dropFrame),
      durationInFrames,
      targetTrack.id,
      store.items,
    );
    if (finalPosition === null) {
      return [];
    }

    return [{
      left: frameToPixelsNow(finalPosition),
      width: frameToPixelsNow(durationInFrames),
      label: template.label,
      type: template.itemType,
      targetTrackId: targetTrack.id,
    }];
  }, [fps, track.id]);

  const {
    clearExternalPreviewSession,
    externalPreviewItemsRef,
    lastDragFrameRef,
    primeExternalPreviewEntries,
  } = useExternalDragPreview<GhostPreviewItem>({
    buildGhostPreviews: buildGhostPreviewsForEntries,
    setGhostPreviews: setTrackGhostPreviews,
    onError: (error) => {
      logger.warn('Failed to build external drag preview:', error);
    },
  });

  const buildTimelineTemplateItem = useCallback((template: unknown, dropFrame: number): TimelineItemType | null => {
    if (!isTimelineTemplateDragData(template)) {
      return null;
    }

    const store = useTimelineStore.getState();
    const durationInFrames = getDefaultGeneratedLayerDurationInFrames(fps);
    const targetTrack = findCompatibleTrackForItemType({
      tracks: store.tracks,
      items: store.items,
      itemType: template.itemType,
      preferredTrackId: track.id,
      allowPreferredTrackFallback: false,
    });
    if (!targetTrack) {
      return null;
    }

    const finalPosition = findNearestAvailableSpace(
      Math.max(0, dropFrame),
      durationInFrames,
      targetTrack.id,
      store.items,
    );
    if (finalPosition === null) {
      return null;
    }

    const canvasSize = getCurrentCanvasSize();

    return createTimelineTemplateItem({
      template,
      placement: {
        trackId: targetTrack.id,
        from: finalPosition,
        durationInFrames,
        canvasWidth: canvasSize.width,
        canvasHeight: canvasSize.height,
      },
    });
  }, [fps, getCurrentCanvasSize, track.id]);

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
    const clickedFrame = pixelsToFrameNow(offsetX);

    // Check if this frame is in a gap - just track the frame, let Radix handle menu
    if (isFrameInGap(clickedFrame)) {
      setContextMenuFrame(clickedFrame);
    } else {
      // Clicked on a clip area, prevent track menu so clip menu can show
      e.preventDefault();
      setContextMenuFrame(null);
    }
  }, [isFrameInGap]);

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
    if (isDropDisabled) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'none';
      return;
    }

    const data = getMediaDragData();
    const hasExternalFiles = !data && e.dataTransfer.types.includes('Files');
    if (!data && !hasExternalFiles) {
      setIsExternalDragOver(false);
      clearTrackGhostPreviews();
      return;
    }

    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setIsDragOver(true);
    setIsExternalDragOver(hasExternalFiles);

    const dropFrame = getDropFrame(e);
    if (dropFrame === null) {
      clearTrackGhostPreviews();
      return;
    }
    lastDragFrameRef.current = dropFrame;

    if (hasExternalFiles) {
      if (externalPreviewItemsRef.current && externalPreviewItemsRef.current.length > 0) {
        const previews = buildGhostPreviewsForEntries(externalPreviewItemsRef.current, dropFrame);
        if (previews.length === 0) {
          e.dataTransfer.dropEffect = 'none';
          setIsDragOver(false);
          setIsExternalDragOver(false);
        }
        setTrackGhostPreviews(previews);
      } else {
        const fileItemCount = Array.from(e.dataTransfer.items).filter((item) => item.kind === 'file').length;
        setTrackGhostPreviews(buildGenericExternalGhostPreviews(dropFrame, Math.max(1, fileItemCount)));
        primeExternalPreviewEntries(e.dataTransfer);
      }
      return;
    }

    if (!data) {
      clearTrackGhostPreviews();
      return;
    }

    const previews: GhostPreviewItem[] = [];

    if (data.type === 'composition') {
      const activeCompositionId = useCompositionNavigationStore.getState().activeCompositionId;
      if (wouldCreateCompositionCycle({
        parentCompositionId: activeCompositionId,
        insertedCompositionId: data.compositionId,
        compositionById: useCompositionsStore.getState().compositionById,
      })) {
        e.dataTransfer.dropEffect = 'none';
        clearTrackGhostPreviews();
        return;
      }

      const store = useTimelineStore.getState();
      const compositionById = useCompositionsStore.getState().compositionById;
      const composition = compositionById[data.compositionId];
      if (!composition) {
        e.dataTransfer.dropEffect = 'none';
        clearTrackGhostPreviews();
        return;
      }
      const hasOwnedAudio = compositionHasOwnedAudio({ composition, compositionById });
      const { plannedItems } = planTrackMediaDropPlacements({
        entries: [{
          payload: data,
          label: data.name,
          mediaType: 'video',
          durationInFrames: data.durationInFrames,
          hasLinkedAudio: hasOwnedAudio,
        }],
        dropFrame,
        tracks: store.tracks,
        existingItems: store.items,
        dropTargetTrackId: track.id,
      });
      const plannedItem = plannedItems[0];
      if (!plannedItem) {
        e.dataTransfer.dropEffect = 'none';
        setIsDragOver(false);
        clearTrackGhostPreviews();
        return;
      }
      previews.push(
        ...buildGhostPreviewsFromTrackMediaDropPlan({
          plannedItems: [plannedItem],
          frameToPixels: frameToPixelsNow,
        }).map((preview) => ({
          ...preview,
          label: data.name,
          type: preview.type === 'video' ? 'composition' as const : preview.type,
        }))
      );
      setTrackGhostPreviews(previews);
      return;
    }

    if (data.type === 'timeline-template') {
      const previews = buildGhostPreviewForTemplate(data, dropFrame);
      if (previews.length === 0) {
        e.dataTransfer.dropEffect = 'none';
        setIsDragOver(false);
      }
      setTrackGhostPreviews(previews);
      return;
    }

    if (data.type === 'media-items' && data.items) {
      const rawItems = Array.isArray(data.items) ? data.items : [];
      const validItems = rawItems.filter(isValidDragMediaItem);
      if (validItems.length !== rawItems.length) {
        logger.warn('Skipping invalid media-items preview payload entries', {
          invalidCount: rawItems.length - validItems.length,
        });
      }

      const mediaById = new Map(getMedia.map((media) => [media.id, media]));
      const nextPreviews = buildGhostPreviewsForEntries(
        validItems.map((item) => ({
          label: item.fileName,
          mediaType: item.mediaType,
          duration: item.duration,
          hasLinkedAudio: item.mediaType === 'video' && !!mediaById.get(item.mediaId)?.audioCodec,
        })),
        dropFrame
      );
      if (nextPreviews.length === 0) {
        e.dataTransfer.dropEffect = 'none';
        setIsDragOver(false);
      }
      previews.push(...nextPreviews);
      setTrackGhostPreviews(previews);
      return;
    }

    if (data.type === 'media-item' && data.mediaId && data.mediaType && data.fileName) {
      const media = getMedia.find((entry) => entry.id === data.mediaId);
      if (!media || !isDroppableMediaType(data.mediaType)) {
        clearTrackGhostPreviews();
        return;
      }

      const itemDuration = getDroppedMediaDurationInFrames(media, data.mediaType, fps);
      const nextPreviews = buildGhostPreviewsForEntries([
        {
          label: data.fileName,
          mediaType: data.mediaType,
          duration: itemDuration / fps,
          hasLinkedAudio: data.mediaType === 'video' && !!media.audioCodec,
        },
      ], dropFrame);
      if (nextPreviews.length === 0) {
        e.dataTransfer.dropEffect = 'none';
        setIsDragOver(false);
      }
      previews.push(...nextPreviews);
    }

    setTrackGhostPreviews(previews);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    setIsExternalDragOver(false);
    clearTrackGhostPreviews();
    clearExternalPreviewSession();
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    setIsExternalDragOver(false);
    clearTrackGhostPreviews();
    clearExternalPreviewSession();

    if (isDropDisabled) {
      return;
    }

    const dropFrame = getDropFrame(e);
    if (dropFrame === null) {
      return;
    }

    const rawJson = e.dataTransfer.getData('application/json');
    if (rawJson) {
      try {
        const data = JSON.parse(rawJson);

        if (data.type === 'composition') {
          const activeCompositionId = useCompositionNavigationStore.getState().activeCompositionId;
          if (wouldCreateCompositionCycle({
            parentCompositionId: activeCompositionId,
            insertedCompositionId: data.compositionId,
            compositionById: useCompositionsStore.getState().compositionById,
          })) {
            return;
          }

          const { compositionId, name, durationInFrames } = data as CompositionDragData;
          const store = useTimelineStore.getState();
          const compositionById = useCompositionsStore.getState().compositionById;
          const composition = compositionById[compositionId];
          if (!composition) {
            logger.warn('Cannot drop composition: compound clip definition not found');
            return;
          }
          const { plannedItems, tracks: nextTracks } = planTrackMediaDropPlacements({
            entries: [{
              payload: data,
              label: name,
              mediaType: 'video',
              durationInFrames,
              hasLinkedAudio: compositionHasOwnedAudio({ composition, compositionById }),
            }],
            dropFrame,
            tracks: store.tracks,
            existingItems: store.items,
            dropTargetTrackId: track.id,
          });
          const plannedItem = plannedItems[0];
          if (!plannedItem) {
            logger.warn('Cannot drop composition: no available placement found');
            return;
          }

          if (nextTracks !== store.tracks) {
            useTimelineStore.getState().setTracks(nextTracks);
          }

          const droppedItems = buildDroppedCompositionTimelineItems({
            compositionId,
            composition,
            label: name,
            placements: plannedItem.placements,
          });
          if (droppedItems.length === 0) {
            logger.warn('Cannot drop composition: failed to build compound clip wrappers');
            return;
          }

          addItems(droppedItems);
          return;
        }

        if (isTimelineTemplateDragData(data)) {
          const templateItem = buildTimelineTemplateItem(data, dropFrame);
          if (!templateItem) {
            toast.error('Unable to add dropped timeline item');
            return;
          }

          addItem(templateItem);
          return;
        }

        const entries = resolveDroppedMediaEntriesFromPayload(data, getMedia, logger);

        if (entries.length === 0) {
          return;
        }

        const dropResult = await resolveTimelineItemsForEntries(entries, dropFrame);
        applyResolvedTimelineDrop({
          addItem,
          addItems,
          currentTracks: useTimelineStore.getState().tracks,
          dropResult,
          emptyMessage: 'Unable to add dropped media items',
          notify: toast,
          partialFailureLabel: 'dropped media items',
          requestedCount: entries.length,
          setTracks: useTimelineStore.getState().setTracks,
        });
        return;
      } catch (error) {
        logger.warn('Failed to parse drag payload, falling back to file-drop handling', error);
      }
    }

    if (!e.dataTransfer.types.includes('Files')) {
      return;
    }

    const droppedEntries = await resolveDroppedMediaEntriesFromExternalFiles({
      dataTransfer: e.dataTransfer,
      importHandlesForPlacement,
      notify: toast,
    });
    if (!droppedEntries) {
      return;
    }

    const dropResult = await resolveTimelineItemsForEntries(droppedEntries, dropFrame);
    applyResolvedTimelineDrop({
      addItem,
      addItems,
      currentTracks: useTimelineStore.getState().tracks,
      dropResult,
      emptyMessage: 'Unable to add dropped files to the timeline',
      notify: toast,
      partialFailureLabel: 'dropped files',
      requestedCount: droppedEntries.length,
      setTracks: useTimelineStore.getState().setTracks,
    });
  };

  return (
    <ContextMenu key={menuKey} modal={false}>
      <ContextMenuTrigger asChild disabled={track.locked}>
        <div
          ref={trackRef}
          data-track-id={track.id}
          className="relative"
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
          {!isDropDisabled && (
            <TimelineDropGhostPreviews
              ghostPreviews={ghostPreviews}
              showEmptyOverlay={isDragOver && !isExternalDragOver && ghostPreviews.length === 0}
              variant="track"
            />
          )}

          {/* Render all items for this track - dimmed when track is hidden */}
          {trackItems.map((item) => (
            <TimelineItem key={item.id} item={item} timelineDuration={30} trackLocked={track.locked} trackHidden={!track.visible} />
          ))}

          {/* Render transitions for this track */}
          {track.kind !== 'audio' && trackTransitions.map((transition) => (
            <TransitionItem key={transition.id} transition={transition} trackHidden={!track.visible} />
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
