/**
 * Item Actions - Cross-domain operations that affect items, transitions, and keyframes.
 */

import type { TimelineItem, ImageItem } from '@/types/timeline';
import type { MediaMetadata, ThumbnailData } from '@/types/storage';
import { useItemsStore } from '../items-store';
import { useTransitionsStore } from '../transitions-store';
import { useKeyframesStore } from '../keyframes-store';
import { useTimelineSettingsStore } from '../timeline-settings-store';
import { useSelectionStore } from '@/features/editor/stores/selection-store';
import { execute, applyTransitionRepairs, logger } from './shared';
import { blobUrlManager } from '@/lib/blob-url-manager';

/**
 * Close all gaps on a track by shifting items left to remove empty space.
 * Used by magnetic mode to auto-compact items after operations.
 */
function closeAllGapsOnTrack(trackId: string): void {
  const items = useItemsStore.getState().items;
  const trackItems = items
    .filter((i) => i.trackId === trackId)
    .sort((a, b) => a.from - b.from);

  if (trackItems.length === 0) return;

  // Build shift map: walk items left-to-right, accumulating gap sizes
  const updates: Array<{ id: string; from: number }> = [];
  let expectedStart = 0;

  for (const item of trackItems) {
    if (item.from > expectedStart) {
      // There's a gap — shift this item left
      updates.push({ id: item.id, from: expectedStart });
      expectedStart = expectedStart + item.durationInFrames;
    } else {
      // No gap (or overlap) — keep position, advance cursor
      expectedStart = item.from + item.durationInFrames;
    }
  }

  if (updates.length > 0) {
    useItemsStore.getState()._moveItems(updates);
  }
}

/**
 * Apply magnetic gap-closing on specified tracks if magnetic mode is enabled.
 * Repairs transitions on affected tracks afterwards.
 */
function applyMagneticRipple(trackIds: string[]): void {
  if (!useTimelineSettingsStore.getState().magneticMode) return;

  const uniqueTrackIds = [...new Set(trackIds)];
  for (const trackId of uniqueTrackIds) {
    closeAllGapsOnTrack(trackId);
  }

  // Repair transitions on all affected tracks
  const items = useItemsStore.getState().items;
  const affectedItemIds = items
    .filter((i) => uniqueTrackIds.includes(i.trackId))
    .map((i) => i.id);
  if (affectedItemIds.length > 0) {
    applyTransitionRepairs(affectedItemIds);
  }
}

export function addItem(item: TimelineItem): void {
  execute('ADD_ITEM', () => {
    useItemsStore.getState()._addItem(item);
    useTimelineSettingsStore.getState().markDirty();
  }, { itemId: item.id, type: item.type });
}

export function updateItem(id: string, updates: Partial<TimelineItem>): void {
  execute('UPDATE_ITEM', () => {
    useItemsStore.getState()._updateItem(id, updates);

    // Repair transitions if position changed
    const positionChanged = 'from' in updates || 'durationInFrames' in updates || 'trackId' in updates;
    if (positionChanged) {
      applyTransitionRepairs([id]);
    }

    useTimelineSettingsStore.getState().markDirty();
  }, { id, updates });
}

export function removeItems(ids: string[]): void {
  execute('REMOVE_ITEMS', () => {
    // Capture affected track IDs before removal (for magnetic mode)
    const items = useItemsStore.getState().items;
    const affectedTrackIds = [...new Set(
      items.filter((i) => ids.includes(i.id)).map((i) => i.trackId)
    )];

    // Remove items
    useItemsStore.getState()._removeItems(ids);

    // Cascade: Remove transitions referencing deleted items
    useTransitionsStore.getState()._removeTransitionsForItems(ids);

    // Cascade: Remove keyframes for deleted items
    useKeyframesStore.getState()._removeKeyframesForItems(ids);

    // Magnetic mode: close gaps on affected tracks
    applyMagneticRipple(affectedTrackIds);

    useTimelineSettingsStore.getState().markDirty();
  }, { ids });
}

