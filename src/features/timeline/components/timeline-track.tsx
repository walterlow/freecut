import { useState, useRef, memo, useCallback, useEffect, useLayoutEffect } from 'react';
import { createLogger } from '@/shared/logging/logger';

const logger = createLogger('TimelineTrack');
import type { TimelineTrack as TimelineTrackType, TimelineItem as TimelineItemType } from '@/types/timeline';
import type { MediaMetadata } from '@/types/storage';
import { TimelineItem } from './timeline-item';
import { TransitionItem } from './transition-item';
import { useTimelineStore } from '../stores/timeline-store';
import {
  registerTrackDropGhostOverlay,
  useTrackDropPreviewStore,
  type TrackDropGhostPreview,
} from '../stores/track-drop-preview-store';
import { useNewTrackZonePreviewStore } from '../stores/new-track-zone-preview-store';
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
import {
  buildCollisionTrackItemsMap,
  findNearestAvailableSpaceInTrackItems,
  type CollisionRect,
} from '../utils/collision-utils';
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
import { prewarmDroppedTimelineAudio } from '../utils/drop-audio-prewarm';
import { toast } from 'sonner';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
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
import { frameToPixelsNow, pixelsToFrameNow } from '@/features/timeline/utils/zoom-conversions';
import type { LazyContextMenuEventInit } from '../utils/lazy-context-menu';
import {
  captureContextMenuEventInit,
  replayContextMenuEvent,
} from '../utils/lazy-context-menu';
import { getTrackKind, isTrackDisabled as getIsTrackDisabled } from '@/features/timeline/utils/classic-tracks';

/**
 * Lightweight on-demand context menu for track gaps.
 * Only mounts the Radix ContextMenu tree when the user actually right-clicks a gap,
 * avoiding the per-frame Popper/Menu provider cascade during drag operations.
 */
interface TrackGapContextMenuRequest {
  frame: number;
  pointer: LazyContextMenuEventInit;
  token: number;
}

