import { useState, useRef, memo, useCallback, useMemo } from 'react';
import { createLogger } from '@/shared/logging/logger';

const logger = createLogger('TimelineTrack');
import type { TimelineTrack as TimelineTrackType, TimelineItem as TimelineItemType } from '@/types/timeline';
import type { MediaMetadata } from '@/types/storage';
import { TimelineItem } from './timeline-item';
import { TransitionItem } from './transition-item';
import { useTimelineStore } from '../stores/timeline-store';
import { useTrackDropPreviewStore, type TrackDropGhostPreview } from '../stores/track-drop-preview-store';
import { useVisibleItems } from '../hooks/use-visible-items';
import { useItemsStore } from '../stores/items-store';
import { useCompositionsStore } from '../stores/compositions-store';
import { useSelectionStore } from '@/shared/state/selection';
import { useTimelineZoomContext } from '../contexts/timeline-zoom-context';
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
import { resolveEffectiveTrackStates } from '../utils/group-utils';
import { mapWithConcurrency } from '@/shared/async/async-utils';
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
import { preflightFirstTimelineVideoProjectMatch } from '../utils/external-file-project-match';
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
type GhostPreviewItem = TrackDropGhostPreview;

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

interface ExternalPreviewEntry {
  label: string;
  mediaType: DroppableMediaType;
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
  const [isExternalDragOver, setIsExternalDragOver] = useState(false);
  const [contextMenuFrame, setContextMenuFrame] = useState<number | null>(null);
  const [menuKey, setMenuKey] = useState(0);
  const trackRef = useRef<HTMLDivElement>(null);
  const externalPreviewItemsRef = useRef<ExternalPreviewEntry[] | null>(null);
  const externalPreviewSignatureRef = useRef<string | null>(null);
  const externalPreviewPromiseRef = useRef<Promise<void> | null>(null);
  const externalPreviewTokenRef = useRef(0);
  const lastDragFrameRef = useRef(0);

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

  // Zoom utilities for position calculation
  const { pixelsToFrame, frameToPixels } = useTimelineZoomContext();
  const ghostPreviews = useMemo(
    () => allGhostPreviews.filter((ghost) => ghost.targetTrackId === track.id),
    [allGhostPreviews, track.id]
  );
  const ghostHighlightClasses = useMemo(
    () => getGhostHighlightClasses(ghostPreviews),
    [ghostPreviews]
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
    return pixelsToFrame(offsetX);
  }, [pixelsToFrame]);

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
      frameToPixels,
    });
  }, [fps, frameToPixels, track.id]);

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
      left: frameToPixels(finalPosition),
      width: frameToPixels(placeholderDuration),
      label: itemCount > 1 ? `${itemCount} files` : 'Drop media',
      type: 'external-file',
      targetTrackId: track.id,
    }];
  }, [fps, frameToPixels, track.id]);

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
      left: frameToPixels(finalPosition),
      width: frameToPixels(durationInFrames),
      label: template.label,
      type: template.itemType,
      targetTrackId: targetTrack.id,
    }];
  }, [fps, frameToPixels, track.id]);

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
        setTrackGhostPreviews(buildGhostPreviewsForEntries(previewEntries, lastDragFrameRef.current));
      }
    })().catch((error) => {
      if (token === externalPreviewTokenRef.current) {
        externalPreviewPromiseRef.current = null;
        logger.warn('Failed to build external drag preview:', error);
      }
    });

    externalPreviewPromiseRef.current = previewPromise;
  }, [buildGhostPreviewsForEntries, clearExternalPreviewSession, setTrackGhostPreviews]);

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
          frameToPixels,
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
          {isDragOver && !isDropDisabled && !isExternalDragOver && ghostPreviews.length === 0 && (
            <div className="absolute inset-0 pointer-events-none z-10 rounded border border-dashed border-primary/50 bg-primary/10" />
          )}

          {!isDropDisabled && ghostPreviews.length > 0 && (
            <div className={`absolute inset-0 pointer-events-none z-10 rounded border border-dashed ${ghostHighlightClasses}`} />
          )}

          {/* Ghost preview clips during drag */}
          {!isDropDisabled && ghostPreviews.map((ghost, index) => (
            <div
              key={index}
              className={`absolute inset-y-0 rounded border-2 border-dashed pointer-events-none z-20 flex items-center px-2 ${
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
