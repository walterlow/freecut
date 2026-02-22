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
import { toast } from 'sonner';
import { execute, applyTransitionRepairs, logger } from './shared';
import { blobUrlManager } from '@/lib/blob-url-manager';
import { timelineToSourceFrames } from '../../utils/source-calculations';

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
    // Remove items
    useItemsStore.getState()._removeItems(ids);

    // Cascade: Remove transitions referencing deleted items
    useTransitionsStore.getState()._removeTransitionsForItems(ids);

    // Cascade: Remove keyframes for deleted items
    useKeyframesStore.getState()._removeKeyframesForItems(ids);

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

export function closeAllGapsOnTrack(trackId: string): void {
  execute('CLOSE_ALL_GAPS', () => {
    const items = useItemsStore.getState().items;
    const trackItems = items
      .filter((i) => i.trackId === trackId)
      .sort((a, b) => a.from - b.from);

    if (trackItems.length === 0) return;

    // Walk items left-to-right, shift each to close any gap before it
    let cursor = 0;
    const updates: Array<{ id: string; from: number }> = [];
    for (const item of trackItems) {
      const newFrom = item.from > cursor ? cursor : item.from;
      if (newFrom !== item.from) {
        updates.push({ id: item.id, from: newFrom });
      }
      cursor = newFrom + item.durationInFrames;
    }

    if (updates.length > 0) {
      useItemsStore.getState()._moveItems(updates);

      // Repair transitions on affected items
      const trackItemIds = trackItems.map((i) => i.id);
      applyTransitionRepairs(trackItemIds);
      useTimelineSettingsStore.getState().markDirty();
    }
  }, { trackId });
}

export function moveItem(id: string, newFrom: number, newTrackId?: string): void {
  execute('MOVE_ITEM', () => {
    useItemsStore.getState()._moveItem(id, newFrom, newTrackId);

    // Repair transitions
    applyTransitionRepairs([id]);

    useTimelineSettingsStore.getState().markDirty();
  }, { id, newFrom, newTrackId });
}

export function moveItems(updates: Array<{ id: string; from: number; trackId?: string }>): void {
  execute('MOVE_ITEMS', () => {
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
    useItemsStore.getState()._trimItemStart(id, trimAmount);

    // Repair transitions (auto-adjusts duration if clip got shorter)
    applyTransitionRepairs([id]);

    useTimelineSettingsStore.getState().markDirty();
  }, { id, trimAmount });
}

export function trimItemEnd(id: string, trimAmount: number): void {
  execute('TRIM_ITEM_END', () => {
    useItemsStore.getState()._trimItemEnd(id, trimAmount);

    // Repair transitions (auto-adjusts duration if clip got shorter)
    applyTransitionRepairs([id]);

    useTimelineSettingsStore.getState().markDirty();
  }, { id, trimAmount });
}

/**
 * Check if a frame falls inside any transition overlap zone for a given item.
 * Uses the full transition duration (not alignment-based portions) because
 * the entire overlap region is part of the transition effect.
 */
function isInTransitionOverlap(itemId: string, relativeFrame: number, itemDuration: number): boolean {
  const transitions = useTransitionsStore.getState().transitions;
  return transitions.some((t) =>
    (t.leftClipId === itemId && relativeFrame >= itemDuration - t.durationInFrames) ||
    (t.rightClipId === itemId && relativeFrame < t.durationInFrames)
  );
}

