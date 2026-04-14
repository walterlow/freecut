import { createLogger } from '@/shared/logging/logger';
import type { TimelineItem as TimelineItemType, VideoItem, AudioItem, ImageItem } from '@/types/timeline';
import type { MediaMetadata } from '@/types/storage';
import { computeInitialTransform } from './transform-init';

const logger = createLogger('build-timeline-item-from-media');

export interface TimelineBaseItem {
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

export function buildTimelineBaseItem(params: {
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

export function buildTypedTimelineItem(params: {
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