export function rippleDeleteItems(ids: string[]): void {
  execute('RIPPLE_DELETE_ITEMS', () => {
    useItemsStore.getState()._rippleDeleteItems(ids);

    // Cascade: Remove transitions and keyframes
    useTransitionsStore.getState()._removeTransitionsForItems(ids);
    useKeyframesStore.getState()._removeKeyframesForItems(ids);

    useTimelineSettingsStore.getState().markDirty();
  }, { ids });
}

export function closeGapAtPosition(trackId: string, frame: number): void {
  execute('CLOSE_GAP', () => {
    useItemsStore.getState()._closeGapAtPosition(trackId, frame);

    // Repair all transitions on this track
    const items = useItemsStore.getState().items;
    const trackItemIds = items.filter((i) => i.trackId === trackId).map((i) => i.id);
    applyTransitionRepairs(trackItemIds);

    useTimelineSettingsStore.getState().markDirty();
  }, { trackId, frame });
}

export function moveItem(id: string, newFrom: number, newTrackId?: string): void {
  execute('MOVE_ITEM', () => {
    // Capture source track before move (for magnetic gap-close on source track)
    const item = useItemsStore.getState().items.find((i) => i.id === id);
    const sourceTrackId = item?.trackId;

    useItemsStore.getState()._moveItem(id, newFrom, newTrackId);

    // Repair transitions
    applyTransitionRepairs([id]);

    // Magnetic mode: close gaps on source track (and destination if cross-track)
    const affectedTracks: string[] = [];
    if (sourceTrackId) affectedTracks.push(sourceTrackId);
    if (newTrackId && newTrackId !== sourceTrackId) affectedTracks.push(newTrackId);
    applyMagneticRipple(affectedTracks);

    useTimelineSettingsStore.getState().markDirty();
  }, { id, newFrom, newTrackId });
}

export function moveItems(updates: Array<{ id: string; from: number; trackId?: string }>): void {
  execute('MOVE_ITEMS', () => {
    // Capture source tracks before move (for magnetic gap-close)
    const itemsBefore = useItemsStore.getState().items;
    const sourceTrackIds = new Set<string>();
    for (const u of updates) {
      const item = itemsBefore.find((i) => i.id === u.id);
      if (item) sourceTrackIds.add(item.trackId);
    }

    useItemsStore.getState()._moveItems(updates);

    const movedItemIds = new Set(updates.map((u) => u.id));
    const items = useItemsStore.getState().items;
    const transitions = useTransitionsStore.getState().transitions;

    // Update transition trackIds when both clips of a pair move together
    const updatedTransitions = transitions.map((t) => {
      const leftMoved = movedItemIds.has(t.leftClipId);
      const rightMoved = movedItemIds.has(t.rightClipId);

      if (leftMoved && rightMoved) {
        const leftClip = items.find((i) => i.id === t.leftClipId);
        const rightClip = items.find((i) => i.id === t.rightClipId);

        // If they're now on the same track, update transition trackId
        if (leftClip && rightClip && leftClip.trackId === rightClip.trackId) {
          return { ...t, trackId: leftClip.trackId };
        }
      }
      return t;
    });

    // Apply updated transitions (with trackId fixes) then repair
    useTransitionsStore.getState().setTransitions(updatedTransitions);
    applyTransitionRepairs(updates.map((u) => u.id));

    // Magnetic mode: close gaps on source and destination tracks
    const destTrackIds = new Set<string>();
    for (const u of updates) {
      if (u.trackId) destTrackIds.add(u.trackId);
    }
    const affectedTracks = [...sourceTrackIds, ...destTrackIds];
    applyMagneticRipple(affectedTracks);

    useTimelineSettingsStore.getState().markDirty();
  }, { count: updates.length });
}

export function duplicateItems(
  itemIds: string[],
  positions: Array<{ from: number; trackId: string }>
): TimelineItem[] {
  return execute('DUPLICATE_ITEMS', () => {
    const newItems = useItemsStore.getState()._duplicateItems(itemIds, positions);
    useTimelineSettingsStore.getState().markDirty();
    return newItems;
  }, { itemIds, count: positions.length });
}

