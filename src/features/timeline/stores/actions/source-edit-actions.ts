/**
 * Source Edit Actions - Insert and Overwrite editing from the source monitor.
 */

import type { TimelineItem, TimelineTrack, VideoItem, AudioItem, ImageItem } from '@/types/timeline';
import { useItemsStore } from '../items-store';
import { useTimelineSettingsStore } from '../timeline-settings-store';
import { useSelectionStore } from '@/shared/state/selection';
import { useEditorStore } from '@/app/state/editor';
import { useSourcePlayerStore } from '@/shared/state/source-player';
import { usePlaybackStore } from '@/shared/state/playback';
import { useMediaLibraryStore } from '@/features/timeline/deps/media-library-store';
import { useProjectStore } from '@/features/timeline/deps/projects';
import { mediaLibraryService } from '@/features/timeline/deps/media-library-service';
import { getMediaType } from '@/features/timeline/deps/media-library-resolver';
import { toast } from 'sonner';
import { computeInitialTransform } from '../../utils/transform-init';
import { execute, applyTransitionRepairs, getLogger } from './shared';
import { resolveSourceEditTrackTargets } from '../../utils/source-edit-targeting';
import { DEFAULT_TRACK_HEIGHT } from '../../constants';

interface SourceEditContext {
  sourceMediaId: string;
  videoTrackId?: string;
  audioTrackId?: string;
  effectiveIn: number;
  effectiveOut: number;
  clipDurationFrames: number;
  insertFrame: number;
  blobUrl: string;
  thumbnailUrl: string | undefined;
  media: { duration: number; fps: number | undefined; width: number | undefined; height: number | undefined; mimeType: string; fileName: string };
  mediaType: 'video' | 'audio' | 'image';
  hasAudio: boolean;
  canvasWidth: number;
  canvasHeight: number;
  projectFps: number;
  resolvedTracks: TimelineTrack[];
}

