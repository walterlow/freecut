/**
 * Source Edit Actions - Insert and Overwrite editing from the source monitor.
 */

import type { TimelineItem, VideoItem, AudioItem, ImageItem } from '@/types/timeline';
import { useItemsStore } from '../items-store';
import { useTimelineSettingsStore } from '../timeline-settings-store';
import { useSelectionStore } from '@/shared/state/selection';
import { useEditorStore } from '@/shared/state/editor';
import { useSourcePlayerStore } from '@/shared/state/source-player';
import { usePlaybackStore } from '@/shared/state/playback';
import { useMediaLibraryStore } from '@/features/timeline/deps/media-library-store';
import { useProjectStore } from '@/features/timeline/deps/projects';
import { mediaLibraryService } from '@/features/timeline/deps/media-library-service';
import { getMediaType } from '@/features/timeline/deps/media-library-resolver';
import { toast } from 'sonner';
import { computeInitialTransform } from '../../utils/transform-init';
import { execute, applyTransitionRepairs, logger } from './shared';

interface SourceEditContext {
  sourceMediaId: string;
  activeTrackId: string;
  effectiveIn: number;
  effectiveOut: number;
  clipDurationFrames: number;
  insertFrame: number;
  blobUrl: string;
  thumbnailUrl: string | undefined;
  media: { duration: number; fps: number | undefined; width: number | undefined; height: number | undefined; mimeType: string; fileName: string };
  mediaType: 'video' | 'audio' | 'image';
  canvasWidth: number;
  canvasHeight: number;
  projectFps: number;
}

async function resolveSourceEditContext(): Promise<SourceEditContext | null> {
  const sourceMediaId = useEditorStore.getState().sourcePreviewMediaId;
  if (!sourceMediaId) {
    toast.warning('Open a source in the source monitor first');
    return null;
  }

  const { inPoint, outPoint } = useSourcePlayerStore.getState();
  const { activeTrackId } = useSelectionStore.getState();
  if (!activeTrackId) {
    toast.warning('Select a target track in the timeline first');
    return null;
  }

  const tracks = useItemsStore.getState().tracks;
  const track = tracks.find((t) => t.id === activeTrackId);
  if (!track) {
    logger.warn('Source edit: Active track not found');
    return null;
  }
  if (track.locked) {
    toast.warning('Target track is locked');
    return null;
  }

  const mediaItems = useMediaLibraryStore.getState().mediaItems;
  const media = mediaItems.find((m) => m.id === sourceMediaId);
  if (!media) {
    logger.warn('Source edit: Source media not found');
    return null;
  }

  const mediaType = getMediaType(media.mimeType);
  if (mediaType === 'unknown') {
    logger.warn('Source edit: Unknown media type');
    return null;
  }

  const sourceFps = media.fps || 30;
  const projectFps = useTimelineSettingsStore.getState().fps;
  const sourceDurationFrames = mediaType === 'image'
    ? projectFps * 3
    : Math.max(1, Math.round(media.duration * sourceFps));

  const effectiveIn = inPoint ?? 0;
  const effectiveOut = outPoint ?? sourceDurationFrames;

  // Convert source frames to project frames
  const sourceRangeFrames = effectiveOut - effectiveIn;
  const clipDurationFrames = sourceFps === projectFps
    ? sourceRangeFrames
    : Math.max(1, Math.round(sourceRangeFrames * projectFps / sourceFps));

  const insertFrame = usePlaybackStore.getState().currentFrame;

  const currentProject = useProjectStore.getState().currentProject;
  const canvasWidth = currentProject?.metadata.width ?? 1920;
  const canvasHeight = currentProject?.metadata.height ?? 1080;

  // Resolve blob URLs before execute (async not allowed inside execute)
  const blobUrl = await mediaLibraryService.getMediaBlobUrl(sourceMediaId);
  if (!blobUrl) {
    toast.error('Failed to load source media');
    return null;
  }
  const thumbnailUrl = (await mediaLibraryService.getThumbnailBlobUrl(sourceMediaId)) || undefined;

  return {
    sourceMediaId,
    activeTrackId,
    effectiveIn,
    effectiveOut,
    clipDurationFrames,
    insertFrame,
    blobUrl,
    thumbnailUrl,
    media: {
      duration: media.duration,
      fps: media.fps,
      width: media.width,
      height: media.height,
      mimeType: media.mimeType,
      fileName: media.fileName,
    },
    mediaType,
    canvasWidth,
    canvasHeight,
    projectFps,
  };
}

