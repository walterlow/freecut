import { useCallback, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useSelectionStore } from '@/shared/state/selection';
import { usePlaybackStore } from '@/shared/state/playback';
import { useTimelineStore } from '@/features/preview/deps/timeline-store';
import {
  buildDroppedMediaTimelineItem,
  findBestCanvasDropPlacement,
  getDroppedMediaDurationInFrames,
  type DroppableMediaType,
} from '@/features/preview/deps/timeline-utils';
import {
  extractValidMediaFileEntriesFromDataTransfer,
  getMediaDragData,
  getMediaType,
  mediaLibraryService,
  resolveMediaUrl,
  useMediaLibraryStore,
} from '@/features/preview/deps/media-library';
import { screenToCanvas } from '../utils/coordinate-transform';
import type { CoordinateParams } from '../types/gizmo';
import type { TimelineItem } from '@/types/timeline';
import type { MediaMetadata } from '@/types/storage';

type DropSource = 'library' | 'external-file';

interface CanvasDropState {
  allowed: boolean;
  source: DropSource;
  title: string;
  description: string;
}

interface UseCanvasMediaDropParams {
  coordParams: CoordinateParams | null;
  projectSize: { width: number; height: number };
}

interface PlaceMediaOnCanvasParams {
  media: MediaMetadata;
  mediaType: DroppableMediaType;
  label: string;
  clientX: number;
  clientY: number;
}

function isVisualMediaType(value: unknown): value is Extract<DroppableMediaType, 'video' | 'image'> {
  return value === 'video' || value === 'image';
}

function clampDropPosition(
  item: TimelineItem,
  canvasPoint: { x: number; y: number },
  projectSize: { width: number; height: number }
): TimelineItem {
  if (!item.transform) {
    return item;
  }

  const width = item.transform.width ?? projectSize.width;
  const height = item.transform.height ?? projectSize.height;
  const halfWidth = width / 2;
  const halfHeight = height / 2;
  const minX = halfWidth;
  const maxX = Math.max(halfWidth, projectSize.width - halfWidth);
  const minY = halfHeight;
  const maxY = Math.max(halfHeight, projectSize.height - halfHeight);

  const centerX = minX > maxX
    ? projectSize.width / 2
    : Math.min(maxX, Math.max(minX, canvasPoint.x));
  const centerY = minY > maxY
    ? projectSize.height / 2
    : Math.min(maxY, Math.max(minY, canvasPoint.y));

  return {
    ...item,
    transform: {
      ...item.transform,
      x: centerX - projectSize.width / 2,
      y: centerY - projectSize.height / 2,
    },
  };
}

function evaluateCanvasDrop(dataTransfer: DataTransfer): CanvasDropState | null {
  const dragData = getMediaDragData();
  if (dragData) {
    if (dragData.type === 'composition') {
      return {
        allowed: false,
        source: 'library',
        title: 'Drop On Timeline',
        description: 'Compositions still place best on the timeline.',
      };
    }

    if (dragData.type === 'media-items') {
      const itemCount = Array.isArray(dragData.items) ? dragData.items.length : 0;
      if (itemCount !== 1) {
        return {
          allowed: false,
          source: 'library',
          title: 'Drop One Item',
          description: 'Place one media item at a time on the canvas.',
        };
      }

      const mediaType = dragData.items?.[0]?.mediaType;
      if (!isVisualMediaType(mediaType)) {
        return {
          allowed: false,
          source: 'library',
          title: 'Audio Goes On Timeline',
          description: 'Canvas drop places visual layers only.',
        };
      }
    }

    if (dragData.type === 'media-item' && !isVisualMediaType(dragData.mediaType)) {
      return {
        allowed: false,
        source: 'library',
        title: 'Audio Goes On Timeline',
        description: 'Canvas drop places visual layers only.',
      };
    }

    return {
      allowed: true,
      source: 'library',
      title: 'Drop To Place',
      description: 'Add this media at the playhead and drop position.',
    };
  }

  if (!dataTransfer.types.includes('Files')) {
    return null;
  }

  const itemCount = dataTransfer.items.length;
  if (itemCount !== 1) {
    return {
      allowed: false,
      source: 'external-file',
      title: 'Drop One File',
      description: 'Canvas drop imports one visual file at a time.',
    };
  }

  return {
    allowed: true,
    source: 'external-file',
    title: 'Import And Place',
    description: 'Import this file and place it on the canvas.',
  };
}

