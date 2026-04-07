import { memo, useCallback, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import type { TimelineItem as TimelineItemType } from '@/types/timeline';
import type { MediaMetadata } from '@/types/storage';
import { createLogger } from '@/shared/logging/logger';
import { useTimelineZoomContext } from '../contexts/timeline-zoom-context';
import { useTimelineStore } from '../stores/timeline-store';
import { useCompositionsStore } from '../stores/compositions-store';
import { useNewTrackZonePreviewStore, type NewTrackZoneGhostPreview } from '../stores/new-track-zone-preview-store';
import { useMediaLibraryStore } from '@/features/timeline/deps/media-library-store';
import { useProjectStore } from '@/features/timeline/deps/projects';
import { mediaLibraryService } from '@/features/timeline/deps/media-library-service';
import {
  resolveMediaUrl,
  getMediaDragData,
  type CompositionDragData,
} from '@/features/timeline/deps/media-library-resolver';
import { findNearestAvailableSpace } from '../utils/collision-utils';
import { mapWithConcurrency } from '@/shared/async/async-utils';
import { useExternalDragPreview } from '../hooks/use-external-drag-preview';
import { useCompositionNavigationStore } from '../stores/composition-navigation-store';
import { wouldCreateCompositionCycle } from '../utils/composition-graph';
import {
  createTimelineTemplateItem,
  getDefaultGeneratedLayerDurationInFrames,
  isTimelineTemplateDragData,
} from '../utils/generated-layer-items';
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
  buildGhostPreviewsFromNewTrackZonePlan,
  planNewTrackZonePlacements,
} from '../utils/new-track-zone-media';
import {
  applyResolvedTimelineDrop,
  resolveDroppedMediaEntriesFromExternalFiles,
  resolveDroppedMediaEntriesFromPayload,
  type DroppedMediaEntry,
} from '../utils/drop-execution';
import {
  getGhostHighlightClasses,
  getGhostPreviewItemClasses,
  isDroppableMediaType,
  isValidDragMediaItem,
} from '../utils/drag-drop-preview';

const logger = createLogger('TimelineMediaDropZone');

interface TimelineMediaDropZoneProps {
  height: number;
  zone: 'video' | 'audio';
  anchorTrackId: string;
}

export type GhostPreviewItem = NewTrackZoneGhostPreview;

const MULTI_DROP_METADATA_CONCURRENCY = 3;