export function splitItem(
  id: string,
  splitFrame: number
): { leftItem: TimelineItem; rightItem: TimelineItem } | null {
  const item = useItemsStore.getState().items.find((i) => i.id === id);
  if (item) {
    // Bounds check first — out-of-range splits are a silent no-op (handled by _splitItem),
    // must not fall through to transition zone check which would false-positive.
    if (splitFrame <= item.from || splitFrame >= item.from + item.durationInFrames) {
      return null;
    }
    const relativeFrame = splitFrame - item.from;
    if (isInTransitionOverlap(id, relativeFrame, item.durationInFrames)) {
      toast.warning('Cannot split inside a transition zone');
      return null;
    }
  }

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

  // Block freeze frame insertion inside transition overlap zones
  if (isInTransitionOverlap(itemId, playheadFrame - itemStart, item.durationInFrames)) {
    return false;
  }

  const fps = useTimelineSettingsStore.getState().fps;
  const speed = item.speed ?? 1;
  const sourceStart = item.sourceStart ?? 0;
  const sourceFps = item.sourceFps ?? fps;

  // Calculate source frame at playhead in source-native FPS
  const timelineOffset = playheadFrame - itemStart;
  const sourceFrame = sourceStart + timelineToSourceFrames(timelineOffset, speed, fps, sourceFps);

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

/**
 * Ripple edit: trim a clip and shift all downstream items on the same track.
 *
 * Unlike normal trim which leaves gaps, ripple edit closes/opens gaps by
 * shifting everything after the trim point.
 *
 * End handle: trims the end, shifts downstream items by the change in end position.
 * Start handle: trims the start (changes source/duration), then moves the trimmed
 *   clip back to its original `from` and shifts downstream items by the duration change.
 *
 * @param id - ID of the clip being trimmed
 * @param handle - Which handle is being dragged ('start' or 'end')
 * @param trimDelta - Frames to trim (positive = shrink start / extend end,
 *                    negative = extend start / shrink end)
 */
export function rippleTrimItem(id: string, handle: 'start' | 'end', trimDelta: number): void {
  if (trimDelta === 0) return;

  execute('RIPPLE_EDIT', () => {
    const itemsBefore = useItemsStore.getState().items;
    const item = itemsBefore.find((i) => i.id === id);
    if (!item) return;

    const oldFrom = item.from;
    const oldEnd = item.from + item.durationInFrames;

    // Apply the trim — skip adjacency clamping since downstream items will be shifted
    if (handle === 'start') {
      useItemsStore.getState()._trimItemStart(id, trimDelta, { skipAdjacentClamp: true });
    } else {
      useItemsStore.getState()._trimItemEnd(id, trimDelta, { skipAdjacentClamp: true });
    }

    const itemsAfterTrim = useItemsStore.getState().items;
    const trimmedItem = itemsAfterTrim.find((i) => i.id === id);
    if (!trimmedItem) return;

    let shiftAmount: number;

    if (handle === 'end') {
      // End handle: downstream items shift by the change in end position
      const newEnd = trimmedItem.from + trimmedItem.durationInFrames;
      shiftAmount = newEnd - oldEnd;
    } else {
      // Start handle: _trimItemStart moved `from` — move it back and compute
      // the shift from the duration change.
      // _trimItemStart: newFrom = oldFrom + clamped, newDuration = oldDuration - clamped
      // We want: from stays at oldFrom, same newDuration, downstream shifts by -clamped
      const actualClamped = trimmedItem.from - oldFrom;
      if (actualClamped !== 0) {
        useItemsStore.getState()._moveItem(id, oldFrom);
      }
      // Duration got shorter by `actualClamped` (positive = shorter), so downstream
      // should shift left (negative) by the same amount → shift = -actualClamped
      shiftAmount = -actualClamped;
    }

    if (shiftAmount !== 0) {
      // Shift all items on the same track that are downstream of the trimmed item's original end.
      // Also include transition-connected neighbors whose `from` may be before oldEnd (overlap model).
      const freshItems = useItemsStore.getState().items;
      const transitionNeighborIds = new Set<string>();
      for (const t of useTransitionsStore.getState().transitions) {
        if (t.leftClipId === id) transitionNeighborIds.add(t.rightClipId);
      }
      const downstream = freshItems.filter(
        (i) => i.id !== id && i.trackId === item.trackId &&
          (i.from >= oldEnd || transitionNeighborIds.has(i.id))
      );

      if (downstream.length > 0) {
        const updates = downstream.map((i) => ({
          id: i.id,
          from: i.from + shiftAmount,
        }));
        useItemsStore.getState()._moveItems(updates);
      }
    }

    // Repair transitions for the trimmed item and all downstream items
    const finalItems = useItemsStore.getState().items;
    const allAffected = [id, ...finalItems
      .filter((i) => i.id !== id && i.trackId === item.trackId && i.from >= oldFrom)
      .map((i) => i.id)];
    applyTransitionRepairs(allAffected);

    useTimelineSettingsStore.getState().markDirty();
  }, { id, handle, trimDelta });
}

/**
 * Rolling edit: move the edit point between two adjacent clips.
 * Trims the left clip's end and the right clip's start by the same amount,
 * keeping total timeline duration unchanged.
 *
 * @param leftId - ID of the left clip (its end edge is being adjusted)
 * @param rightId - ID of the right clip (its start edge is being adjusted)
 * @param editPointDelta - Frames to move the edit point (positive = right, negative = left)
 */
export function rollingTrimItems(leftId: string, rightId: string, editPointDelta: number): void {
  if (editPointDelta === 0) return;

  execute('ROLLING_EDIT', () => {
    // Order matters: shrink first, then extend. The internal _trimItemEnd/_trimItemStart
    // methods have clampToAdjacentItems guards that prevent extending into a neighbor.
    // By shrinking the losing clip first, we free up space for the gaining clip to extend into.
    if (editPointDelta > 0) {
      // Edit point moves right: right clip shrinks (frees space), then left clip extends
      useItemsStore.getState()._trimItemStart(rightId, editPointDelta);
      useItemsStore.getState()._trimItemEnd(leftId, editPointDelta);
    } else {
      // Edit point moves left: left clip shrinks (frees space), then right clip extends
      useItemsStore.getState()._trimItemEnd(leftId, editPointDelta);
      useItemsStore.getState()._trimItemStart(rightId, editPointDelta);
    }

    // Repair transitions for both clips
    applyTransitionRepairs([leftId, rightId]);

    useTimelineSettingsStore.getState().markDirty();
  }, { leftId, rightId, editPointDelta });
}