export function useCanvasMediaDrop({
  coordParams,
  projectSize,
}: UseCanvasMediaDropParams) {
  const dragDepthRef = useRef(0);
  const [dropState, setDropState] = useState<CanvasDropState | null>(null);

  const clearDropState = useCallback(() => {
    dragDepthRef.current = 0;
    setDropState(null);
  }, []);

  const placeMediaOnCanvas = useCallback(async ({
    media,
    mediaType,
    label,
    clientX,
    clientY,
  }: PlaceMediaOnCanvasParams) => {
    if (!coordParams || !isVisualMediaType(mediaType)) {
      return;
    }

    const timelineState = useTimelineStore.getState();
    const playbackState = usePlaybackStore.getState();
    const selectionState = useSelectionStore.getState();
    const durationInFrames = getDroppedMediaDurationInFrames(media, mediaType, timelineState.fps);
    const placement = findBestCanvasDropPlacement({
      tracks: timelineState.tracks,
      items: timelineState.items,
      activeTrackId: selectionState.activeTrackId,
      proposedFrame: playbackState.currentFrame,
      durationInFrames,
    });

    if (!placement) {
      toast.warning('No unlocked visible track is available for this drop.');
      return;
    }

    const blobUrl = await resolveMediaUrl(media.id);
    if (!blobUrl) {
      toast.error('Unable to load dropped media.');
      return;
    }

    const thumbnailUrl = await mediaLibraryService.getThumbnailBlobUrl(media.id);
    const baseItem = buildDroppedMediaTimelineItem({
      media,
      mediaId: media.id,
      mediaType,
      label,
      timelineFps: timelineState.fps,
      blobUrl,
      thumbnailUrl,
      canvasWidth: projectSize.width,
      canvasHeight: projectSize.height,
      placement: {
        trackId: placement.trackId,
        from: placement.from,
        durationInFrames,
      },
    });

    const canvasPoint = screenToCanvas(clientX, clientY, coordParams);
    const positionedItem = clampDropPosition(baseItem, canvasPoint, projectSize);
    timelineState.addItem(positionedItem);
    selectionState.setActiveTrack(placement.trackId);
    selectionState.selectItems([positionedItem.id]);
  }, [coordParams, projectSize]);

  const handleLibraryDrop = useCallback(async (
    event: React.DragEvent,
    currentDropState: CanvasDropState
  ) => {
    if (!currentDropState.allowed) {
      toast.warning(currentDropState.description);
      return;
    }

    const dragData = getMediaDragData();
    if (!dragData) {
      return;
    }

    let mediaId: string | undefined;
    let mediaType: DroppableMediaType | undefined;
    let label: string | undefined;

    if (dragData.type === 'media-item' && dragData.mediaId && dragData.mediaType && dragData.fileName) {
      if (!isVisualMediaType(dragData.mediaType)) {
        toast.warning('Canvas drop places visual layers only.');
        return;
      }
      mediaId = dragData.mediaId;
      mediaType = dragData.mediaType;
      label = dragData.fileName;
    } else if (dragData.type === 'media-items' && dragData.items?.length === 1) {
      const item = dragData.items[0];
      if (!item || !isVisualMediaType(item.mediaType)) {
        toast.warning('Canvas drop places visual layers only.');
        return;
      }
      mediaId = item.mediaId;
      mediaType = item.mediaType;
      label = item.fileName;
    }

    if (!mediaId || !mediaType || !label) {
      return;
    }

    const media = useMediaLibraryStore.getState().mediaById[mediaId]
      ?? useMediaLibraryStore.getState().mediaItems.find((item) => item.id === mediaId);
    if (!media) {
      toast.error('Dropped media is no longer available.');
      return;
    }

    await placeMediaOnCanvas({
      media,
      mediaType,
      label,
      clientX: event.clientX,
      clientY: event.clientY,
    });
  }, [placeMediaOnCanvas]);

  const handleExternalFileDrop = useCallback(async (
    event: React.DragEvent,
    currentDropState: CanvasDropState
  ) => {
    if (!currentDropState.allowed) {
      toast.warning(currentDropState.description);
      return;
    }

    const { supported, entries, errors } = await extractValidMediaFileEntriesFromDataTransfer(
      event.dataTransfer
    );
    if (!supported) {
      toast.warning('Drag-drop not supported. Please use Google Chrome.');
      return;
    }

    if (errors.length > 0) {
      toast.error(`Some files were rejected: ${errors.join(', ')}`);
    }

    const entry = entries[0];
    if (!entry) {
      return;
    }

    if (!isVisualMediaType(entry.mediaType)) {
      toast.warning('Drop audio on the timeline instead.');
      return;
    }

    const importedMedia = await useMediaLibraryStore
      .getState()
      .importHandlesForPlacement([entry.handle]);
    const imported = importedMedia[0];
    if (!imported) {
      toast.error('Unable to import dropped file.');
      return;
    }

    const importedType = getMediaType(imported.mimeType);
    if (!isVisualMediaType(importedType)) {
      toast.warning('Drop audio on the timeline instead.');
      return;
    }

    await placeMediaOnCanvas({
      media: imported,
      mediaType: importedType,
      label: imported.fileName,
      clientX: event.clientX,
      clientY: event.clientY,
    });
  }, [placeMediaOnCanvas]);

  const handleDragEnter = useCallback((event: React.DragEvent) => {
    const nextDropState = evaluateCanvasDrop(event.dataTransfer);
    if (!nextDropState) {
      return;
    }

    event.preventDefault();
    dragDepthRef.current += 1;
    setDropState(nextDropState);
  }, []);

  const handleDragOver = useCallback((event: React.DragEvent) => {
    const nextDropState = evaluateCanvasDrop(event.dataTransfer);
    if (!nextDropState) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = nextDropState.allowed ? 'copy' : 'none';
    setDropState((prev) => {
      if (
        prev?.allowed === nextDropState.allowed
        && prev?.source === nextDropState.source
        && prev?.title === nextDropState.title
        && prev?.description === nextDropState.description
      ) {
        return prev;
      }
      return nextDropState;
    });
  }, []);

  const handleDragLeave = useCallback((event: React.DragEvent) => {
    if (!dropState) {
      return;
    }

    event.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) {
      setDropState(null);
    }
  }, [dropState]);

  const handleDrop = useCallback(async (event: React.DragEvent) => {
    const currentDropState = evaluateCanvasDrop(event.dataTransfer);
    clearDropState();

    if (!currentDropState) {
      return;
    }

    event.preventDefault();
    if (!coordParams) {
      return;
    }

    if (currentDropState.source === 'library') {
      await handleLibraryDrop(event, currentDropState);
      return;
    }

    await handleExternalFileDrop(event, currentDropState);
  }, [clearDropState, coordParams, handleExternalFileDrop, handleLibraryDrop]);

  return {
    dropState,
    handleDragEnter,
    handleDragLeave,
    handleDragOver,
    handleDrop,
  };
}
