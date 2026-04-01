import { memo, useCallback, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import type { TimelineItem as TimelineItemType, CompositionItem } from '@/types/timeline';
import type { MediaMetadata } from '@/types/storage';
import { createLogger } from '@/shared/logging/logger';
import { useTimelineZoomContext } from '../contexts/timeline-zoom-context';
import { useTimelineStore } from '../stores/timeline-store';
import { useNewTrackZonePreviewStore, type NewTrackZoneGhostPreview } from '../stores/new-track-zone-preview-store';
import { useMediaLibraryStore } from '@/features/timeline/deps/media-library-store';
import { useProjectStore } from '@/features/timeline/deps/projects';
import { mediaLibraryService } from '@/features/timeline/deps/media-library-service';
import {
  resolveMediaUrl,
  getMediaDragData,
  getMediaType,
  extractValidMediaFileEntriesFromDataTransfer,
  type CompositionDragData,
} from '@/features/timeline/deps/media-library-resolver';
import { findNearestAvailableSpace } from '../utils/collision-utils';
import { mapWithConcurrency } from '@/shared/async/async-utils';
import { useCompositionNavigationStore } from '../stores/composition-navigation-store';
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
  buildGhostPreviewsFromNewTrackZonePlan,
  planNewTrackZonePlacements,
} from '../utils/new-track-zone-media';
import { preflightFirstTimelineVideoProjectMatch } from '../utils/external-file-project-match';

const logger = createLogger('TimelineMediaDropZone');

interface TimelineMediaDropZoneProps {
  height: number;
  zone: 'video' | 'audio';
  anchorTrackId: string;
}

export type GhostPreviewItem = NewTrackZoneGhostPreview;

interface DragMediaItem {
  mediaId: string;
  mediaType: DroppableMediaType;
  fileName: string;
  duration: number;
}

interface DroppedMediaEntry {
  media: MediaMetadata;
  mediaId: string;
  mediaType: DroppableMediaType;
  label: string;
}

interface PreviewEntry {
  label: string;
  mediaType: DroppableMediaType;
  duration?: number;
  hasLinkedAudio?: boolean;
}

const MULTI_DROP_METADATA_CONCURRENCY = 3;

