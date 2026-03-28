import type {
  AudioItem,
  ImageItem,
  TimelineItem,
  VideoItem,
} from '@/types/timeline';
import type { MediaMetadata } from '@/types/storage';
import { computeInitialTransform } from './transform-init';

export type DroppableMediaType = 'video' | 'audio' | 'image';

export interface TimelineMediaPlacement {
  trackId: string;
  from: number;
  durationInFrames: number;
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

export function getDroppedMediaDurationInFrames(
  media: Pick<MediaMetadata, 'duration'>,
  mediaType: DroppableMediaType,
  timelineFps: number
): number {
  const durationInFrames = Math.round(media.duration * timelineFps);
  if (durationInFrames > 0) {
    return durationInFrames;
  }

  return mediaType === 'image' ? timelineFps * 3 : timelineFps;
}

function buildTimelineBaseItem(params: {
  media: MediaMetadata;
  mediaId: string;
  label: string;
  timelineFps: number;
  placement: TimelineMediaPlacement;
}): TimelineBaseItem {
  const { media, mediaId, label, timelineFps, placement } = params;
  const sourceFps = media.fps || timelineFps;
  const actualSourceDurationFrames = Math.round(media.duration * sourceFps);
  const sourceFramesForItemDuration = Math.min(
    actualSourceDurationFrames,
    Math.round(placement.durationInFrames * sourceFps / timelineFps)
  );

  return {
    id: crypto.randomUUID(),
    trackId: placement.trackId,
    from: placement.from,
    durationInFrames: placement.durationInFrames,
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

export function buildDroppedMediaTimelineItem(params: {
  media: MediaMetadata;
  mediaId: string;
  mediaType: DroppableMediaType;
  label: string;
  timelineFps: number;
  blobUrl: string;
  thumbnailUrl?: string | null;
  canvasWidth: number;
  canvasHeight: number;
  placement: TimelineMediaPlacement;
}): TimelineItem {
  const {
    media,
    mediaId,
    mediaType,
    label,
    timelineFps,
    blobUrl,
    thumbnailUrl,
    canvasWidth,
    canvasHeight,
    placement,
  } = params;
  const baseItem = buildTimelineBaseItem({
    media,
    mediaId,
    label,
    timelineFps,
    placement,
  });

  if (mediaType === 'audio') {
    return {
      ...baseItem,
      type: 'audio',
      src: blobUrl,
    } as AudioItem;
  }

  const sourceWidth = media.width || canvasWidth;
  const sourceHeight = media.height || canvasHeight;
  const transform = computeInitialTransform(
    sourceWidth,
    sourceHeight,
    canvasWidth,
    canvasHeight
  );

  if (mediaType === 'video') {
    return {
      ...baseItem,
      type: 'video',
      src: blobUrl,
      thumbnailUrl: thumbnailUrl || undefined,
      sourceWidth: media.width || undefined,
      sourceHeight: media.height || undefined,
      transform,
    } as VideoItem;
  }

  return {
    ...baseItem,
    type: 'image',
    src: blobUrl,
    thumbnailUrl: thumbnailUrl || undefined,
    sourceWidth: media.width || undefined,
    sourceHeight: media.height || undefined,
    transform,
  } as ImageItem;
}