function TrackGapContextMenu({
  request,
  onCloseGap,
  onDismiss,
}: {
  request: TrackGapContextMenuRequest;
  onCloseGap: () => void;
  onDismiss: () => void;
}) {
  const triggerRef = useRef<HTMLSpanElement | null>(null);

  useLayoutEffect(() => {
    if (!triggerRef.current) {
      return;
    }

    replayContextMenuEvent(triggerRef.current, request.pointer);
  }, [request]);

  return (
    <ContextMenu modal={false} onOpenChange={(open) => { if (!open) onDismiss(); }}>
      <ContextMenuTrigger asChild>
        <span
          ref={triggerRef}
          aria-hidden="true"
          style={{
            position: 'fixed',
            left: request.pointer.clientX,
            top: request.pointer.clientY,
            width: 0,
            height: 0,
            pointerEvents: 'none',
          }}
        />
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={onCloseGap}>
          Ripple Delete
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

const TrackDropGhostOverlay = memo(function TrackDropGhostOverlay({
  trackId,
  showEmptyOverlay,
}: {
  trackId: string;
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

  const syncGhostPreviews = useCallback((ghostPreviews: TrackDropGhostPreview[]) => {
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
        root.className = 'absolute rounded border-2 border-dashed pointer-events-none z-20 flex items-center px-2 inset-y-0';
        const label = document.createElement('span');
        label.className = 'text-xs text-foreground/70 truncate';
        root.appendChild(label);
        previewLayer.appendChild(root);
        previewNode = { root, label };
        previewNodes[index] = previewNode;
      }

      previewNode.root.className = `absolute rounded border-2 border-dashed pointer-events-none z-20 flex items-center px-2 inset-y-0 ${getGhostPreviewItemClasses(ghostPreview.type)}`;
      previewNode.root.style.left = `${ghostPreview.left}px`;
      previewNode.root.style.width = `${ghostPreview.width}px`;
      previewNode.label.textContent = ghostPreview.label;
    }

    syncEmptyOverlayVisibility();
  }, [syncEmptyOverlayVisibility]);

  useLayoutEffect(() => {
    showEmptyOverlayRef.current = showEmptyOverlay;
    syncEmptyOverlayVisibility();
  }, [showEmptyOverlay, syncEmptyOverlayVisibility]);

  useEffect(() => {
    const unregister = registerTrackDropGhostOverlay(trackId, {
      sync: syncGhostPreviews,
      clear: clearGhostPreviews,
    });

    return () => {
      unregister();
      clearGhostPreviews();
    };
  }, [clearGhostPreviews, syncGhostPreviews, trackId]);

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

interface TimelineTrackProps {
  track: TimelineTrackType;
}

type GhostPreviewItem = TrackDropGhostPreview;
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

/**
 * Memoized item list — prevents the items `.map()` from running when the parent
 * TimelineTrack re-renders for drag-preview or state changes that don't affect items.
 * Without this, every track re-render recreates JSX for all items, and even though
 * individual TimelineItem components are memo'd, the parent reconciliation cost
 * (prop diffing × items) adds up across frequent drag-over events.
 */
const TimelineTrackItems = memo(function TimelineTrackItems({
  trackItems,
  trackLocked,
  trackHidden,
}: {
  trackItems: ReadonlyArray<TimelineItemType>;
  trackLocked: boolean;
  trackHidden: boolean;
}) {
  return (
    <>
      {trackItems.map((item) => (
        <TimelineItem key={item.id} item={item} timelineDuration={30} trackLocked={trackLocked} trackHidden={trackHidden} />
      ))}
    </>
  );
});

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
  const previewOwnerId = `track:${track.id}`;
  const [isDragOver, setIsDragOver] = useState(false);
  const [isExternalDragOver, setIsExternalDragOver] = useState(false);
  const [gapContextMenuRequest, setGapContextMenuRequest] = useState<TrackGapContextMenuRequest | null>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const gapContextMenuTokenRef = useRef(0);
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

  // Resolve whether this track is effectively disabled for rendering or drops.
  // Uses the shared resolveEffectiveTrackStates helper so group-inherited
  // locked/visible/muted flags stay consistent with the rest of the timeline.
  const trackInteractionState = useTimelineStore((s) => {
    const effective = resolveEffectiveTrackStates(s.tracks).find((t) => t.id === track.id) ?? track;
    return (effective.locked ? 1 : 0) | (getIsTrackDisabled(effective) ? 2 : 0);
  });
  const isTrackLocked = (trackInteractionState & 1) !== 0;
  const isTrackDisabled = (trackInteractionState & 2) !== 0;
  const isDropDisabled = isTrackLocked;
  const trackKind = getTrackKind(track);

  // Virtualized items/transitions â€” only those overlapping the visible viewport + buffer
  const { visibleItems: trackItems, visibleTransitions: trackTransitions } = useVisibleItems(track.id);
  // Full item count â€” used for context menu guard (must not depend on virtualized subset)
  const hasAnyItems = useItemsStore((s) => (s.itemsByTrackId[track.id]?.length ?? 0) > 0);
  const addItem = useTimelineStore((s) => s.addItem);
  const addItems = useTimelineStore((s) => s.addItems);
  const fps = useTimelineStore((s) => s.fps);
  const closeGapAtPosition = useTimelineStore((s) => s.closeGapAtPosition);
  const setTrackGhostPreviews = useTrackDropPreviewStore((s) => s.setGhostPreviews);
  const clearTrackGhostPreviews = useTrackDropPreviewStore((s) => s.clearGhostPreviews);
  const getMedia = useMediaLibraryStore((s) => s.mediaItems);
  const importHandlesForPlacement = useMediaLibraryStore((s) => s.importHandlesForPlacement);

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
      existingTrackItemsById: getCollisionTrackItemsMap(),
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
  }, [fps, getCollisionTrackItemsMap, getCurrentCanvasSize, track.id]);

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
      existingTrackItemsById: getCollisionTrackItemsMap(),
      dropTargetTrackId: track.id,
    });

    return buildGhostPreviewsFromTrackMediaDropPlan({
      plannedItems,
      frameToPixels: frameToPixelsNow,
    });
  }, [fps, getCollisionTrackItemsMap, track.id]);

  const buildGenericExternalGhostPreviews = useCallback((
    dropFrame: number,
    itemCount: number
  ): GhostPreviewItem[] => {
    const placeholderDuration = fps * 3;
    const finalPosition = findNearestAvailablePreviewSpace(dropFrame, placeholderDuration, track.id);

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
  }, [findNearestAvailablePreviewSpace, fps, track.id]);

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

    const finalPosition = findNearestAvailablePreviewSpace(dropFrame, durationInFrames, targetTrack.id);
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
  }, [findNearestAvailablePreviewSpace, fps, track.id]);

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

    const finalPosition = findNearestAvailablePreviewSpace(dropFrame, durationInFrames, targetTrack.id);
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
  }, [findNearestAvailablePreviewSpace, fps, getCurrentCanvasSize, track.id]);

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
        setTrackGhostPreviews(previews);
      } else {
        setTrackGhostPreviews(buildGenericExternalGhostPreviews(pending.dropFrame, Math.max(1, pending.fileItemCount)));
        if (pending.dataTransfer) {
          primeExternalPreviewEntries(pending.dataTransfer);
        }
      }
      return;
    }

    const data = pending.dragData;
    if (!data) {
      clearTrackGhostPreviews();
      resetDragPreviewCache();
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
        setDropEffectNone();
        clearTrackGhostPreviews();
        resetDragPreviewCache();
        return;
      }

      const store = useTimelineStore.getState();
      const compositionById = useCompositionsStore.getState().compositionById;
      const composition = compositionById[data.compositionId];
      if (!composition) {
        setDropEffectNone();
        clearTrackGhostPreviews();
        resetDragPreviewCache();
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
        dropFrame: pending.dropFrame,
        tracks: store.tracks,
        existingItems: store.items,
        existingTrackItemsById: getCollisionTrackItemsMap(),
        dropTargetTrackId: track.id,
      });
      const plannedItem = plannedItems[0];
      if (!plannedItem) {
        setDropEffectNone();
        updateDragOverFlags(false, false);
        clearTrackGhostPreviews();
        resetDragPreviewCache();
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
      const templatePreviews = buildGhostPreviewForTemplate(data, pending.dropFrame);
      if (templatePreviews.length === 0) {
        setDropEffectNone();
        updateDragOverFlags(false, false);
        resetDragPreviewCache();
      }
      setTrackGhostPreviews(templatePreviews);
      return;
    }

    const previewEntries = getPreviewEntriesForDragData(data);
    if (!previewEntries || previewEntries.length === 0) {
      clearTrackGhostPreviews();
      resetDragPreviewCache();
      return;
    }

    const nextPreviews = buildGhostPreviewsForEntries(previewEntries, pending.dropFrame);
    if (nextPreviews.length === 0) {
      setDropEffectNone();
      updateDragOverFlags(false, false);
      resetDragPreviewCache();
    }
    previews.push(...nextPreviews);
    setTrackGhostPreviews(previews);
  }, [
    buildGenericExternalGhostPreviews,
    buildGhostPreviewForTemplate,
    buildGhostPreviewsForEntries,
    clearTrackGhostPreviews,
    getCollisionTrackItemsMap,
    getPreviewEntriesForDragData,
    previewOwnerId,
    primeExternalPreviewEntries,
    resetDragPreviewCache,
    setTrackGhostPreviews,
    shouldSkipDragPreviewUpdate,
    track.id,
    updateDragOverFlags,
  ]);

  // Check if any item on this track is being dragged.
  // Reads items from getState() inside the selector to avoid a separate useItemsStore
  // subscription that would cause ALL tracks to re-render on every items-store change.
  const hasItemBeingDragged = useSelectionStore(
    useCallback(
      (s) => {
        if (!s.dragState?.isDragging) return false;
        const trackItems = useItemsStore.getState().itemsByTrackId[track.id];
        if (!trackItems) return false;
        const draggedItemIdSet = s.dragState.draggedItemIdSet ?? new Set(s.dragState.draggedItemIds);
        return trackItems.some((item) => draggedItemIdSet.has(item.id));
      },
      [track.id]
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
    if (target.closest('[data-item-id], [data-item-context-anchor]')) {
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
      e.preventDefault();
      gapContextMenuTokenRef.current += 1;
      setGapContextMenuRequest({
        frame: clickedFrame,
        pointer: captureContextMenuEventInit(e.nativeEvent),
        token: gapContextMenuTokenRef.current,
      });
    } else {
      // Clicked on a clip area, prevent track menu so clip menu can show
      e.preventDefault();
      setGapContextMenuRequest(null);
    }
  }, [isFrameInGap]);

  // Handle closing the gap
  const handleCloseGap = useCallback(() => {
    if (gapContextMenuRequest) {
      closeGapAtPosition(track.id, gapContextMenuRequest.frame);
      setGapContextMenuRequest(null);
    }
  }, [closeGapAtPosition, gapContextMenuRequest, track.id]);

  const claimPreviewOwnership = useCallback((dataTransfer: DataTransfer | null) => {
    const data = getMediaDragData();
    const hasExternalFiles = !!dataTransfer && !data && dataTransfer.types.includes('Files');
    if (!data && !hasExternalFiles) {
      return;
    }

    if (claimTimelineDropPreviewOwner(previewOwnerId)) {
      clearTrackGhostPreviews();
      useNewTrackZonePreviewStore.getState().clearGhostPreviews();
    }
    updateDragOverFlags(true, hasExternalFiles);
  }, [clearTrackGhostPreviews, previewOwnerId, updateDragOverFlags]);

  const clearOwnedPreview = useCallback(() => {
    clearPendingDragPreview();
    updateDragOverFlags(false, false);
    clearTrackGhostPreviews();
    resetDragPreviewCache();
  }, [clearPendingDragPreview, clearTrackGhostPreviews, resetDragPreviewCache, updateDragOverFlags]);

  const handleDragEnterCapture = useCallback((e: React.DragEvent) => {
    claimPreviewOwnership(e.dataTransfer);
  }, [claimPreviewOwnership]);

  useEffect(() => {
    return registerTimelineDropPreviewOwner(previewOwnerId, clearOwnedPreview);
  }, [clearOwnedPreview, previewOwnerId]);

  const handleDragOver = (e: React.DragEvent) => {
    if (isDropDisabled) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'none';
      clearPendingDragPreview();
      resetDragPreviewCache();
      return;
    }

    const data = getMediaDragData();
    const hasExternalFiles = !data && e.dataTransfer.types.includes('Files');
    if (!data && !hasExternalFiles) {
      clearPendingDragPreview();
      updateDragOverFlags(false, false);
      clearTrackGhostPreviews();
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
      clearTrackGhostPreviews();
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
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    if (isDragPointInsideElement(e, e.currentTarget)) {
      return;
    }
    releaseTimelineDropPreviewOwner(previewOwnerId);
    clearPendingDragPreview();
    updateDragOverFlags(false, false);
    clearTrackGhostPreviews();
    resetDragPreviewCache();
    clearExternalPreviewSession();
  };

  useEffect(() => () => {
    releaseTimelineDropPreviewOwner(previewOwnerId);
    clearPendingDragPreview();
  }, [clearPendingDragPreview, previewOwnerId]);

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    releaseTimelineDropPreviewOwner(previewOwnerId);
    clearPendingDragPreview();
    updateDragOverFlags(false, false);
    clearTrackGhostPreviews();
    resetDragPreviewCache();
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
  };

  return (
    <>
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
        onDragEnterCapture={handleDragEnterCapture}
        onDragOver={handleDragOver}
        onDragLeaveCapture={handleDragLeave}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onContextMenu={handleContextMenu}
      >
        {!isDropDisabled && (
          <TrackDropGhostOverlay
            trackId={track.id}
            showEmptyOverlay={isDragOver && !isExternalDragOver}
          />
        )}

        {/* Render all items for this track - dimmed when the track is disabled */}
        <TimelineTrackItems trackItems={trackItems} trackLocked={isTrackLocked} trackHidden={isTrackDisabled} />

        {/* Render transitions for this track */}
        {trackKind !== 'audio' && trackTransitions.map((transition) => (
          <TransitionItem key={transition.id} transition={transition} trackHidden={isTrackDisabled} />
        ))}

        {/* Locked track overlay indicator */}
        {isTrackLocked && (
          <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
            <div className="text-xs text-muted-foreground/50 font-mono">LOCKED</div>
          </div>
        )}
      </div>
      {/* Lazy ContextMenu: only mount Radix tree when the menu is triggered on a gap */}
      {hasAnyItems && gapContextMenuRequest !== null && (
        <TrackGapContextMenu
          key={gapContextMenuRequest.token}
          request={gapContextMenuRequest}
          onCloseGap={handleCloseGap}
          onDismiss={() => setGapContextMenuRequest(null)}
        />
      )}
    </>
  );
}, areTrackPropsEqual);