export function trimItemStart(id: string, trimAmount: number): void {
  execute('TRIM_ITEM_START', () => {
    const item = useItemsStore.getState().items.find((i) => i.id === id);
    const trackId = item?.trackId;

    useItemsStore.getState()._trimItemStart(id, trimAmount);

    // Repair transitions (auto-adjusts duration if clip got shorter)
    applyTransitionRepairs([id]);

    // Magnetic mode: when trimming start inward (positive trimAmount),
    // a gap opens before the item — close it on the track
    if (trackId && trimAmount > 0) {
      applyMagneticRipple([trackId]);
    }

    useTimelineSettingsStore.getState().markDirty();
  }, { id, trimAmount });
}

export function trimItemEnd(id: string, trimAmount: number): void {
  execute('TRIM_ITEM_END', () => {
    const item = useItemsStore.getState().items.find((i) => i.id === id);
    const trackId = item?.trackId;

    useItemsStore.getState()._trimItemEnd(id, trimAmount);

    // Repair transitions (auto-adjusts duration if clip got shorter)
    applyTransitionRepairs([id]);

    // Magnetic mode: when trimming end inward (negative trimAmount),
    // a gap opens after the item — close it on the track
    if (trackId && trimAmount < 0) {
      applyMagneticRipple([trackId]);
    }

    useTimelineSettingsStore.getState().markDirty();
  }, { id, trimAmount });
}

export function splitItem(
  id: string,
  splitFrame: number
): { leftItem: TimelineItem; rightItem: TimelineItem } | null {
  return execute('SPLIT_ITEM', () => {
    const result = useItemsStore.getState()._splitItem(id, splitFrame);
    if (!result) return null;

    const { rightItem } = result;

    // Update transitions pointing to split item
    const transitions = useTransitionsStore.getState().transitions;
    const updatedTransitions = transitions.map((t) => {
      if (t.leftClipId === id) {
        // Transition was from this clip - now from right half
        return { ...t, leftClipId: rightItem.id };
      }
      if (t.rightClipId === id) {
        // Transition was to this clip - stays pointing to left half (original ID)
        return t;
      }
      return t;
    });
    useTransitionsStore.getState().setTransitions(updatedTransitions);

    // Keep selection anchored to the split clip for immediate downstream
    // adjacency/transition detection across all split entry points.
    useSelectionStore.getState().selectItems([result.leftItem.id]);

    useTimelineSettingsStore.getState().markDirty();
    return result;
  }, { id, splitFrame });
}

export function joinItems(itemIds: string[]): void {
  execute('JOIN_ITEMS', () => {
    useItemsStore.getState()._joinItems(itemIds);

    // Remove keyframes for joined items (except first)
    if (itemIds.length > 1) {
      useKeyframesStore.getState()._removeKeyframesForItems(itemIds.slice(1));
    }

    useTimelineSettingsStore.getState().markDirty();
  }, { itemIds });
}

export function rateStretchItem(
  id: string,
  newFrom: number,
  newDuration: number,
  newSpeed: number
): void {
  execute('RATE_STRETCH_ITEM', () => {
    // Get old duration BEFORE applying rate stretch (needed for keyframe scaling)
    const oldItem = useItemsStore.getState().items.find((i) => i.id === id);
    const oldDuration = oldItem?.durationInFrames ?? newDuration;

    useItemsStore.getState()._rateStretchItem(id, newFrom, newDuration, newSpeed);

    // Scale keyframes proportionally to match new duration
    // This ensures animations maintain their relative timing within the clip
    if (oldDuration !== newDuration) {
      useKeyframesStore.getState()._scaleKeyframesForItem(id, oldDuration, newDuration);
    }

    // Repair transitions
    applyTransitionRepairs([id]);

    useTimelineSettingsStore.getState().markDirty();
  }, { id, newFrom, newDuration, newSpeed });
}

