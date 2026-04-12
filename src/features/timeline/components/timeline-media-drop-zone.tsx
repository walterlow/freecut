import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import type { TimelineItem as TimelineItemType } from '@/types/timeline';
import type { MediaMetadata } from '@/types/storage';
import { createLogger } from '@/shared/logging/logger';
import { useTimelineZoomContext } from '../contexts/timeline-zoom-context';
import { useTimelineStore } from '../stores/timeline-store';
import { useCompositionsStore } from '../stores/compositions-store';
import {
  registerNewTrackZoneGhostOverlay,
  useNewTrackZonePreviewStore,
  type NewTrackZoneGhostPreview,
} from '../stores/new-track-zone-preview-store';
import { useTrackDropPreviewStore } from '../stores/track-drop-preview-store';
import { useMediaLibraryStore } from '@/features/timeline/deps/media-library-store';
import { useProjectStore } from '@/features/timeline/deps/projects';
import { mediaLibraryService } from '@/features/timeline/deps/media-library-service';
import {
  resolveMediaUrl,
  getMediaDragData,
  type CompositionDragData,
} from '@/features/timeline/deps/media-library-resolver';
import {
  buildCollisionTrackItemsMap,
  findNearestAvailableSpaceInTrackItems,
  type CollisionRect,
} from '../utils/collision-utils';
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
import { prewarmDroppedTimelineAudio } from '../utils/drop-audio-prewarm';
import {
  type ExternalDragPreviewEntry,
  getGhostHighlightClasses,
  getGhostPreviewItemClasses,
  isDroppableMediaType,
  isValidDragMediaItem,
} from '../utils/drag-drop-preview';
import {
  claimTimelineDropPreviewOwner,
  isTimelineDropPreviewOwner,
  registerTimelineDropPreviewOwner,
  releaseTimelineDropPreviewOwner,
} from '../utils/drop-preview-owner';
import { isDragPointInsideElement } from '../utils/effect-drop';

const logger = createLogger('TimelineMediaDropZone');

interface TimelineMediaDropZoneProps {
  height: number;
  zone: 'video' | 'audio';
  anchorTrackId: string;
}

export type GhostPreviewItem = NewTrackZoneGhostPreview;
type PreviewGhostEntry = Pick<ExternalDragPreviewEntry, 'label' | 'mediaType' | 'duration' | 'hasLinkedAudio'>;
type PendingDragPreview = {
  dropFrame: number;
  dragData: ReturnType<typeof getMediaDragData>;
  hasExternalFiles: boolean;
  externalPreviewItems: ExternalDragPreviewEntry[] | null;
  fileItemCount: number;
  dataTransfer: DataTransfer | null;
};

const MULTI_DROP_METADATA_CONCURRENCY = 3;