async function resolveSourceEditContext(): Promise<SourceEditContext | null> {
  const {
    sourcePreviewMediaId: sourceMediaId,
    sourcePatchVideoEnabled,
    sourcePatchAudioEnabled,
    sourcePatchVideoTrackId,
    sourcePatchAudioTrackId,
  } = useEditorStore.getState();
  if (!sourceMediaId) {
    toast.warning('Open a source in the source monitor first');
    return null;
  }

  const { inPoint, outPoint } = useSourcePlayerStore.getState();
  const { activeTrackId } = useSelectionStore.getState();
  const tracks = useItemsStore.getState().tracks;
  const activeTrack = activeTrackId
    ? tracks.find((track) => track.id === activeTrackId) ?? null
    : null;
  const preferredVideoTrack = sourcePatchVideoTrackId
    ? tracks.find((track) => track.id === sourcePatchVideoTrackId) ?? null
    : null;
  const preferredAudioTrack = sourcePatchAudioTrackId
    ? tracks.find((track) => track.id === sourcePatchAudioTrackId) ?? null
    : null;
  const referenceTrack = activeTrack ?? preferredVideoTrack ?? preferredAudioTrack ?? null;

  const mediaItems = useMediaLibraryStore.getState().mediaItems;
  const media = mediaItems.find((m) => m.id === sourceMediaId);
  if (!media) {
    getLogger().warn('Source edit: Source media not found');
    return null;
  }

  const mediaType = getMediaType(media.mimeType);
  if (mediaType === 'unknown') {
    getLogger().warn('Source edit: Unknown media type');
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
  const hasAudio = mediaType === 'video' && !!media.audioCodec;
  const resolvedTargets = resolveSourceEditTrackTargets({
    tracks,
    activeTrackId,
    preferredVideoTrackId: sourcePatchVideoTrackId,
    preferredAudioTrackId: sourcePatchAudioTrackId,
    mediaType,
    hasAudio,
    patchVideo: sourcePatchVideoEnabled,
    patchAudio: sourcePatchAudioEnabled,
    preferredTrackHeight: referenceTrack?.height ?? DEFAULT_TRACK_HEIGHT,
  });
  if (!resolvedTargets) {
    if (!sourcePatchVideoEnabled && !sourcePatchAudioEnabled) {
      toast.warning('Enable V and/or A source patch targets first');
    } else if (mediaType === 'audio' && !sourcePatchAudioEnabled) {
      toast.warning('Enable the A source patch target to edit audio');
    } else if ((mediaType === 'video' || mediaType === 'image') && !sourcePatchVideoEnabled && !hasAudio) {
      toast.warning('Enable the V source patch target to edit this source');
    } else {
      toast.warning('Unable to resolve source patch targets');
    }
    return null;
  }

  const targetTrackIds = [resolvedTargets.videoTrackId, resolvedTargets.audioTrackId].filter(
    (trackId): trackId is string => !!trackId
  );
  const lockedTarget = resolvedTargets.tracks.find((timelineTrack) =>
    targetTrackIds.includes(timelineTrack.id) && timelineTrack.locked
  );
  if (lockedTarget) {
    toast.warning(`Target track ${lockedTarget.name} is locked`);
    return null;
  }

  // Resolve blob URLs before execute (async not allowed inside execute)
  const blobUrl = await mediaLibraryService.getMediaBlobUrl(sourceMediaId);
  if (!blobUrl) {
    toast.error('Failed to load source media');
    return null;
  }
  const thumbnailUrl = (await mediaLibraryService.getThumbnailBlobUrl(sourceMediaId)) || undefined;

  return {
    sourceMediaId,
    videoTrackId: resolvedTargets.videoTrackId,
    audioTrackId: resolvedTargets.audioTrackId,
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
    hasAudio,
    canvasWidth,
    canvasHeight,
    projectFps,
    resolvedTracks: resolvedTargets.tracks,
  };
}

function createTimelineItems(ctx: SourceEditContext): TimelineItem[] {
  const sourceFps = ctx.media.fps || 30;
  const actualSourceDurationFrames = ctx.mediaType === 'image'
    ? ctx.projectFps * 3
    : Math.round(ctx.media.duration * sourceFps);
  const originId = crypto.randomUUID();
  const linkedGroupId = ctx.mediaType === 'video' && ctx.hasAudio ? crypto.randomUUID() : undefined;

  const baseItem = {
    from: ctx.insertFrame,
    durationInFrames: ctx.clipDurationFrames,
    label: ctx.media.fileName,
    mediaId: ctx.sourceMediaId,
    originId,
    linkedGroupId,
    sourceStart: ctx.effectiveIn,
    sourceEnd: ctx.effectiveOut,
    sourceDuration: actualSourceDurationFrames,
    sourceFps,
    trimStart: 0,
    trimEnd: 0,
  };

  if (ctx.mediaType === 'video' && ctx.videoTrackId) {
    const sourceW = ctx.media.width || ctx.canvasWidth;
    const sourceH = ctx.media.height || ctx.canvasHeight;
    const videoItem: VideoItem = {
      ...baseItem,
      id: crypto.randomUUID(),
      trackId: ctx.videoTrackId,
      type: 'video',
      src: ctx.blobUrl,
      thumbnailUrl: ctx.thumbnailUrl,
      sourceWidth: ctx.media.width || undefined,
      sourceHeight: ctx.media.height || undefined,
      transform: computeInitialTransform(sourceW, sourceH, ctx.canvasWidth, ctx.canvasHeight),
    };

    if (!ctx.audioTrackId) {
      return [videoItem];
    }

    const audioItem: AudioItem = {
      ...baseItem,
      id: crypto.randomUUID(),
      trackId: ctx.audioTrackId,
      type: 'audio',
      src: ctx.blobUrl,
    };

    return [videoItem, audioItem];
  }

  if (ctx.mediaType === 'audio' && ctx.audioTrackId) {
    return [{
      ...baseItem,
      id: crypto.randomUUID(),
      trackId: ctx.audioTrackId,
      type: 'audio',
      src: ctx.blobUrl,
      linkedGroupId: undefined,
    } as AudioItem];
  }

  if (ctx.videoTrackId) {
    const sourceW = ctx.media.width || ctx.canvasWidth;
    const sourceH = ctx.media.height || ctx.canvasHeight;
    return [{
      ...baseItem,
      id: crypto.randomUUID(),
      trackId: ctx.videoTrackId,
      type: 'image',
      src: ctx.blobUrl,
      thumbnailUrl: ctx.thumbnailUrl,
      sourceWidth: ctx.media.width || undefined,
      sourceHeight: ctx.media.height || undefined,
      transform: computeInitialTransform(sourceW, sourceH, ctx.canvasWidth, ctx.canvasHeight),
      linkedGroupId: undefined,
    } as ImageItem];
  }

  return [];
}

export async function performInsertEdit(): Promise<void> {
  const ctx = await resolveSourceEditContext();
  if (!ctx) return;

  const { insertFrame, clipDurationFrames } = ctx;
  const newItems = createTimelineItems(ctx);
  const targetTrackIds = Array.from(new Set(newItems.map((item) => item.trackId)));
  if (newItems.length === 0 || targetTrackIds.length === 0) {
    toast.warning('Unable to resolve source patch targets');
    return;
  }

  execute('INSERT_EDIT', () => {
    const store = useItemsStore.getState();
    store.setTracks(ctx.resolvedTracks);
    const splitIds: string[] = [];
    const shiftedIds: string[] = [];

    for (const targetTrackId of targetTrackIds) {
      const straddleItem = useItemsStore.getState().items.find(
        (item) =>
          item.trackId === targetTrackId &&
          item.from < insertFrame &&
          item.from + item.durationInFrames > insertFrame
      );

      if (straddleItem) {
        const splitResult = store._splitItem(straddleItem.id, insertFrame);
        if (splitResult) {
          splitIds.push(splitResult.leftItem.id, splitResult.rightItem.id);
        }
      }

      const itemsToShift = useItemsStore.getState().items.filter(
        (item) => item.trackId === targetTrackId && item.from >= insertFrame
      );
      for (const item of itemsToShift) {
        store._moveItem(item.id, item.from + clipDurationFrames);
        shiftedIds.push(item.id);
      }
    }

    for (const newItem of newItems) {
      store._addItem(newItem);
    }

    const affectedIds = [...newItems.map((item) => item.id), ...shiftedIds, ...splitIds];
    applyTransitionRepairs(affectedIds);

    useTimelineSettingsStore.getState().markDirty();
  }, { trackIds: targetTrackIds, insertFrame, clipDurationFrames });

  // Advance playhead to end of inserted clip
  usePlaybackStore.getState().setCurrentFrame(insertFrame + clipDurationFrames);
  toast.success('Insert edit applied');
}

export async function performOverwriteEdit(): Promise<void> {
  const ctx = await resolveSourceEditContext();
  if (!ctx) return;

  const { insertFrame, clipDurationFrames } = ctx;
  const overwriteStart = insertFrame;
  const overwriteEnd = insertFrame + clipDurationFrames;
  const newItems = createTimelineItems(ctx);
  const targetTrackIds = Array.from(new Set(newItems.map((item) => item.trackId)));
  if (newItems.length === 0 || targetTrackIds.length === 0) {
    toast.warning('Unable to resolve source patch targets');
    return;
  }

  execute('OVERWRITE_EDIT', () => {
    const store = useItemsStore.getState();
    store.setTracks(ctx.resolvedTracks);
    const affectedIds: string[] = [];

    for (const targetTrackId of targetTrackIds) {
      const overlapping = useItemsStore.getState().items.filter(
        (item) =>
          item.trackId === targetTrackId &&
          item.from < overwriteEnd &&
          item.from + item.durationInFrames > overwriteStart
      );

      for (const item of overlapping) {
        const itemEnd = item.from + item.durationInFrames;
        const startsBeforeRegion = item.from < overwriteStart;
        const endsAfterRegion = itemEnd > overwriteEnd;

        if (!startsBeforeRegion && !endsAfterRegion) {
          store._removeItems([item.id]);
        } else if (startsBeforeRegion && endsAfterRegion) {
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
          const splitResult = store._splitItem(item.id, overwriteStart);
          if (splitResult) {
            store._removeItems([splitResult.rightItem.id]);
            affectedIds.push(splitResult.leftItem.id);
          }
        } else {
          const splitResult = store._splitItem(item.id, overwriteEnd);
          if (splitResult) {
            store._removeItems([splitResult.leftItem.id]);
            affectedIds.push(splitResult.rightItem.id);
          }
        }
      }
    }

    for (const newItem of newItems) {
      store._addItem(newItem);
      affectedIds.push(newItem.id);
    }

    applyTransitionRepairs(affectedIds);
    useTimelineSettingsStore.getState().markDirty();
  }, { trackIds: targetTrackIds, overwriteStart, overwriteEnd });

  // Advance playhead to end of overwritten clip
  usePlaybackStore.getState().setCurrentFrame(overwriteEnd);
  toast.success('Overwrite edit applied');
}