/**
 * Insert a freeze frame at the playhead position.
 *
 * Extracts the video frame at the current playhead, stores it as a media entry,
 * splits the video clip at the playhead, and inserts a still image between the halves.
 *
 * This is async because frame extraction requires mediabunny. The timeline
 * mutations are batched in a single command for undo/redo atomicity.
 */
export async function insertFreezeFrame(
  itemId: string,
  playheadFrame: number
): Promise<boolean> {
  const items = useItemsStore.getState().items;
  const item = items.find((i) => i.id === itemId);
  if (!item || item.type !== 'video') return false;

  // Validate playhead is within item bounds (exclusive of edges — need room to split)
  const itemStart = item.from;
  const itemEnd = item.from + item.durationInFrames;
  if (playheadFrame <= itemStart || playheadFrame >= itemEnd) return false;

  const fps = useTimelineSettingsStore.getState().fps;
  const speed = item.speed ?? 1;
  const sourceStart = item.sourceStart ?? 0;

  // Calculate source frame at playhead in source-native FPS
  const timelineOffset = playheadFrame - itemStart;
  const sourceFrame = sourceStart + Math.round(timelineOffset * speed);

  // Get media metadata for resolution and fps info
  const { useMediaLibraryStore } = await import('@/features/media-library/stores/media-library-store');
  const mediaItems = useMediaLibraryStore.getState().mediaItems;
  const media = mediaItems.find((m) => m.id === item.mediaId);
  if (!media) {
    logger.error('[insertFreezeFrame] Media not found for item:', item.mediaId);
    return false;
  }

  // Calculate timestamp in seconds for frame extraction
  const mediaFps = media.fps || 30;
  const timestampSeconds = sourceFrame / mediaFps;

  try {
    // Step 1: Get the media file blob
    const { mediaLibraryService } = await import('@/features/media-library/services/media-library-service');
    const blob = await mediaLibraryService.getMediaFile(media.id);
    if (!blob) {
      logger.error('[insertFreezeFrame] Could not access media file');
      return false;
    }

    // Step 2: Extract frame using mediabunny at native resolution
    const { Input, BlobSource, CanvasSink, ALL_FORMATS } = await import('mediabunny');
    const input = new Input({
      source: new BlobSource(blob as File),
      formats: ALL_FORMATS,
    });

    const videoTrack = await input.getPrimaryVideoTrack();
    if (!videoTrack) {
      input.dispose();
      logger.error('[insertFreezeFrame] No video track found');
      return false;
    }

    const frameWidth = videoTrack.displayWidth;
    const frameHeight = videoTrack.displayHeight;

    const sink = new CanvasSink(videoTrack, {
      width: frameWidth,
      height: frameHeight,
      fit: 'fill',
    });

    const wrapped = await sink.getCanvas(timestampSeconds);
    if (!wrapped) {
      (sink as unknown as { dispose?: () => void }).dispose?.();
      input.dispose();
      logger.error('[insertFreezeFrame] Failed to extract frame');
      return false;
    }

    const canvas = wrapped.canvas as OffscreenCanvas | HTMLCanvasElement;
    let frameBlob: Blob;
    if ('convertToBlob' in canvas) {
      frameBlob = await canvas.convertToBlob({ type: 'image/png' });
    } else {
      frameBlob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error('Failed to create blob'))),
          'image/png'
        );
      });
    }

    // Clean up mediabunny resources
    (sink as unknown as { dispose?: () => void }).dispose?.();
    input.dispose();

    // Step 3: Store frame as media in IndexedDB
    const { createMedia, saveThumbnail, associateMediaWithProject } = await import('@/lib/storage/indexeddb');
    const currentProjectId = useMediaLibraryStore.getState().currentProjectId;
    if (!currentProjectId) {
      logger.error('[insertFreezeFrame] No project context');
      return false;
    }

    const frameMediaId = crypto.randomUUID();
    const frameBlobUrl = blobUrlManager.acquire(frameMediaId, frameBlob);
    const fileName = `freeze-frame-${item.label || 'video'}-${Math.round(timestampSeconds * 100) / 100}s.png`;

    const mediaMetadata: MediaMetadata = {
      id: frameMediaId,
      storageType: 'opfs',
      fileName,
      fileSize: frameBlob.size,
      mimeType: 'image/png',
      duration: 0,
      width: frameWidth,
      height: frameHeight,
      fps: 0,
      codec: 'png',
      bitrate: 0,
      tags: ['freeze-frame'],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    // Store the frame blob in OPFS
    const { opfsService } = await import('@/features/media-library/services/opfs-service');
    const opfsPath = `content/${frameMediaId.slice(0, 2)}/${frameMediaId.slice(2, 4)}/${frameMediaId}/data`;
    await opfsService.saveFile(opfsPath, await frameBlob.arrayBuffer());
    mediaMetadata.opfsPath = opfsPath;

    await createMedia(mediaMetadata);
    await associateMediaWithProject(currentProjectId, frameMediaId);

    // Save thumbnail (reuse the frame blob)
    const thumbnailId = crypto.randomUUID();
    const thumbnailData: ThumbnailData = {
      id: thumbnailId,
      mediaId: frameMediaId,
      blob: frameBlob,
      timestamp: 0,
      width: frameWidth,
      height: frameHeight,
    };
    await saveThumbnail(thumbnailData);
    mediaMetadata.thumbnailId = thumbnailId;

    // Add to media library store
    useMediaLibraryStore.setState((state) => ({
      mediaItems: [mediaMetadata, ...state.mediaItems],
    }));

    // Step 4: Perform timeline mutations atomically (split + insert + shift)
    const freezeDurationFrames = Math.round(fps * 2); // 2 seconds

    execute('INSERT_FREEZE_FRAME', () => {
      // Split the video at playhead
      const splitResult = useItemsStore.getState()._splitItem(itemId, playheadFrame);
      if (!splitResult) {
        logger.error('[insertFreezeFrame] Split failed');
        return;
      }

      const { leftItem, rightItem } = splitResult;

      // Update transitions pointing to split item
      const transitions = useTransitionsStore.getState().transitions;
      const updatedTransitions = transitions.map((t) => {
        if (t.leftClipId === itemId) {
          return { ...t, leftClipId: rightItem.id };
        }
        return t;
      });
      useTransitionsStore.getState().setTransitions(updatedTransitions);

      // Create ImageItem for the freeze frame
      const freezeFrameItem: ImageItem = {
        id: crypto.randomUUID(),
        type: 'image',
        trackId: item.trackId,
        from: playheadFrame,
        durationInFrames: freezeDurationFrames,
        label: fileName,
        mediaId: frameMediaId,
        src: frameBlobUrl,
        sourceWidth: frameWidth,
        sourceHeight: frameHeight,
        transform: item.transform ? { ...item.transform } : undefined,
      };

      useItemsStore.getState()._addItem(freezeFrameItem);

      // Shift the right half forward by freeze frame duration
      const newRightFrom = rightItem.from + freezeDurationFrames;
      useItemsStore.getState()._moveItem(rightItem.id, newRightFrom);

      // Also shift all items on same track that come after the right half
      const allItems = useItemsStore.getState().items;
      const itemsToShift = allItems.filter(
        (i) =>
          i.trackId === item.trackId &&
          i.id !== rightItem.id &&
          i.id !== leftItem.id &&
          i.id !== freezeFrameItem.id &&
          i.from > playheadFrame
      );

      for (const shiftItem of itemsToShift) {
        useItemsStore.getState()._moveItem(shiftItem.id, shiftItem.from + freezeDurationFrames);
      }

      // Repair transitions
      applyTransitionRepairs([leftItem.id, rightItem.id]);

      // Select the freeze frame item
      useSelectionStore.getState().selectItems([freezeFrameItem.id]);

      useTimelineSettingsStore.getState().markDirty();
    }, { itemId, playheadFrame, freezeDurationFrames });

    return true;
  } catch (error) {
    logger.error('[insertFreezeFrame] Failed:', error);
    return false;
  }
}
