/**
 * Recorded Clip Actions - Import AI-recorded video blobs to media library and timeline.
 */

import type { InsertRecordedClipParams } from '../../types';
import { useItemsStore } from '../items-store';
import { useTimelineSettingsStore } from '../timeline-settings-store';
import { useProjectStore } from '@/features/timeline/deps/projects';
import { mediaLibraryService } from '@/features/timeline/deps/media-library-service';
import { useMediaLibraryStore } from '@/features/timeline/deps/media-library-store';
import { resolveMediaUrl } from '@/features/timeline/deps/media-library-resolver';
import { findNearestAvailableSpace } from '../../utils/collision-utils';
import { buildTimelineBaseItem, buildTypedTimelineItem } from '../../utils/build-timeline-item-from-media';
import { logger } from './shared';
import { addItem } from './item-actions';

/**
 * Insert a recorded Live AI clip (blob) onto the timeline.
 * 1. Imports the blob into the media library via OPFS
 * 2. Resolves blob URL and thumbnail
 * 3. Creates a video timeline item at the given position
 */
export async function insertRecordedClip(params: InsertRecordedClipParams): Promise<void> {
  const { blob, durationMs, linkedTimelineStart, projectId } = params;

  try {
    const file = new File([blob], `ai-recording-${Date.now()}.webm`, { type: blob.type || 'video/webm' });
    const media = await mediaLibraryService.importMediaWithFile(file, projectId);

    // Refresh the media library store so the clip shows in the sidebar
    await useMediaLibraryStore.getState().loadMediaItems();

    // Resolve blob URL for playback
    const blobUrl = await resolveMediaUrl(media.id);
    if (!blobUrl || blobUrl === '') {
      logger.error('Failed to resolve blob URL for recorded clip', { mediaId: media.id });
      return;
    }

    // Resolve thumbnail
    let thumbnailUrl: string | null = null;
    if (media.thumbnailId) {
      try {
        thumbnailUrl = await mediaLibraryService.getThumbnailBlobUrl(media.id);
      } catch {
        // Thumbnail is optional
      }
    }

    // Get timeline settings
    const tracks = useItemsStore.getState().tracks;
    const items = useItemsStore.getState().items;
    const fps = useTimelineSettingsStore.getState().fps;
    const project = useProjectStore.getState().currentProject;
    const canvasWidth = project?.metadata.width ?? 1920;
    const canvasHeight = project?.metadata.height ?? 1080;

    // Find a droppable track (prefer first non-group, visible, unlocked track)
    const droppableTrack = tracks.find((t) => !t.isGroup && t.visible && !t.locked);
    if (!droppableTrack) {
      logger.warn('No droppable track available for recorded clip');
      return;
    }

    // Calculate duration in frames
    const durationInFrames = Math.max(1, Math.round((durationMs / 1000) * fps));

    // Find collision-free position
    const proposedPosition = Math.max(0, linkedTimelineStart);
    const trackItems = items.filter((i) => i.trackId === droppableTrack.id);
    const finalPosition = findNearestAvailableSpace(
      proposedPosition,
      durationInFrames,
      droppableTrack.id,
      trackItems,
    );

    if (finalPosition === null) {
      logger.warn('No available space on track for recorded clip');
      return;
    }

    // Build timeline item
    const baseItem = buildTimelineBaseItem({
      media,
      mediaId: media.id,
      label: file.name,
      trackId: droppableTrack.id,
      from: finalPosition,
      durationInFrames,
      timelineFps: fps,
    });

    const timelineItem = buildTypedTimelineItem({
      baseItem,
      mediaType: 'video',
      blobUrl,
      thumbnailUrl,
      media,
      canvasWidth,
      canvasHeight,
    });

    if (!timelineItem) {
      logger.error('Failed to build timeline item for recorded clip');
      return;
    }

    addItem(timelineItem);
    logger.info('Inserted recorded AI clip onto timeline', {
      mediaId: media.id,
      trackId: droppableTrack.id,
      from: finalPosition,
      durationInFrames,
    });
  } catch (error) {
    logger.error('Failed to insert recorded clip', error);
  }
}

/**
 * Add existing media to the timeline at the playhead position.
 * Mobile-friendly alternative to drag-drop.
 */
export async function addMediaToTimeline(mediaId: string): Promise<void> {
  const media = useMediaLibraryStore.getState().mediaItems.find((m) => m.id === mediaId);
  if (!media) {
    logger.error('Media not found for addMediaToTimeline', { mediaId });
    return;
  }

  const fps = useTimelineSettingsStore.getState().fps;
  const project = useProjectStore.getState().currentProject;
  const canvasWidth = project?.metadata.width ?? 1920;
  const canvasHeight = project?.metadata.height ?? 1080;

  const blobUrl = await resolveMediaUrl(mediaId);
  if (!blobUrl || blobUrl === '') {
    logger.error('Failed to resolve blob URL', { mediaId });
    return;
  }

  let thumbnailUrl: string | null = null;
  if (media.thumbnailId) {
    try {
      thumbnailUrl = await mediaLibraryService.getThumbnailBlobUrl(mediaId);
    } catch {
      // Optional
    }
  }

  const tracks = useItemsStore.getState().tracks;
  const items = useItemsStore.getState().items;
  const droppableTrack = tracks.find((t) => !t.isGroup && t.visible && !t.locked);
  if (!droppableTrack) return;

  // Calculate duration: use media duration or default 5s for images
  const mediaDurationSec = media.duration > 0 ? media.duration : 5;
  const durationInFrames = Math.max(1, Math.round(mediaDurationSec * fps));

  // Place at frame 0 (playhead would be better but keeping it simple)
  const trackItems = items.filter((i) => i.trackId === droppableTrack.id);
  const finalPosition = findNearestAvailableSpace(0, durationInFrames, droppableTrack.id, trackItems);
  if (finalPosition === null) return;

  const mimeType = media.mimeType || '';
  const mediaType = mimeType.startsWith('video/')
    ? 'video'
    : mimeType.startsWith('audio/')
      ? 'audio'
      : 'image';

  const baseItem = buildTimelineBaseItem({
    media,
    mediaId,
    label: media.fileName,
    trackId: droppableTrack.id,
    from: finalPosition,
    durationInFrames,
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

  if (timelineItem) {
    addItem(timelineItem);
  }
}