export const TimelineMediaDropZone = memo(function TimelineMediaDropZone({
  height,
  zone,
  anchorTrackId,
}: TimelineMediaDropZoneProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [isExternalDragOver, setIsExternalDragOver] = useState(false);
  const zoneRef = useRef<HTMLDivElement>(null);

  const addItem = useTimelineStore((s) => s.addItem);
  const addItems = useTimelineStore((s) => s.addItems);
  const fps = useTimelineStore((s) => s.fps);
  const allGhostPreviews = useNewTrackZonePreviewStore((s) => s.ghostPreviews);
  const setZoneGhostPreviews = useNewTrackZonePreviewStore((s) => s.setGhostPreviews);
  const clearZoneGhostPreviews = useNewTrackZonePreviewStore((s) => s.clearGhostPreviews);
  const getMedia = useMediaLibraryStore((s) => s.mediaItems);
  const importHandlesForPlacement = useMediaLibraryStore((s) => s.importHandlesForPlacement);
  const { pixelsToFrame, frameToPixels } = useTimelineZoomContext();
  const ghostPreviews = useMemo(
    () => allGhostPreviews.filter((ghost) => ghost.targetZone === zone),
    [allGhostPreviews, zone]
  );
  const ghostHighlightClasses = useMemo(
    () => getGhostHighlightClasses(ghostPreviews),
    [ghostPreviews]
  );

  const getDropFrame = useCallback((event: React.DragEvent): number | null => {
    if (!zoneRef.current) {
      return null;
    }

    const timelineContainer = zoneRef.current.closest('.timeline-container') as HTMLElement | null;
    if (!timelineContainer) {
      return null;
    }

    const scrollLeft = timelineContainer.scrollLeft || 0;
    const containerRect = timelineContainer.getBoundingClientRect();
    const offsetX = (event.clientX - containerRect.left) + scrollLeft;
    return pixelsToFrame(offsetX);
  }, [pixelsToFrame]);

  const ensureVideoZoneTrack = useCallback((tracks: ReturnType<typeof useTimelineStore.getState>['tracks']) => {
    const preferredTrackHeight = tracks.find((track) => track.id === anchorTrackId)?.height ?? 64;
    const { plannedItems, tracks: nextTracks } = planNewTrackZonePlacements({
      entries: [{
        payload: null,
        label: '__zone__',
        mediaType: 'image',
        durationInFrames: 1,
      }],
      dropFrame: 0,
      tracks,
      existingItems: [],
      anchorTrackId,
      zone: 'video',
      preferredTrackHeight,
    });

    const trackId = plannedItems[0]?.placements[0]?.trackId;
    return trackId
      ? { trackId, tracks: nextTracks }
      : null;
  }, [anchorTrackId]);

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
  ): Promise<{ items: TimelineItemType[]; tracks: ReturnType<typeof useTimelineStore.getState>['tracks'] }> => {
    const currentTracks = useTimelineStore.getState().tracks;
    const preferredTrackHeight = currentTracks.find((track) => track.id === anchorTrackId)?.height ?? 64;
    const { plannedItems, tracks: workingTracks } = planNewTrackZonePlacements({
      entries: entries.map((entry) => ({
        payload: entry,
        label: entry.label,
        mediaType: entry.mediaType,
        durationInFrames: getDroppedMediaDurationInFrames(entry.media, entry.mediaType, fps),
        hasLinkedAudio: entry.mediaType === 'video' && !!entry.media.audioCodec,
      })),
      dropFrame,
      tracks: currentTracks,
      existingItems: useTimelineStore.getState().items,
      anchorTrackId,
      zone,
      preferredTrackHeight,
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
  }, [anchorTrackId, fps, getCurrentCanvasSize, zone]);

  const buildGhostPreviewsForEntries = useCallback((entries: Array<{
    label: string;
    mediaType: DroppableMediaType;
    duration?: number;
    hasLinkedAudio?: boolean;
  }>, dropFrame: number): GhostPreviewItem[] => {
    const currentTracks = useTimelineStore.getState().tracks;
    const preferredTrackHeight = currentTracks.find((track) => track.id === anchorTrackId)?.height ?? 64;
    const { plannedItems } = planNewTrackZonePlacements({
      entries: entries.map((entry) => ({
        payload: entry,
        label: entry.label,
        mediaType: entry.mediaType,
        durationInFrames: getDroppedMediaDurationInFrames(
          { duration: entry.duration ?? 0 } as Pick<MediaMetadata, 'duration'>,
          entry.mediaType,
          fps,
        ),
        hasLinkedAudio: entry.hasLinkedAudio,
      })),
      dropFrame,
      tracks: currentTracks,
      existingItems: useTimelineStore.getState().items,
      anchorTrackId,
      zone,
      preferredTrackHeight,
    });

    return buildGhostPreviewsFromNewTrackZonePlan({
      plannedItems,
      frameToPixels,
    });
  }, [anchorTrackId, fps, frameToPixels, zone]);

  const buildGenericExternalGhostPreviews = useCallback((dropFrame: number, itemCount: number): GhostPreviewItem[] => {
    const previews = buildGhostPreviewsForEntries([
      {
        label: itemCount > 1 ? `${itemCount} files` : 'Drop media',
        mediaType: zone === 'audio' ? 'audio' : 'image',
        duration: 3,
      },
    ], dropFrame);

    return previews.length > 0
      ? [{ ...previews[0]!, type: 'external-file', targetZone: zone }]
      : [];
  }, [buildGhostPreviewsForEntries, zone]);

  const buildGhostPreviewForTemplate = useCallback((template: unknown, dropFrame: number): GhostPreviewItem[] => {
    if (!isTimelineTemplateDragData(template) || zone !== 'video') {
      return [];
    }

    const currentTracks = useTimelineStore.getState().tracks;
    const createdTrack = ensureVideoZoneTrack(currentTracks);
    if (!createdTrack) {
      return [];
    }

    const durationInFrames = getDefaultGeneratedLayerDurationInFrames(fps);
    const finalPosition = findNearestAvailableSpace(
      Math.max(0, dropFrame),
      durationInFrames,
      createdTrack.trackId,
      useTimelineStore.getState().items,
    );
    if (finalPosition === null) {
      return [];
    }

    return [{
      left: frameToPixels(finalPosition),
      width: frameToPixels(durationInFrames),
      label: template.label,
      type: template.itemType,
      targetZone: 'video',
    }];
  }, [ensureVideoZoneTrack, fps, frameToPixels, zone]);

  const {
    clearExternalPreviewSession,
    externalPreviewItemsRef,
    lastDragFrameRef,
    primeExternalPreviewEntries,
  } = useExternalDragPreview<GhostPreviewItem>({
    buildGhostPreviews: buildGhostPreviewsForEntries,
    setGhostPreviews: setZoneGhostPreviews,
    onError: (error) => {
      logger.warn('Failed to build external drag preview:', error);
    },
  });

  const buildTimelineTemplateItem = useCallback((template: unknown, dropFrame: number): {
    item: TimelineItemType;
    tracks: ReturnType<typeof useTimelineStore.getState>['tracks'];
  } | null => {
    if (!isTimelineTemplateDragData(template) || zone !== 'video') {
      return null;
    }

    const currentTracks = useTimelineStore.getState().tracks;
    const createdTrack = ensureVideoZoneTrack(currentTracks);
    if (!createdTrack) {
      return null;
    }

    const durationInFrames = getDefaultGeneratedLayerDurationInFrames(fps);
    const finalPosition = findNearestAvailableSpace(
      Math.max(0, dropFrame),
      durationInFrames,
      createdTrack.trackId,
      useTimelineStore.getState().items,
    );
    if (finalPosition === null) {
      return null;
    }

    const canvasSize = getCurrentCanvasSize();

    return {
      item: createTimelineTemplateItem({
        template,
        placement: {
          trackId: createdTrack.trackId,
          from: finalPosition,
          durationInFrames,
          canvasWidth: canvasSize.width,
          canvasHeight: canvasSize.height,
        },
      }),
      tracks: createdTrack.tracks,
    };
  }, [ensureVideoZoneTrack, fps, getCurrentCanvasSize, zone]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    const data = getMediaDragData();
    const hasExternalFiles = !data && e.dataTransfer.types.includes('Files');
    if (!data && !hasExternalFiles) {
      setIsExternalDragOver(false);
      setIsDragOver(false);
      clearZoneGhostPreviews();
      return;
    }

    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setIsDragOver(true);
    setIsExternalDragOver(hasExternalFiles);

    const dropFrame = getDropFrame(e);
    if (dropFrame === null) {
      clearZoneGhostPreviews();
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
        setZoneGhostPreviews(previews);
      } else {
        const fileItemCount = Array.from(e.dataTransfer.items).filter((item) => item.kind === 'file').length;
        setZoneGhostPreviews(buildGenericExternalGhostPreviews(dropFrame, Math.max(1, fileItemCount)));
        primeExternalPreviewEntries(e.dataTransfer);
      }
      return;
    }

    if (!data) {
      clearZoneGhostPreviews();
      return;
    }

    if (data.type === 'composition') {
      const activeCompositionId = useCompositionNavigationStore.getState().activeCompositionId;
      if (
        zone !== 'video'
        || wouldCreateCompositionCycle({
          parentCompositionId: activeCompositionId,
          insertedCompositionId: data.compositionId,
          compositionById: useCompositionsStore.getState().compositionById,
        })
      ) {
        e.dataTransfer.dropEffect = 'none';
        setIsDragOver(false);
        clearZoneGhostPreviews();
        return;
      }

      const compositionById = useCompositionsStore.getState().compositionById;
      const composition = compositionById[data.compositionId];
      if (!composition) {
        e.dataTransfer.dropEffect = 'none';
        setIsDragOver(false);
        clearZoneGhostPreviews();
        return;
      }

      const currentTracks = useTimelineStore.getState().tracks;
      const preferredTrackHeight = currentTracks.find((candidate) => candidate.id === anchorTrackId)?.height ?? 64;
      const { plannedItems } = planNewTrackZonePlacements({
        entries: [{
          payload: data,
          label: data.name,
          mediaType: 'video',
          durationInFrames: data.durationInFrames,
          hasLinkedAudio: compositionHasOwnedAudio({ composition, compositionById }),
        }],
        dropFrame,
        tracks: currentTracks,
        existingItems: useTimelineStore.getState().items,
        anchorTrackId,
        zone,
        preferredTrackHeight,
      });
      const plannedItem = plannedItems[0];
      const previews = plannedItem
        ? buildGhostPreviewsFromNewTrackZonePlan({
          plannedItems: [plannedItem],
          frameToPixels,
        }).map((preview) => ({
          ...preview,
          label: data.name,
          type: preview.type === 'video' ? 'composition' as const : preview.type,
        }))
        : [];
      if (previews.length === 0) {
        e.dataTransfer.dropEffect = 'none';
        setIsDragOver(false);
      }
      setZoneGhostPreviews(previews);
      return;
    }

    if (data.type === 'timeline-template') {
      if (zone !== 'video') {
        e.dataTransfer.dropEffect = 'none';
        clearZoneGhostPreviews();
        return;
      }

      const previews = buildGhostPreviewForTemplate(data, dropFrame);
      if (previews.length === 0) {
        e.dataTransfer.dropEffect = 'none';
        setIsDragOver(false);
      }
      setZoneGhostPreviews(previews);
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
      const previews = buildGhostPreviewsForEntries(
        validItems.map((item) => ({
          label: item.fileName,
          mediaType: item.mediaType,
          duration: item.duration,
          hasLinkedAudio: item.mediaType === 'video' && !!mediaById.get(item.mediaId)?.audioCodec,
        })),
        dropFrame,
      );
      if (previews.length === 0) {
        e.dataTransfer.dropEffect = 'none';
        setIsDragOver(false);
      }
      setZoneGhostPreviews(previews);
      return;
    }

    if (data.type === 'media-item' && data.mediaId && data.mediaType && data.fileName) {
      const media = getMedia.find((entry) => entry.id === data.mediaId);
      if (!media || !isDroppableMediaType(data.mediaType)) {
        clearZoneGhostPreviews();
        return;
      }

      const itemDuration = getDroppedMediaDurationInFrames(media, data.mediaType, fps);
      const previews = buildGhostPreviewsForEntries([
        {
          label: data.fileName,
          mediaType: data.mediaType,
          duration: itemDuration / fps,
          hasLinkedAudio: data.mediaType === 'video' && !!media.audioCodec,
        },
      ], dropFrame);
      if (previews.length === 0) {
        e.dataTransfer.dropEffect = 'none';
        setIsDragOver(false);
      }
      setZoneGhostPreviews(previews);
      return;
    }

    clearZoneGhostPreviews();
  }, [
    buildGenericExternalGhostPreviews,
    buildGhostPreviewForTemplate,
    buildGhostPreviewsForEntries,
    clearZoneGhostPreviews,
    fps,
    frameToPixels,
    getDropFrame,
    getMedia,
    primeExternalPreviewEntries,
    setZoneGhostPreviews,
    zone,
  ]);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    setIsExternalDragOver(false);
    clearZoneGhostPreviews();
    clearExternalPreviewSession();
  }, [clearExternalPreviewSession, clearZoneGhostPreviews]);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    setIsExternalDragOver(false);
    clearZoneGhostPreviews();
    clearExternalPreviewSession();

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
          if (
            zone !== 'video'
            || wouldCreateCompositionCycle({
              parentCompositionId: activeCompositionId,
              insertedCompositionId: data.compositionId,
              compositionById: useCompositionsStore.getState().compositionById,
            })
          ) {
            return;
          }

          const { compositionId, name, durationInFrames } = data as CompositionDragData;
          const currentTracks = useTimelineStore.getState().tracks;
          const preferredTrackHeight = currentTracks.find((track) => track.id === anchorTrackId)?.height ?? 64;
          const compositionById = useCompositionsStore.getState().compositionById;
          const composition = compositionById[compositionId];
          if (!composition) {
            logger.warn('Cannot drop composition into new track zone: compound clip definition not found');
            return;
          }

          const { plannedItems, tracks: nextTracks } = planNewTrackZonePlacements({
            entries: [{
              payload: data,
              label: name,
              mediaType: 'video',
              durationInFrames,
              hasLinkedAudio: compositionHasOwnedAudio({ composition, compositionById }),
            }],
            dropFrame,
            tracks: currentTracks,
            existingItems: useTimelineStore.getState().items,
            anchorTrackId,
            zone,
            preferredTrackHeight,
          });
          const plannedItem = plannedItems[0];
          if (!plannedItem) {
            logger.warn('Cannot drop composition into new track zone: no available space');
            return;
          }

          if (nextTracks !== currentTracks) {
            useTimelineStore.getState().setTracks(nextTracks);
          }

          const droppedItems = buildDroppedCompositionTimelineItems({
            compositionId,
            composition,
            label: name,
            placements: plannedItem.placements,
          });
          if (droppedItems.length === 0) {
            logger.warn('Cannot drop composition into new track zone: failed to build compound clip wrappers');
            return;
          }

          addItems(droppedItems);
          return;
        }

        if (isTimelineTemplateDragData(data)) {
          const templateDrop = buildTimelineTemplateItem(data, dropFrame);
          if (!templateDrop) {
            toast.error('Unable to add dropped timeline item');
            return;
          }

          if (templateDrop.tracks !== useTimelineStore.getState().tracks) {
            useTimelineStore.getState().setTracks(templateDrop.tracks);
          }

          addItem(templateDrop.item);
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
  }, [
    addItem,
    addItems,
    anchorTrackId,
    buildTimelineTemplateItem,
    clearZoneGhostPreviews,
    clearExternalPreviewSession,
    getDropFrame,
    getMedia,
    importHandlesForPlacement,
    resolveTimelineItemsForEntries,
    zone,
  ]);

  if (height <= 0) {
    return null;
  }

  return (
    <div
      ref={zoneRef}
      className="relative"
      style={{ height: `${height}px` }}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isDragOver && !isExternalDragOver && ghostPreviews.length === 0 && (
        <div className="absolute inset-0 pointer-events-none z-10 rounded border border-dashed border-primary/50 bg-primary/10" />
      )}

      {ghostPreviews.length > 0 && (
        <div className={`absolute inset-0 pointer-events-none z-10 rounded border border-dashed ${ghostHighlightClasses}`} />
      )}

      {ghostPreviews.map((ghost, index) => (
        <div
          key={`${ghost.label}-${index}`}
          className={`absolute rounded border-2 border-dashed pointer-events-none z-20 flex items-center px-2 ${getGhostPreviewItemClasses(ghost.type)}`}
          style={{
            left: `${ghost.left}px`,
            width: `${ghost.width}px`,
            top: 0,
            height: '100%',
          }}
        >
          <span className="truncate text-[10px] font-medium text-foreground/80">{ghost.label}</span>
        </div>
      ))}
    </div>
  );
});