function createTimelineItem(ctx: SourceEditContext): TimelineItem {
  const sourceFps = ctx.media.fps || 30;
  const actualSourceDurationFrames = ctx.mediaType === 'image'
    ? ctx.projectFps * 3
    : Math.round(ctx.media.duration * sourceFps);

  const baseItem = {
    id: crypto.randomUUID(),
    trackId: ctx.activeTrackId,
    from: ctx.insertFrame,
    durationInFrames: ctx.clipDurationFrames,
    label: ctx.media.fileName,
    mediaId: ctx.sourceMediaId,
    originId: crypto.randomUUID(),
    sourceStart: ctx.effectiveIn,
    sourceEnd: ctx.effectiveOut,
    sourceDuration: actualSourceDurationFrames,
    sourceFps,
    trimStart: 0,
    trimEnd: 0,
  };

  if (ctx.mediaType === 'video') {
    const sourceW = ctx.media.width || ctx.canvasWidth;
    const sourceH = ctx.media.height || ctx.canvasHeight;
    return {
      ...baseItem,
      type: 'video',
      src: ctx.blobUrl,
      thumbnailUrl: ctx.thumbnailUrl,
      sourceWidth: ctx.media.width || undefined,
      sourceHeight: ctx.media.height || undefined,
      transform: computeInitialTransform(sourceW, sourceH, ctx.canvasWidth, ctx.canvasHeight),
    } as VideoItem;
  } else if (ctx.mediaType === 'audio') {
    return {
      ...baseItem,
      type: 'audio',
      src: ctx.blobUrl,
    } as AudioItem;
  } else {
    const sourceW = ctx.media.width || ctx.canvasWidth;
    const sourceH = ctx.media.height || ctx.canvasHeight;
    return {
      ...baseItem,
      type: 'image',
      src: ctx.blobUrl,
      thumbnailUrl: ctx.thumbnailUrl,
      sourceWidth: ctx.media.width || undefined,
      sourceHeight: ctx.media.height || undefined,
      transform: computeInitialTransform(sourceW, sourceH, ctx.canvasWidth, ctx.canvasHeight),
    } as ImageItem;
  }
}

export async function performInsertEdit(): Promise<void> {
  const ctx = await resolveSourceEditContext();
  if (!ctx) return;

  const { insertFrame, clipDurationFrames, activeTrackId } = ctx;

  execute('INSERT_EDIT', () => {
    const store = useItemsStore.getState();

    // Find item straddling the insert frame and split it
    const straddleItem = store.items.find(
      (item) =>
        item.trackId === activeTrackId &&
        item.from < insertFrame &&
        item.from + item.durationInFrames > insertFrame
    );
    let splitIds: string[] = [];
    if (straddleItem) {
      const splitResult = store._splitItem(straddleItem.id, insertFrame);
      if (splitResult) {
        splitIds = [splitResult.leftItem.id, splitResult.rightItem.id];
      }
    }

    // Re-read items after potential split; shift items at or after insertFrame forward
    const itemsToShift = useItemsStore.getState().items.filter(
      (item) => item.trackId === activeTrackId && item.from >= insertFrame
    );
    for (const item of itemsToShift) {
      store._moveItem(item.id, item.from + clipDurationFrames);
    }

    // Create and add the new clip
    const newItem = createTimelineItem(ctx);
    store._addItem(newItem);

    // Repair transitions on affected items
    const affectedIds = [newItem.id, ...itemsToShift.map((i) => i.id), ...splitIds];
    applyTransitionRepairs(affectedIds);

    useTimelineSettingsStore.getState().markDirty();
  }, { trackId: activeTrackId, insertFrame, clipDurationFrames });

  // Advance playhead to end of inserted clip
  usePlaybackStore.getState().setCurrentFrame(insertFrame + clipDurationFrames);
  toast.success('Insert edit applied');
}

export async function performOverwriteEdit(): Promise<void> {
  const ctx = await resolveSourceEditContext();
  if (!ctx) return;

  const { insertFrame, clipDurationFrames, activeTrackId } = ctx;
  const overwriteStart = insertFrame;
  const overwriteEnd = insertFrame + clipDurationFrames;

  execute('OVERWRITE_EDIT', () => {
    const store = useItemsStore.getState();
    const affectedIds: string[] = [];

    // Find items on active track overlapping the overwrite region
    const overlapping = store.items.filter(
      (item) =>
        item.trackId === activeTrackId &&
        item.from < overwriteEnd &&
        item.from + item.durationInFrames > overwriteStart
    );

    for (const item of overlapping) {
      const itemEnd = item.from + item.durationInFrames;
      const startsBeforeRegion = item.from < overwriteStart;
      const endsAfterRegion = itemEnd > overwriteEnd;

      if (!startsBeforeRegion && !endsAfterRegion) {
        // Entirely contained — remove
        store._removeItems([item.id]);
      } else if (startsBeforeRegion && endsAfterRegion) {
        // Straddles both sides — split at start, then at end, remove middle
        const splitResult = store._splitItem(item.id, overwriteStart);
        if (splitResult) {
          affectedIds.push(splitResult.leftItem.id);
          const splitResult2 = useItemsStore.getState()._splitItem(splitResult.rightItem.id, overwriteEnd);
          if (splitResult2) {
            store._removeItems([splitResult2.leftItem.id]);
            affectedIds.push(splitResult2.rightItem.id);
          }
        }
      } else if (startsBeforeRegion) {
        // Extends before only — split at overwrite start, remove right piece
        const splitResult = store._splitItem(item.id, overwriteStart);
        if (splitResult) {
          store._removeItems([splitResult.rightItem.id]);
          affectedIds.push(splitResult.leftItem.id);
        }
      } else {
        // Extends after only — split at overwrite end, remove left piece
        const splitResult = store._splitItem(item.id, overwriteEnd);
        if (splitResult) {
          store._removeItems([splitResult.leftItem.id]);
          affectedIds.push(splitResult.rightItem.id);
        }
      }
    }

    // Add the new clip
    const newItem = createTimelineItem(ctx);
    store._addItem(newItem);
    affectedIds.push(newItem.id);

    applyTransitionRepairs(affectedIds);
    useTimelineSettingsStore.getState().markDirty();
  }, { trackId: activeTrackId, overwriteStart, overwriteEnd });

  // Advance playhead to end of overwritten clip
  usePlaybackStore.getState().setCurrentFrame(overwriteEnd);
  toast.success('Overwrite edit applied');
}