const NewTrackZoneGhostOverlay = memo(function NewTrackZoneGhostOverlay({
  zone,
  showEmptyOverlay,
}: {
  zone: 'video' | 'audio';
  showEmptyOverlay: boolean;
}) {
  const emptyOverlayRef = useRef<HTMLDivElement>(null);
  const highlightOverlayRef = useRef<HTMLDivElement>(null);
  const previewLayerRef = useRef<HTMLDivElement>(null);
  const previewNodesRef = useRef<Array<{ root: HTMLDivElement; label: HTMLSpanElement }>>([]);
  const previewCountRef = useRef(0);
  const showEmptyOverlayRef = useRef(showEmptyOverlay);

  const syncEmptyOverlayVisibility = useCallback(() => {
    if (!emptyOverlayRef.current) {
      return;
    }

    emptyOverlayRef.current.style.display = showEmptyOverlayRef.current && previewCountRef.current === 0 ? '' : 'none';
  }, []);

  const clearGhostPreviews = useCallback(() => {
    previewCountRef.current = 0;
    showEmptyOverlayRef.current = false;

    if (highlightOverlayRef.current) {
      highlightOverlayRef.current.style.display = 'none';
    }

    if (previewLayerRef.current) {
      previewLayerRef.current.replaceChildren();
    }

    previewNodesRef.current = [];
    syncEmptyOverlayVisibility();
  }, [syncEmptyOverlayVisibility]);

  const syncGhostPreviews = useCallback((ghostPreviews: NewTrackZoneGhostPreview[]) => {
    previewCountRef.current = ghostPreviews.length;

    if (highlightOverlayRef.current) {
      if (ghostPreviews.length === 0) {
        highlightOverlayRef.current.style.display = 'none';
      } else {
        highlightOverlayRef.current.className = `absolute inset-0 pointer-events-none z-10 rounded border border-dashed ${getGhostHighlightClasses(ghostPreviews)}`;
        highlightOverlayRef.current.style.display = '';
      }
    }

    const previewLayer = previewLayerRef.current;
    if (!previewLayer) {
      syncEmptyOverlayVisibility();
      return;
    }

    const previewNodes = previewNodesRef.current;
    while (previewNodes.length > ghostPreviews.length) {
      const removedNode = previewNodes.pop();
      removedNode?.root.remove();
    }

    for (let index = 0; index < ghostPreviews.length; index += 1) {
      const ghostPreview = ghostPreviews[index]!;
      let previewNode = previewNodes[index];

      if (!previewNode) {
        const root = document.createElement('div');
        root.className = 'absolute rounded border-2 border-dashed pointer-events-none z-20 flex items-center px-2';
        const label = document.createElement('span');
        label.className = 'truncate text-[10px] font-medium text-foreground/80';
        root.appendChild(label);
        previewLayer.appendChild(root);
        previewNode = { root, label };
        previewNodes[index] = previewNode;
      }

      previewNode.root.className = `absolute rounded border-2 border-dashed pointer-events-none z-20 flex items-center px-2 ${getGhostPreviewItemClasses(ghostPreview.type)}`;
      previewNode.root.style.left = `${ghostPreview.left}px`;
      previewNode.root.style.width = `${ghostPreview.width}px`;
      previewNode.root.style.top = '0';
      previewNode.root.style.height = '100%';
      previewNode.label.textContent = ghostPreview.label;
    }

    syncEmptyOverlayVisibility();
  }, [syncEmptyOverlayVisibility]);

  useLayoutEffect(() => {
    showEmptyOverlayRef.current = showEmptyOverlay;
    syncEmptyOverlayVisibility();
  }, [showEmptyOverlay, syncEmptyOverlayVisibility]);

  useEffect(() => {
    const unregister = registerNewTrackZoneGhostOverlay(zone, {
      sync: syncGhostPreviews,
      clear: clearGhostPreviews,
    });

    return () => {
      unregister();
      clearGhostPreviews();
    };
  }, [clearGhostPreviews, syncGhostPreviews, zone]);

  return (
    <>
      <div
        ref={emptyOverlayRef}
        className="absolute inset-0 pointer-events-none z-10 rounded border border-dashed border-primary/50 bg-primary/10"
        style={{ display: 'none' }}
      />
      <div
        ref={highlightOverlayRef}
        style={{ display: 'none' }}
      />
      <div ref={previewLayerRef} />
    </>
  );
});