function getGhostHighlightClasses(ghostPreviews: GhostPreviewItem[]): string {
  if (ghostPreviews.some((ghost) => ghost.type === 'audio')) {
    return 'border-timeline-audio/60 bg-timeline-audio/10';
  }
  if (ghostPreviews.some((ghost) => ghost.type === 'video')) {
    return 'border-timeline-video/60 bg-timeline-video/10';
  }
  if (ghostPreviews.some((ghost) => ghost.type === 'text')) {
    return 'border-timeline-text/60 bg-timeline-text/10';
  }
  if (ghostPreviews.some((ghost) => ghost.type === 'shape')) {
    return 'border-timeline-shape/60 bg-timeline-shape/10';
  }
  if (ghostPreviews.some((ghost) => ghost.type === 'adjustment')) {
    return 'border-slate-400/60 bg-slate-400/10';
  }
  if (ghostPreviews.some((ghost) => ghost.type === 'image')) {
    return 'border-timeline-image/60 bg-timeline-image/10';
  }
  if (ghostPreviews.some((ghost) => ghost.type === 'composition')) {
    return 'border-violet-400/60 bg-violet-600/10';
  }
  if (ghostPreviews.some((ghost) => ghost.type === 'external-file')) {
    return 'border-orange-500/60 bg-orange-500/10';
  }
  return 'border-primary/50 bg-primary/10';
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isDroppableMediaType(value: unknown): value is DroppableMediaType {
  return value === 'video' || value === 'audio' || value === 'image';
}

function isValidDragMediaItem(value: unknown): value is DragMediaItem {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<DragMediaItem>;
  return isNonEmptyString(candidate.mediaId)
    && isDroppableMediaType(candidate.mediaType)
    && isNonEmptyString(candidate.fileName)
    && typeof candidate.duration === 'number'
    && Number.isFinite(candidate.duration);
}

export const TimelineMediaDropZone = memo(function TimelineMediaDropZone({
  height,
  zone,
  anchorTrackId,
}: TimelineMediaDropZoneProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [isExternalDragOver, setIsExternalDragOver] = useState(false);
  const zoneRef = useRef<HTMLDivElement>(null);
  const externalPreviewItemsRef = useRef<PreviewEntry[] | null>(null);
  const externalPreviewSignatureRef = useRef<string | null>(null);
  const externalPreviewPromiseRef = useRef<Promise<void> | null>(null);
  const externalPreviewTokenRef = useRef(0);
  const lastDragFrameRef = useRef(0);

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

  const buildGhostPreviewsForEntries = useCallback((entries: PreviewEntry[], dropFrame: number): GhostPreviewItem[] => {
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

  const clearExternalPreviewSession = useCallback(() => {
    externalPreviewItemsRef.current = null;
    externalPreviewSignatureRef.current = null;
    externalPreviewPromiseRef.current = null;
    externalPreviewTokenRef.current += 1;
  }, []);

  const primeExternalPreviewEntries = useCallback((dataTransfer: DataTransfer) => {
    const signature = `${dataTransfer.items.length}:${Array.from(dataTransfer.items)
      .map((item) => `${item.kind}:${item.type || 'unknown'}`)
      .join('|')}`;

    if (externalPreviewSignatureRef.current === signature && externalPreviewItemsRef.current) {
      return;
    }

    if (externalPreviewSignatureRef.current === signature && externalPreviewPromiseRef.current) {
      return;
    }

    clearExternalPreviewSession();
    externalPreviewSignatureRef.current = signature;
    const token = externalPreviewTokenRef.current;

    const previewPromise = (async () => {
      const { supported, entries } = await extractValidMediaFileEntriesFromDataTransfer(dataTransfer);
      if (!supported || token !== externalPreviewTokenRef.current) {
        return;
      }

      const previewEntries = entries.flatMap((entry) => (
        entry.mediaType === 'video' || entry.mediaType === 'audio' || entry.mediaType === 'image'
          ? [{
            label: entry.file.name,
            mediaType: entry.mediaType,
          }]
          : []
      ));

      externalPreviewItemsRef.current = previewEntries;
      externalPreviewPromiseRef.current = null;

      if (previewEntries.length > 0) {
        setZoneGhostPreviews(buildGhostPreviewsForEntries(previewEntries, lastDragFrameRef.current));
      }
    })().catch((error) => {
      if (token === externalPreviewTokenRef.current) {
        externalPreviewPromiseRef.current = null;
        logger.warn('Failed to build external drag preview:', error);
      }
    });

    externalPreviewPromiseRef.current = previewPromise;
  }, [buildGhostPreviewsForEntries, clearExternalPreviewSession, setZoneGhostPreviews]);

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
      const isInsideSubComp = useCompositionNavigationStore.getState().activeCompositionId !== null;
      if (isInsideSubComp || zone !== 'video') {
        e.dataTransfer.dropEffect = 'none';
        clearZoneGhostPreviews();
        return;
      }

      const previews = buildGhostPreviewsForEntries([
        {
          label: data.name,
          mediaType: 'image',
          duration: data.durationInFrames / fps,
        },
      ], dropFrame).map((preview) => ({
        ...preview,
        label: data.name,
        width: frameToPixels(data.durationInFrames),
        type: 'composition' as const,
        targetZone: 'video' as const,
      }));
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
          const isInsideSubComp = useCompositionNavigationStore.getState().activeCompositionId !== null;
          if (isInsideSubComp || zone !== 'video') {
            return;
          }

          const { compositionId, name, durationInFrames, width, height } = data as CompositionDragData;
          const currentTracks = useTimelineStore.getState().tracks;
          const createdTrack = ensureVideoZoneTrack(currentTracks);
          if (!createdTrack) {
            return;
          }

          const proposedPosition = Math.max(0, dropFrame);
          const storeItems = useTimelineStore.getState().items;
          const finalPosition = findNearestAvailableSpace(
            proposedPosition,
            durationInFrames,
            createdTrack.trackId,
            storeItems,
          );

          if (finalPosition === null) {
            logger.warn('Cannot drop composition into new track zone: no available space');
            return;
          }

          if (createdTrack.tracks !== currentTracks) {
            useTimelineStore.getState().setTracks(createdTrack.tracks);
          }

          const compositionItem: CompositionItem = {
            id: crypto.randomUUID(),
            type: 'composition',
            trackId: createdTrack.trackId,
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

        let entries: DroppedMediaEntry[] = [];
        if (data.type === 'media-items') {
          const rawItems = Array.isArray(data.items) ? data.items : [];
          const validItems = rawItems.filter(isValidDragMediaItem);
          if (validItems.length !== rawItems.length) {
            logger.warn('Skipping invalid media-items payload entries', {
              invalidCount: rawItems.length - validItems.length,
            });
          }

          const mediaById = new Map(getMedia.map((media) => [media.id, media]));
          entries = validItems.flatMap((dragItem: DragMediaItem) => {
            const media = mediaById.get(dragItem.mediaId);
            if (!media) {
              logger.error('Media not found:', dragItem.mediaId);
              return [];
            }

            return [{
              media,
              mediaId: dragItem.mediaId,
              mediaType: dragItem.mediaType,
              label: dragItem.fileName,
            }];
          });
        } else if (data.type === 'media-item' && data.mediaId && data.mediaType && data.fileName) {
          if (!isDroppableMediaType(data.mediaType)) {
            return;
          }

          const media = getMedia.find((entry) => entry.id === data.mediaId);
          if (!media) {
            logger.error('Media not found:', data.mediaId);
            return;
          }

          entries = [{
            media,
            mediaId: data.mediaId,
            mediaType: data.mediaType,
            label: data.fileName,
          }];
        }

        if (entries.length === 0) {
          return;
        }

        const dropResult = await resolveTimelineItemsForEntries(entries, dropFrame);
        if (dropResult.items.length === 0) {
          toast.error('Unable to add dropped media items');
          return;
        }

        if (dropResult.tracks !== useTimelineStore.getState().tracks) {
          useTimelineStore.getState().setTracks(dropResult.tracks);
        }

        if (dropResult.items.length < entries.length) {
          toast.warning(`Some dropped media items could not be added: ${entries.length - dropResult.items.length} failed`);
        }

        if (dropResult.items.length === 1) {
          addItem(dropResult.items[0]!);
        } else {
          addItems(dropResult.items);
        }
        return;
      } catch (error) {
        logger.warn('Failed to parse drag payload, falling back to file-drop handling', error);
      }
    }

    if (!e.dataTransfer.types.includes('Files')) {
      return;
    }

    const { supported, entries, errors } = await extractValidMediaFileEntriesFromDataTransfer(e.dataTransfer);
    if (!supported) {
      toast.warning('Drag-drop not supported. Please use Google Chrome.');
      return;
    }

    if (errors.length > 0) {
      toast.error(`Some files were rejected: ${errors.join(', ')}`);
    }

    if (entries.length === 0) {
      return;
    }

    try {
      await preflightFirstTimelineVideoProjectMatch(entries);
    } catch (error) {
      toast.error('Unable to inspect dropped file.', {
        description: error instanceof Error ? error.message : 'Please try again.',
      });
      return;
    }

    const importedMedia = await importHandlesForPlacement(entries.map((entry) => entry.handle));
    if (importedMedia.length === 0) {
      toast.error('Unable to import dropped files');
      return;
    }

    const droppedEntries: DroppedMediaEntry[] = importedMedia.flatMap((media) => {
      const mediaType = getMediaType(media.mimeType);
      if (!isDroppableMediaType(mediaType)) {
        return [];
      }
      return [{
        media,
        mediaId: media.id,
        mediaType,
        label: media.fileName,
      }];
    });

    if (droppedEntries.length === 0) {
      toast.warning('Dropped files were imported, but none could be placed on the timeline.');
      return;
    }

    const dropResult = await resolveTimelineItemsForEntries(droppedEntries, dropFrame);
    if (dropResult.items.length === 0) {
      toast.error('Unable to add dropped files to the timeline');
      return;
    }

    if (dropResult.tracks !== useTimelineStore.getState().tracks) {
      useTimelineStore.getState().setTracks(dropResult.tracks);
    }

    if (dropResult.items.length < droppedEntries.length) {
      toast.warning(`Some dropped files could not be added: ${droppedEntries.length - dropResult.items.length} failed`);
    }

    if (dropResult.items.length === 1) {
      addItem(dropResult.items[0]!);
    } else {
      addItems(dropResult.items);
    }
  }, [
    addItem,
    addItems,
    buildTimelineTemplateItem,
    clearZoneGhostPreviews,
    clearExternalPreviewSession,
    ensureVideoZoneTrack,
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
          className={`absolute rounded border-2 border-dashed pointer-events-none z-20 flex items-center px-2 ${
            ghost.type === 'composition'
              ? 'border-violet-400 bg-violet-600/20'
              : ghost.type === 'external-file'
              ? 'border-orange-500 bg-orange-500/15'
              : ghost.type === 'video'
              ? 'border-timeline-video bg-timeline-video/20'
              : ghost.type === 'audio'
              ? 'border-timeline-audio bg-timeline-audio/20'
              : ghost.type === 'text'
              ? 'border-timeline-text bg-timeline-text/20'
              : ghost.type === 'shape'
              ? 'border-timeline-shape bg-timeline-shape/20'
              : ghost.type === 'adjustment'
              ? 'border-slate-400 bg-slate-400/15'
              : 'border-timeline-image bg-timeline-image/20'
          }`}
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