export const TimelineMediaDropZone = memo(function TimelineMediaDropZone({
  height,
  zone,
  anchorTrackId,
}: TimelineMediaDropZoneProps) {
  const previewOwnerId = `zone:${zone}`;
  const [isDragOver, setIsDragOver] = useState(false);
  const [isExternalDragOver, setIsExternalDragOver] = useState(false);
  const zoneRef = useRef<HTMLDivElement>(null);
  const dragPreviewCacheRef = useRef<{
    dropFrame: number | null;
    dragData: unknown;
    hasExternalFiles: boolean;
    externalPreviewItems: unknown;
    fileItemCount: number;
  }>({
    dropFrame: null,
    dragData: null,
    hasExternalFiles: false,
    externalPreviewItems: null,
    fileItemCount: 0,
  });
  const previewEntryCacheRef = useRef<{
    dragData: ReturnType<typeof getMediaDragData>;
    entries: PreviewGhostEntry[] | null;
  }>({
    dragData: null,
    entries: null,
  });
  const collisionMapCacheRef = useRef<{
    itemsRef: TimelineItemType[] | null;
    map: Map<string, CollisionRect[]>;
  }>({
    itemsRef: null,
    map: new Map<string, CollisionRect[]>(),
  });
  const dragPreviewRafRef = useRef<number | null>(null);
  const pendingDragPreviewRef = useRef<PendingDragPreview | null>(null);
  const dragOverFlagsRef = useRef({ isDragOver: false, isExternalDragOver: false });

  const addItem = useTimelineStore((s) => s.addItem);
  const addItems = useTimelineStore((s) => s.addItems);
  const fps = useTimelineStore((s) => s.fps);
  const setZoneGhostPreviews = useNewTrackZonePreviewStore((s) => s.setGhostPreviews);
  const clearZoneGhostPreviews = useNewTrackZonePreviewStore((s) => s.clearGhostPreviews);
  const getMedia = useMediaLibraryStore((s) => s.mediaItems);
  const importHandlesForPlacement = useMediaLibraryStore((s) => s.importHandlesForPlacement);
  const { pixelsToFrame, frameToPixels } = useTimelineZoomContext();

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

  const getCollisionTrackItemsMap = useCallback(() => {
    const items = useTimelineStore.getState().items;
    const cache = collisionMapCacheRef.current;
    if (cache.itemsRef !== items) {
      cache.itemsRef = items;
      cache.map = buildCollisionTrackItemsMap(items);
    }
    return cache.map;
  }, []);

  const findNearestAvailablePreviewSpace = useCallback((
    proposedFrom: number,
    durationInFrames: number,
    targetTrackId: string,
  ): number | null => {
    const trackItems = getCollisionTrackItemsMap().get(targetTrackId) ?? [];
    return findNearestAvailableSpaceInTrackItems(
      Math.max(0, proposedFrom),
      durationInFrames,
      trackItems,
    );
  }, [getCollisionTrackItemsMap]);

  const updateDragOverFlags = useCallback((nextIsDragOver: boolean, nextIsExternalDragOver: boolean) => {
    if (dragOverFlagsRef.current.isDragOver !== nextIsDragOver) {
      dragOverFlagsRef.current.isDragOver = nextIsDragOver;
      setIsDragOver(nextIsDragOver);
    }
    if (dragOverFlagsRef.current.isExternalDragOver !== nextIsExternalDragOver) {
      dragOverFlagsRef.current.isExternalDragOver = nextIsExternalDragOver;
      setIsExternalDragOver(nextIsExternalDragOver);
    }
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
      existingTrackItemsById: getCollisionTrackItemsMap(),
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
  }, [anchorTrackId, fps, getCollisionTrackItemsMap, getCurrentCanvasSize, zone]);

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
      existingTrackItemsById: getCollisionTrackItemsMap(),
      anchorTrackId,
      zone,
      preferredTrackHeight,
    });

    return buildGhostPreviewsFromNewTrackZonePlan({
      plannedItems,
      frameToPixels,
    });
  }, [anchorTrackId, fps, frameToPixels, getCollisionTrackItemsMap, zone]);

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
    const finalPosition = findNearestAvailablePreviewSpace(dropFrame, durationInFrames, createdTrack.trackId);
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
  }, [ensureVideoZoneTrack, findNearestAvailablePreviewSpace, fps, frameToPixels, zone]);

  const {
    clearExternalPreviewSession,
    externalPreviewItemsRef,
    lastDragFrameRef,
    primeExternalPreviewEntries,
  } = useExternalDragPreview({
    onError: (error) => {
      logger.warn('Failed to build external drag preview:', error);
    },
  });

  const resetDragPreviewCache = useCallback(() => {
    dragPreviewCacheRef.current = {
      dropFrame: null,
      dragData: null,
      hasExternalFiles: false,
      externalPreviewItems: null,
      fileItemCount: 0,
    };
  }, []);

  const getPreviewEntriesForDragData = useCallback((dragData: ReturnType<typeof getMediaDragData>): PreviewGhostEntry[] | null => {
    if (!dragData) {
      return null;
    }

    const cache = previewEntryCacheRef.current;
    if (cache.dragData === dragData) {
      return cache.entries;
    }

    let nextEntries: PreviewGhostEntry[] | null = null;

    if (dragData.type === 'media-items' && Array.isArray(dragData.items)) {
      const mediaById = useMediaLibraryStore.getState().mediaById;
      const validItems = dragData.items.filter(isValidDragMediaItem);
      nextEntries = validItems.map((item) => ({
        label: item.fileName,
        mediaType: item.mediaType,
        duration: item.duration,
        hasLinkedAudio: item.mediaType === 'video' && !!mediaById[item.mediaId]?.audioCodec,
      }));
    } else if (dragData.type === 'media-item' && dragData.mediaId && dragData.mediaType && dragData.fileName) {
      const media = useMediaLibraryStore.getState().mediaById[dragData.mediaId];
      nextEntries = media && isDroppableMediaType(dragData.mediaType)
        ? [{
          label: dragData.fileName,
          mediaType: dragData.mediaType,
          duration: dragData.duration,
          hasLinkedAudio: dragData.mediaType === 'video' && !!media.audioCodec,
        }]
        : null;
    }

    cache.dragData = dragData;
    cache.entries = nextEntries;
    return nextEntries;
  }, []);

  const clearPendingDragPreview = useCallback(() => {
    pendingDragPreviewRef.current = null;
    if (dragPreviewRafRef.current !== null) {
      cancelAnimationFrame(dragPreviewRafRef.current);
      dragPreviewRafRef.current = null;
    }
  }, []);

  const shouldSkipDragPreviewUpdate = useCallback((params: {
    dropFrame: number;
    dragData: unknown;
    hasExternalFiles: boolean;
    externalPreviewItems: unknown;
    fileItemCount: number;
  }) => {
    const previous = dragPreviewCacheRef.current;
    const shouldSkip = previous.dropFrame === params.dropFrame
      && previous.dragData === params.dragData
      && previous.hasExternalFiles === params.hasExternalFiles
      && previous.externalPreviewItems === params.externalPreviewItems
      && previous.fileItemCount === params.fileItemCount;

    if (!shouldSkip) {
      dragPreviewCacheRef.current = params;
    }

    return shouldSkip;
  }, []);

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
    const finalPosition = findNearestAvailablePreviewSpace(dropFrame, durationInFrames, createdTrack.trackId);
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
  }, [ensureVideoZoneTrack, findNearestAvailablePreviewSpace, fps, getCurrentCanvasSize, zone]);

  const processPendingDragPreview = useCallback(() => {
    dragPreviewRafRef.current = null;
    const pending = pendingDragPreviewRef.current;
    pendingDragPreviewRef.current = null;

    if (!pending) {
      return;
    }

    if (!isTimelineDropPreviewOwner(previewOwnerId)) {
      return;
    }

    const setDropEffectNone = () => {
      if (pending.dataTransfer) {
        pending.dataTransfer.dropEffect = 'none';
      }
    };

    if (shouldSkipDragPreviewUpdate({
      dropFrame: pending.dropFrame,
      dragData: pending.dragData,
      hasExternalFiles: pending.hasExternalFiles,
      externalPreviewItems: pending.externalPreviewItems,
      fileItemCount: pending.fileItemCount,
    })) {
      return;
    }

    if (pending.hasExternalFiles) {
      if (pending.externalPreviewItems && pending.externalPreviewItems.length > 0) {
        const previews = buildGhostPreviewsForEntries(pending.externalPreviewItems, pending.dropFrame);
        if (previews.length === 0) {
          setDropEffectNone();
          updateDragOverFlags(false, false);
          resetDragPreviewCache();
          return;
        }
        setZoneGhostPreviews(previews);
      } else {
        setZoneGhostPreviews(buildGenericExternalGhostPreviews(pending.dropFrame, Math.max(1, pending.fileItemCount)));
        if (pending.dataTransfer) {
          primeExternalPreviewEntries(pending.dataTransfer);
        }
      }
      return;
    }

    const data = pending.dragData;
    if (!data) {
      clearZoneGhostPreviews();
      resetDragPreviewCache();
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
        setDropEffectNone();
        updateDragOverFlags(false, false);
        clearZoneGhostPreviews();
        resetDragPreviewCache();
        return;
      }

      const compositionById = useCompositionsStore.getState().compositionById;
      const composition = compositionById[data.compositionId];
      if (!composition) {
        setDropEffectNone();
        updateDragOverFlags(false, false);
        clearZoneGhostPreviews();
        resetDragPreviewCache();
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
        dropFrame: pending.dropFrame,
        tracks: currentTracks,
        existingItems: useTimelineStore.getState().items,
        existingTrackItemsById: getCollisionTrackItemsMap(),
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
        setDropEffectNone();
        updateDragOverFlags(false, false);
        resetDragPreviewCache();
      }
      setZoneGhostPreviews(previews);
      return;
    }

    if (data.type === 'timeline-template') {
      if (zone !== 'video') {
        setDropEffectNone();
        clearZoneGhostPreviews();
        resetDragPreviewCache();
        return;
      }

      const previews = buildGhostPreviewForTemplate(data, pending.dropFrame);
      if (previews.length === 0) {
        setDropEffectNone();
        updateDragOverFlags(false, false);
        resetDragPreviewCache();
      }
      setZoneGhostPreviews(previews);
      return;
    }

    const previewEntries = getPreviewEntriesForDragData(data);
    if (!previewEntries || previewEntries.length === 0) {
      clearZoneGhostPreviews();
      resetDragPreviewCache();
      return;
    }

    const previews = buildGhostPreviewsForEntries(previewEntries, pending.dropFrame);
    if (previews.length === 0) {
      setDropEffectNone();
      updateDragOverFlags(false, false);
      resetDragPreviewCache();
    }
    setZoneGhostPreviews(previews);
  }, [
    anchorTrackId,
    buildGenericExternalGhostPreviews,
    buildGhostPreviewForTemplate,
    buildGhostPreviewsForEntries,
    clearZoneGhostPreviews,
    frameToPixels,
    getCollisionTrackItemsMap,
    getPreviewEntriesForDragData,
    previewOwnerId,
    primeExternalPreviewEntries,
    resetDragPreviewCache,
    setZoneGhostPreviews,
    shouldSkipDragPreviewUpdate,
    updateDragOverFlags,
    zone,
  ]);

  const claimPreviewOwnership = useCallback((dataTransfer: DataTransfer | null) => {
    const data = getMediaDragData();
    const hasExternalFiles = !!dataTransfer && !data && dataTransfer.types.includes('Files');
    if (!data && !hasExternalFiles) {
      return;
    }

    if (claimTimelineDropPreviewOwner(previewOwnerId)) {
      clearZoneGhostPreviews();
      useTrackDropPreviewStore.getState().clearGhostPreviews();
    }
    updateDragOverFlags(true, hasExternalFiles);
  }, [clearZoneGhostPreviews, previewOwnerId, updateDragOverFlags]);

  const clearOwnedPreview = useCallback(() => {
    clearPendingDragPreview();
    updateDragOverFlags(false, false);
    clearZoneGhostPreviews();
    resetDragPreviewCache();
  }, [clearPendingDragPreview, clearZoneGhostPreviews, resetDragPreviewCache, updateDragOverFlags]);

  const handleDragEnterCapture = useCallback((e: React.DragEvent) => {
    claimPreviewOwnership(e.dataTransfer);
  }, [claimPreviewOwnership]);

  useEffect(() => {
    return registerTimelineDropPreviewOwner(previewOwnerId, clearOwnedPreview);
  }, [clearOwnedPreview, previewOwnerId]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    const data = getMediaDragData();
    const hasExternalFiles = !data && e.dataTransfer.types.includes('Files');
    if (!data && !hasExternalFiles) {
      clearPendingDragPreview();
      updateDragOverFlags(false, false);
      clearZoneGhostPreviews();
      resetDragPreviewCache();
      return;
    }

    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    claimPreviewOwnership(e.dataTransfer);
    updateDragOverFlags(true, hasExternalFiles);

    const dropFrame = getDropFrame(e);
    if (dropFrame === null) {
      clearPendingDragPreview();
      clearZoneGhostPreviews();
      resetDragPreviewCache();
      return;
    }
    lastDragFrameRef.current = dropFrame;

    const externalPreviewItems = externalPreviewItemsRef.current;
    const fileItemCount = hasExternalFiles && !externalPreviewItems
      ? Array.from(e.dataTransfer.items).filter((item) => item.kind === 'file').length
      : 0;
    pendingDragPreviewRef.current = {
      dropFrame,
      dragData: data,
      hasExternalFiles,
      externalPreviewItems,
      fileItemCount,
      dataTransfer: e.dataTransfer,
    };
    if (dragPreviewRafRef.current === null) {
      dragPreviewRafRef.current = requestAnimationFrame(processPendingDragPreview);
    }
  }, [
    clearZoneGhostPreviews,
    clearPendingDragPreview,
    claimPreviewOwnership,
    getDropFrame,
    processPendingDragPreview,
    resetDragPreviewCache,
    updateDragOverFlags,
  ]);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (isDragPointInsideElement(e, e.currentTarget)) {
      return;
    }
    releaseTimelineDropPreviewOwner(previewOwnerId);
    clearPendingDragPreview();
    updateDragOverFlags(false, false);
    clearZoneGhostPreviews();
    resetDragPreviewCache();
    clearExternalPreviewSession();
  }, [clearExternalPreviewSession, clearPendingDragPreview, clearZoneGhostPreviews, previewOwnerId, resetDragPreviewCache, updateDragOverFlags]);

  useEffect(() => () => {
    releaseTimelineDropPreviewOwner(previewOwnerId);
    clearPendingDragPreview();
  }, [clearPendingDragPreview, previewOwnerId]);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    releaseTimelineDropPreviewOwner(previewOwnerId);
    clearPendingDragPreview();
    updateDragOverFlags(false, false);
    clearZoneGhostPreviews();
    resetDragPreviewCache();
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
        prewarmDroppedTimelineAudio(entries, dropResult.items);
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
    prewarmDroppedTimelineAudio(droppedEntries, dropResult.items);
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
    clearPendingDragPreview,
    clearZoneGhostPreviews,
    clearExternalPreviewSession,
    getDropFrame,
    getMedia,
    importHandlesForPlacement,
    previewOwnerId,
    resetDragPreviewCache,
    resolveTimelineItemsForEntries,
    updateDragOverFlags,
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
      onDragEnterCapture={handleDragEnterCapture}
      onDragOver={handleDragOver}
      onDragLeaveCapture={handleDragLeave}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <NewTrackZoneGhostOverlay
        zone={zone}
        showEmptyOverlay={isDragOver && !isExternalDragOver}
      />
    </div>
  );
});
