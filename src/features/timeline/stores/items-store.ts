import { create } from 'zustand';
import { createLogger } from '@/shared/logging/logger';
import type { AudioItem, TextItem, TimelineItem, TimelineTrack, VideoItem } from '@/types/timeline';
import type { TransformProperties } from '@/types/transform';
import type { VisualEffect, ItemEffect } from '@/types/effects';
import { clampTrimAmount, clampToAdjacentItems, calculateTrimSourceUpdate } from '../utils/trim-utils';
import { getSourceProperties, isMediaItem, calculateSplitSourceBoundaries, timelineToSourceFrames, calculateSpeed, clampSpeed } from '../utils/source-calculations';
import { getLinkedItems } from '../utils/linked-items';
import { isCompositionWrapperItem, wouldCreateCompositionCycle } from '../utils/composition-graph';
import { useCompositionNavigationStore } from './composition-navigation-store';
import { useCompositionsStore } from './compositions-store';
import { useTimelineSettingsStore } from './timeline-settings-store';
import { useTransitionsStore } from './transitions-store';
import { useMarkersStore } from './markers-store';
import { clampAudioFadeCurve, clampAudioFadeCurveX } from '@/shared/utils/audio-fade-curve';
import { normalizeCropSettings } from '@/shared/utils/media-crop';
import {
  getEffectiveTimelineMaxFrame,
  sanitizeInOutPoints,
} from '../utils/in-out-points';

function getLog() { return createLogger('ItemsStore'); }

function roundFrame(value: number, fallback = 0): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(0, Math.round(value));
}

function roundDuration(value: number, fallback = 1): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(1, Math.round(value));
}

function roundOptionalFrame(value: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  return roundFrame(value);
}

function normalizeOptionalFps(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return undefined;
  return Math.round(value * 1000) / 1000;
}

function normalizeFrameFields<T extends TimelineItem>(item: T): T {
  const normalized = {
    ...item,
    from: roundFrame(item.from),
    durationInFrames: roundDuration(item.durationInFrames),
    trimStart: roundOptionalFrame(item.trimStart),
    trimEnd: roundOptionalFrame(item.trimEnd),
    sourceStart: roundOptionalFrame(item.sourceStart),
    sourceEnd: roundOptionalFrame(item.sourceEnd),
    sourceDuration: roundOptionalFrame(item.sourceDuration),
    sourceFps: normalizeOptionalFps(item.sourceFps),
    crop: normalizeCropSettings(item.crop),
    audioFadeInCurve: item.audioFadeInCurve === undefined ? undefined : clampAudioFadeCurve(item.audioFadeInCurve),
    audioFadeOutCurve: item.audioFadeOutCurve === undefined ? undefined : clampAudioFadeCurve(item.audioFadeOutCurve),
    audioFadeInCurveX: item.audioFadeInCurveX === undefined ? undefined : clampAudioFadeCurveX(item.audioFadeInCurveX),
    audioFadeOutCurveX: item.audioFadeOutCurveX === undefined ? undefined : clampAudioFadeCurveX(item.audioFadeOutCurveX),
  };

  // Legacy split clips can have sourceEnd without sourceStart.
  // Treat them as explicitly bounded from 0 to sourceEnd so rate stretch
  // operates on the split segment rather than the full media duration.
  if ((normalized.type === 'video' || normalized.type === 'audio') &&
      normalized.sourceEnd !== undefined &&
      normalized.sourceStart === undefined) {
    normalized.sourceStart = 0;
  }

  return normalized as T;
}

function normalizeItemUpdates(updates: Partial<TimelineItem>): Partial<TimelineItem> {
  const normalized = { ...updates } as Partial<TimelineItem>;

  if (normalized.from !== undefined) normalized.from = roundFrame(normalized.from);
  if (normalized.durationInFrames !== undefined) normalized.durationInFrames = roundDuration(normalized.durationInFrames);
  if (normalized.trimStart !== undefined) normalized.trimStart = roundFrame(normalized.trimStart);
  if (normalized.trimEnd !== undefined) normalized.trimEnd = roundFrame(normalized.trimEnd);
  if (normalized.sourceStart !== undefined) normalized.sourceStart = roundFrame(normalized.sourceStart);
  if (normalized.sourceEnd !== undefined) normalized.sourceEnd = roundFrame(normalized.sourceEnd);
  if (normalized.sourceDuration !== undefined) normalized.sourceDuration = roundFrame(normalized.sourceDuration);
  if (normalized.sourceFps !== undefined) normalized.sourceFps = normalizeOptionalFps(normalized.sourceFps);
  if (normalized.crop !== undefined) normalized.crop = normalizeCropSettings(normalized.crop);

  // Keep legacy end-only bounds explicit and stable.
  if (normalized.sourceEnd !== undefined &&
      normalized.sourceStart === undefined) {
    normalized.sourceStart = 0;
  }

   if (normalized.audioFadeInCurve !== undefined) {
    normalized.audioFadeInCurve = clampAudioFadeCurve(normalized.audioFadeInCurve);
  }
  if (normalized.audioFadeOutCurve !== undefined) {
    normalized.audioFadeOutCurve = clampAudioFadeCurve(normalized.audioFadeOutCurve);
  }
  if (normalized.audioFadeInCurveX !== undefined) {
    normalized.audioFadeInCurveX = clampAudioFadeCurveX(normalized.audioFadeInCurveX);
  }
  if (normalized.audioFadeOutCurveX !== undefined) {
    normalized.audioFadeOutCurveX = clampAudioFadeCurveX(normalized.audioFadeOutCurveX);
  }

  return normalized;
}

function areItemArraysEqual(a: TimelineItem[] | undefined, b: TimelineItem[]): boolean {
  if (!a || a.length !== b.length) return false;
  for (let i = 0; i < b.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function buildItemsByTrackId(
  items: TimelineItem[],
  previous: Record<string, TimelineItem[]>
): Record<string, TimelineItem[]> {
  const grouped: Record<string, TimelineItem[]> = {};
  for (const item of items) {
    (grouped[item.trackId] ??= []).push(item);
  }

  const next: Record<string, TimelineItem[]> = {};
  for (const [trackId, trackItems] of Object.entries(grouped)) {
    const previousTrackItems = previous[trackId];
    next[trackId] = previousTrackItems && areItemArraysEqual(previousTrackItems, trackItems)
      ? previousTrackItems
      : trackItems;
  }

  return next;
}

function buildItemsByLinkedGroupId(
  items: TimelineItem[],
  previous: Record<string, TimelineItem[]>
): Record<string, TimelineItem[]> {
  const grouped: Record<string, TimelineItem[]> = {};
  for (const item of items) {
    if (item.linkedGroupId) {
      (grouped[item.linkedGroupId] ??= []).push(item);
    }
  }

  const next: Record<string, TimelineItem[]> = {};
  for (const [groupId, groupItems] of Object.entries(grouped)) {
    const previousGroupItems = previous[groupId];
    next[groupId] = previousGroupItems && areItemArraysEqual(previousGroupItems, groupItems)
      ? previousGroupItems
      : groupItems;
  }

  return next;
}

function isCaptionableClip(item: TimelineItem): item is AudioItem | VideoItem {
  return (item.type === 'audio' || item.type === 'video')
    && typeof item.mediaId === 'string'
    && item.mediaId.length > 0;
}

function isLegacyGeneratedCaptionItem(item: TimelineItem): item is TextItem {
  return item.type === 'text'
    && !item.captionSource
    && typeof item.mediaId === 'string'
    && item.mediaId.length > 0
    && item.text.trim().length > 0
    && item.label === item.text.slice(0, 48);
}

function buildReplaceableCaptionClipIds(items: TimelineItem[]): Set<string> {
  const ids = new Set<string>();
  const clipsByMediaId: Record<string, Array<AudioItem | VideoItem>> = {};

  for (const item of items) {
    if (item.type === 'text' && item.captionSource?.type === 'transcript' && item.captionSource.clipId) {
      ids.add(item.captionSource.clipId);
      continue;
    }

    if (isCaptionableClip(item)) {
      (clipsByMediaId[item.mediaId] ??= []).push(item);
    }
  }

  for (const clips of Object.values(clipsByMediaId)) {
    clips.sort((left, right) => left.from - right.from);
  }

  for (const item of items) {
    if (!isLegacyGeneratedCaptionItem(item) || !item.mediaId) {
      continue;
    }

    const itemEnd = item.from + item.durationInFrames;
    const candidateClips = clipsByMediaId[item.mediaId];
    if (!candidateClips) {
      continue;
    }

    for (const clip of candidateClips) {
      if (clip.from > item.from) {
        break;
      }

      const clipEnd = clip.from + clip.durationInFrames;
      if (item.from >= clip.from && itemEnd <= clipEnd) {
        ids.add(clip.id);
      }
    }
  }

  return ids;
}

function isMediaPair(left: TimelineItem, right: TimelineItem): boolean {
  return (left.type === 'video' && right.type === 'audio')
    || (left.type === 'audio' && right.type === 'video');
}

function isLegacyLinkCandidate(item: TimelineItem): item is AudioItem | VideoItem {
  return !item.linkedGroupId
    && isCaptionableClip(item)
    && typeof item.originId === 'string'
    && item.originId.length > 0;
}

function isLegacyLinkedPair(anchor: TimelineItem, candidate: TimelineItem): boolean {
  if (!isMediaPair(anchor, candidate)) return false;
  if (!anchor.originId || anchor.originId !== candidate.originId) return false;
  if (!anchor.mediaId || anchor.mediaId !== candidate.mediaId) return false;
  return anchor.from === candidate.from && anchor.durationInFrames === candidate.durationInFrames;
}

function buildLinkedItemsByItemId(
  items: TimelineItem[],
  itemsByLinkedGroupId: Record<string, TimelineItem[]>,
  previous: Record<string, TimelineItem[]>
): Record<string, TimelineItem[]> {
  const next: Record<string, TimelineItem[]> = {};

  for (const groupItems of Object.values(itemsByLinkedGroupId)) {
    if (groupItems.length <= 1) {
      continue;
    }

    for (const item of groupItems) {
      next[item.id] = groupItems;
    }
  }

  const legacyGroups: Record<string, TimelineItem[]> = {};
  for (const item of items) {
    if (!isLegacyLinkCandidate(item)) {
      continue;
    }

    const key = `${item.originId}|${item.mediaId}|${item.from}|${item.durationInFrames}`;
    (legacyGroups[key] ??= []).push(item);
  }

  for (const groupItems of Object.values(legacyGroups)) {
    if (groupItems.length <= 1) {
      continue;
    }

    for (const anchor of groupItems) {
      const linkedItems = groupItems.filter((candidate) =>
        candidate.id === anchor.id || isLegacyLinkedPair(anchor, candidate)
      );

      if (linkedItems.length <= 1) {
        continue;
      }

      const previousLinkedItems = previous[anchor.id];
      next[anchor.id] = previousLinkedItems && areItemArraysEqual(previousLinkedItems, linkedItems)
        ? previousLinkedItems
        : linkedItems;
    }
  }

  return next;
}

function buildItemById(
  items: TimelineItem[],
  previous: Record<string, TimelineItem>
): Record<string, TimelineItem> {
  const next: Record<string, TimelineItem> = {};
  for (const item of items) {
    const previousItem = previous[item.id];
    next[item.id] = previousItem !== undefined && previousItem === item ? previousItem : item;
  }
  return next;
}

function buildItemsMediaDependencyIds(items: TimelineItem[]): string[] {
  const mediaIds = new Set<string>();
  for (const item of items) {
    if (item.mediaId) {
      mediaIds.add(item.mediaId);
    }
  }
  return [...mediaIds].sort();
}

function buildMediaDependencyKey(mediaDependencyIds: string[]): string {
  return mediaDependencyIds.join('|');
}

function computeMaxItemEndFrame(items: TimelineItem[]): number {
  let max = 0;
  for (const item of items) {
    const end = item.from + item.durationInFrames;
    if (end > max) max = end;
  }
  return max;
}

function withItemIndexes(
  items: TimelineItem[],
  previous: Pick<ItemsState, 'itemsByTrackId' | 'itemById' | 'itemsByLinkedGroupId' | 'linkedItemsByItemId'>
): Pick<ItemsState, 'items' | 'itemsByTrackId' | 'itemById' | 'itemsByLinkedGroupId' | 'linkedItemsByItemId' | 'replaceableCaptionClipIds' | 'maxItemEndFrame'> {
  const itemsByLinkedGroupId = buildItemsByLinkedGroupId(items, previous.itemsByLinkedGroupId);
  return {
    items,
    itemsByTrackId: buildItemsByTrackId(items, previous.itemsByTrackId),
    itemById: buildItemById(items, previous.itemById),
    itemsByLinkedGroupId,
    linkedItemsByItemId: buildLinkedItemsByItemId(items, itemsByLinkedGroupId, previous.linkedItemsByItemId),
    replaceableCaptionClipIds: buildReplaceableCaptionClipIds(items),
    maxItemEndFrame: computeMaxItemEndFrame(items),
  };
}

/**
 * Get IDs of clips that have a transition with the given item.
 * These clips are allowed to overlap during trim operations.
 */
function getTransitionLinkedIds(itemId: string): Set<string> {
  const transitions = useTransitionsStore.getState().transitions;
  const linkedIds = new Set<string>();
  for (const t of transitions) {
    if (t.leftClipId === itemId) linkedIds.add(t.rightClipId);
    if (t.rightClipId === itemId) linkedIds.add(t.leftClipId);
  }
  return linkedIds;
}

function buildRippleShiftByItemId(items: TimelineItem[], deletedItems: TimelineItem[]): Map<string, number> {
  const shiftByItemId = new Map<string, number>();

  for (const item of items) {
    let shiftAmount = 0;
    for (const deletedItem of deletedItems) {
      if (deletedItem.trackId === item.trackId && deletedItem.from + deletedItem.durationInFrames <= item.from) {
        shiftAmount += deletedItem.durationInFrames;
      }
    }
    shiftByItemId.set(item.id, shiftAmount);
  }

  const visited = new Set<string>();
  for (const item of items) {
    if (visited.has(item.id)) continue;

    const linkedItems = getLinkedItems(items, item.id);
    for (const linkedItem of linkedItems) {
      visited.add(linkedItem.id);
    }

    if (linkedItems.length <= 1) continue;

    let groupShift = 0;
    for (const linkedItem of linkedItems) {
      groupShift = Math.max(groupShift, shiftByItemId.get(linkedItem.id) ?? 0);
    }

    if (groupShift <= 0) continue;

    for (const linkedItem of linkedItems) {
      shiftByItemId.set(linkedItem.id, groupShift);
    }
  }

  return shiftByItemId;
}

/**
 * Items state - timeline clips/items and tracks.
 * This is the core timeline content. Complex cross-domain operations
 * (like removeItems which cascades to transitions/keyframes) are handled
 * by timeline-actions.ts using the command system.
 */

interface ItemsState {
  items: TimelineItem[];
  itemsByTrackId: Record<string, TimelineItem[]>;
  itemById: Record<string, TimelineItem>;
  itemsByLinkedGroupId: Record<string, TimelineItem[]>;
  linkedItemsByItemId: Record<string, TimelineItem[]>;
  /** Set of clip IDs that can regenerate captions, including legacy generated captions */
  replaceableCaptionClipIds: Set<string>;
  maxItemEndFrame: number;
  mediaDependencyIds: string[];
  mediaDependencyVersion: number;
  tracks: TimelineTrack[];
}

interface ItemsActions {
  // Bulk setters for snapshot restore
  setItems: (items: TimelineItem[]) => void;
  setTracks: (tracks: TimelineTrack[]) => void;

  // Internal mutations (prefixed with _ to indicate called by command system)
  _addItem: (item: TimelineItem) => void;
  _addItems: (items: TimelineItem[]) => void;
  _updateItem: (id: string, updates: Partial<TimelineItem>) => void;
  _removeItems: (ids: string[]) => void;

  // Specialized item operations
  _rippleDeleteItems: (ids: string[]) => void;
  _closeGapAtPosition: (trackId: string, frame: number) => void;
  _moveItem: (id: string, newFrom: number, newTrackId?: string) => void;
  _moveItems: (updates: Array<{ id: string; from: number; trackId?: string }>) => void;
  _duplicateItems: (itemIds: string[], positions: Array<{ from: number; trackId: string }>) => TimelineItem[];
  _trimItemStart: (id: string, trimAmount: number, options?: { skipAdjacentClamp?: boolean }) => void;
  _trimItemEnd: (id: string, trimAmount: number, options?: { skipAdjacentClamp?: boolean }) => void;
  _splitItem: (id: string, splitFrame: number) => { leftItem: TimelineItem; rightItem: TimelineItem } | null;
  _joinItems: (itemIds: string[]) => void;
  _rateStretchItem: (id: string, newFrom: number, newDuration: number, newSpeed: number) => void;

  // Transform operations
  _updateItemTransform: (id: string, transform: Partial<TransformProperties>) => void;
  _resetItemTransform: (id: string) => void;
  _updateItemsTransform: (ids: string[], transform: Partial<TransformProperties>) => void;
  _updateItemsTransformMap: (transformsMap: Map<string, Partial<TransformProperties>>) => void;

  // Effect operations
  _addEffect: (itemId: string, effect: VisualEffect) => void;
  _addEffects: (updates: Array<{ itemId: string; effects: VisualEffect[] }>) => void;
  _updateEffect: (itemId: string, effectId: string, updates: Partial<{ effect: VisualEffect; enabled: boolean }>) => void;
  _removeEffect: (itemId: string, effectId: string) => void;
  _toggleEffect: (itemId: string, effectId: string) => void;
}

export const useItemsStore = create<ItemsState & ItemsActions>()(
  (set, get) => ({
    // State
    items: [],
    itemsByTrackId: {},
    itemById: {},
    itemsByLinkedGroupId: {},
    linkedItemsByItemId: {},
    replaceableCaptionClipIds: new Set<string>(),
    maxItemEndFrame: 0,
    mediaDependencyIds: [],
    mediaDependencyVersion: 0,
    tracks: [],

    // Bulk setters
    setItems: (items) => set((state) => {
      const normalizedItems = items.map((item) => normalizeFrameFields(item));
      return withItemIndexes(normalizedItems, state);
    }),
    setTracks: (tracks) => set({
      tracks: [...tracks].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
    }),

    // Add item
    _addItem: (item) => set((state) => {
      const nextItems = [...state.items, normalizeFrameFields(item)];
      return withItemIndexes(nextItems, state);
    }),

    // Add multiple items in one mutation
    _addItems: (items) => set((state) => {
      const nextItems = [...state.items, ...items.map((item) => normalizeFrameFields(item))];
      return withItemIndexes(nextItems, state);
    }),

    // Update item
    _updateItem: (id, updates) => {
      const normalizedUpdates = normalizeItemUpdates(updates);
      return set((state) => {
        const nextItems = state.items.map((i) =>
          i.id === id ? normalizeFrameFields({ ...i, ...normalizedUpdates } as typeof i) : i
        );
        return withItemIndexes(nextItems, state);
      });
    },

    // Remove items (simple - cascade handled by timeline-actions)
    _removeItems: (ids) => set((state) => {
      const idsSet = new Set(ids);
      const nextItems = state.items.filter((i) => !idsSet.has(i.id));
      return withItemIndexes(nextItems, state);
    }),

    // Ripple delete: remove items AND shift subsequent items to close gaps
    _rippleDeleteItems: (ids) => set((state) => {
      const idsToDelete = new Set(ids);
      const itemsToDelete = state.items.filter((i) => idsToDelete.has(i.id));

      if (itemsToDelete.length === 0) return state;

      const remainingItems = state.items.filter((i) => !idsToDelete.has(i.id));
      const shiftByItemId = buildRippleShiftByItemId(remainingItems, itemsToDelete);

      const newItems = remainingItems.map((item) => {
        const shiftAmount = shiftByItemId.get(item.id) ?? 0;
        return shiftAmount > 0
          ? normalizeFrameFields({ ...item, from: item.from - shiftAmount })
          : item;
      });

      return withItemIndexes(newItems, state);
    }),

    // Close gap at position
    _closeGapAtPosition: (trackId, frame) => set((state) => {
      const targetFrame = roundFrame(frame);
      const trackItems = state.items
        .filter((i) => i.trackId === trackId)
        .sort((a, b) => a.from - b.from);

      if (trackItems.length === 0) return state;

      let gapStart = 0;
      let gapEnd = 0;

      for (const item of trackItems) {
        if (targetFrame >= gapStart && targetFrame < item.from) {
          gapEnd = item.from;
          break;
        }
        gapStart = item.from + item.durationInFrames;
      }

      if (gapEnd <= gapStart) return state;

      const gapSize = gapEnd - gapStart;
      const newItems = state.items.map((item) => {
        if (item.trackId === trackId && item.from >= gapEnd) {
          return normalizeFrameFields({ ...item, from: item.from - gapSize });
        }
        return item;
      });

      return withItemIndexes(newItems, state);
    }),

    // Move single item
    _moveItem: (id, newFrom, newTrackId) => {
      const normalizedFrom = roundFrame(newFrom);
      return set((state) => {
        const nextItems = state.items.map((item) =>
          item.id === id
            ? normalizeFrameFields({ ...item, from: normalizedFrom, ...(newTrackId && { trackId: newTrackId }) })
            : item
        );
        return withItemIndexes(nextItems, state);
      });
    },

    // Move multiple items
    _moveItems: (updates) => set((state) => {
      const updateMap = new Map(updates.map((u) => [u.id, { ...u, from: roundFrame(u.from) }]));
      const nextItems = state.items.map((item) => {
          const update = updateMap.get(item.id);
          if (!update) return item;
          return normalizeFrameFields({
            ...item,
            from: update.from,
            ...(update.trackId && { trackId: update.trackId }),
          });
        });
      return withItemIndexes(nextItems, state);
    }),

    // Duplicate items
    _duplicateItems: (itemIds, positions) => {
      const state = get();
      const itemsMap = new Map(state.items.map((i) => [i.id, i]));
      const newItems: TimelineItem[] = [];
      const activeCompositionId = useCompositionNavigationStore.getState().activeCompositionId;
      const compositionById = useCompositionsStore.getState().compositionById;
      const linkedGroupMap = new Map<string, string>();

      for (let i = 0; i < itemIds.length; i++) {
        const original = itemsMap.get(itemIds[i]!);
        const position = positions[i]!;
        if (!original || !position) continue;
        if (
          activeCompositionId !== null
          && isCompositionWrapperItem(original)
          && wouldCreateCompositionCycle({
            parentCompositionId: activeCompositionId,
            insertedCompositionId: original.compositionId,
            compositionById,
          })
        ) {
          continue;
        }

        const duplicate = {
          ...original,
          id: crypto.randomUUID(),
          from: roundFrame(position.from),
          trackId: position.trackId,
          // Give duplicate a new originId so it forms its own group in StableVideoSequence.
          // Without this, split clips that are duplicated would be grouped with the originals,
          // causing incorrect sourceStart calculations (can result in negative values).
          originId: crypto.randomUUID(),
          linkedGroupId: original.linkedGroupId
            ? (linkedGroupMap.get(original.linkedGroupId)
              ?? linkedGroupMap.set(original.linkedGroupId, crypto.randomUUID()).get(original.linkedGroupId))
            : undefined,
        } as TimelineItem;

        newItems.push(normalizeFrameFields(duplicate));
      }

      set((state) => {
        const nextItems = [...state.items, ...newItems];
        return withItemIndexes(nextItems, state);
      });
      return newItems;
    },

    // Trim item start
    _trimItemStart: (id, trimAmount, options) => set((state) => {
      const nextItems = state.items.map((item) => {
        if (item.id !== id) return item;

        // Clamp trim amount to source boundaries and minimum duration
        const timelineFps = useTimelineSettingsStore.getState().fps;
        let { clampedAmount } = clampTrimAmount(item, 'start', trimAmount, timelineFps);
        // Clamp to adjacent items on the same track (allow overlap with transition-linked clips)
        if (!options?.skipAdjacentClamp) {
          const transitionLinkedIds = getTransitionLinkedIds(id);
          clampedAmount = clampToAdjacentItems(item, 'start', clampedAmount, state.items, transitionLinkedIds);
        }

        const newFrom = item.from + clampedAmount;
        const newDuration = item.durationInFrames - clampedAmount;

        if (newDuration <= 0) return item;

        // Calculate source boundary updates for media items
        const sourceUpdate = calculateTrimSourceUpdate(item, 'start', clampedAmount, newDuration, timelineFps);

        return {
          ...item,
          from: roundFrame(newFrom),
          durationInFrames: roundDuration(newDuration),
          ...sourceUpdate,
        } as typeof item;
      });
      return withItemIndexes(nextItems, state);
    }),

    // Trim item end
    _trimItemEnd: (id, trimAmount, options) => set((state) => {
      const nextItems = state.items.map((item) => {
        if (item.id !== id) return item;

        // Clamp trim amount to source boundaries and minimum duration
        const timelineFps = useTimelineSettingsStore.getState().fps;
        let { clampedAmount } = clampTrimAmount(item, 'end', trimAmount, timelineFps);
        // Clamp to adjacent items on the same track (allow overlap with transition-linked clips)
        if (!options?.skipAdjacentClamp) {
          const transitionLinkedIds = getTransitionLinkedIds(id);
          clampedAmount = clampToAdjacentItems(item, 'end', clampedAmount, state.items, transitionLinkedIds);
        }

        const newDuration = item.durationInFrames + clampedAmount;
        if (newDuration <= 0) return item;

        // Calculate source boundary updates for media items
        const sourceUpdate = calculateTrimSourceUpdate(item, 'end', clampedAmount, newDuration, timelineFps);

        return {
          ...item,
          durationInFrames: roundDuration(newDuration),
          ...sourceUpdate,
        } as typeof item;
      });
      return withItemIndexes(nextItems, state);
    }),

    // Split item at frame
    _splitItem: (id, splitFrame) => {
      const state = get();
      const item = state.items.find((i) => i.id === id);
      if (!item) return null;
      const splitAt = roundFrame(splitFrame);

      const itemStart = roundFrame(item.from);
      const itemDuration = roundDuration(item.durationInFrames);
      const itemEnd = itemStart + itemDuration;

      // Validate split point is within item
      if (splitAt <= itemStart || splitAt >= itemEnd) return null;

      const leftDuration = splitAt - itemStart;
      const rightDuration = itemEnd - splitAt;
      // Ensure split siblings share a stable lineage key.
      // Legacy clips may not have originId; fall back to current item ID.
      const splitOriginId = item.originId ?? item.id;

      // Create left item (keeps original ID for minimal disruption)
      const leftItem = {
        ...item,
        from: itemStart,
        originId: splitOriginId,
        durationInFrames: leftDuration,
      } as TimelineItem;

      // Create right item with new ID
      const rightItem = {
        ...item,
        id: crypto.randomUUID(),
        originId: splitOriginId,
        from: splitAt,
        durationInFrames: rightDuration,
      } as TimelineItem;

      // Handle sourceStart/sourceEnd for media items (accounting for speed)
      if (isMediaItem(item)) {
        const timelineFps = useTimelineSettingsStore.getState().fps;
        const { sourceStart, speed, sourceFps } = getSourceProperties(item);
        const effectiveSourceFps = sourceFps ?? timelineFps;
        const boundaries = calculateSplitSourceBoundaries(
          sourceStart,
          leftDuration,
          rightDuration,
          speed,
          timelineFps,
          effectiveSourceFps
        );

        // Explicitly set sourceStart on left item so it has full explicit bounds.
        // Without this, the left item inherits undefined sourceStart from the original,
        // breaking hasExplicitSourceBounds detection in _rateStretchItem and causing
        // rate stretch to use the wrong source duration (full media instead of clip portion).
        (leftItem as typeof item).sourceStart = sourceStart;
        (leftItem as typeof item).sourceEnd = boundaries.left.sourceEnd;
        (rightItem as typeof item).sourceStart = boundaries.right.sourceStart;
        (rightItem as typeof item).sourceEnd = boundaries.right.sourceEnd;

        getLog().debug(`_splitItem: Original sourceStart:${sourceStart} speed:${speed} leftDuration:${leftDuration} rightDuration:${rightDuration}`);
        getLog().debug(`_splitItem: boundaries.right.sourceStart:${boundaries.right.sourceStart} rightItem.sourceStart:${(rightItem as typeof item).sourceStart}`);
      }

      set((state) => {
        const nextItems = state.items
          .map((i) => (i.id === id ? normalizeFrameFields(leftItem) : i))
          .concat(normalizeFrameFields(rightItem));
        return withItemIndexes(nextItems, state);
      });

      return { leftItem: normalizeFrameFields(leftItem), rightItem: normalizeFrameFields(rightItem) };
    },

    // Join items
    _joinItems: (itemIds) => set((state) => {
      if (itemIds.length < 2) return state;

      const itemsToJoin = state.items
        .filter((i) => itemIds.includes(i.id))
        .sort((a, b) => a.from - b.from);

      if (itemsToJoin.length < 2) return state;

      // All items must be same type and track
      const firstItem = itemsToJoin[0]!;
      const lastItem = itemsToJoin[itemsToJoin.length - 1]!;
      const allSameType = itemsToJoin.every((i) => i.type === firstItem.type);
      const allSameTrack = itemsToJoin.every((i) => i.trackId === firstItem.trackId);

      if (!allSameType || !allSameTrack) return state;

      // Calculate total duration
      const totalDuration = lastItem.from + lastItem.durationInFrames - firstItem.from;

      // Create joined item (using first item as base, but take source/trim end bounds from last item)
      // This is the inverse of split: first item provides start bounds, last item provides end bounds
      const joinedItem = {
        ...firstItem,
        from: roundFrame(firstItem.from),
        durationInFrames: roundDuration(totalDuration),
        // Take sourceEnd and trimEnd from the last item to maintain source continuity
        sourceEnd: lastItem.sourceEnd,
        trimEnd: lastItem.trimEnd,
      } as TimelineItem;

      // Remove all but first (by timeline position), update first
      const idsToRemove = new Set(itemsToJoin.slice(1).map((i) => i.id));
      const nextItems = state.items
        .filter((i) => !idsToRemove.has(i.id))
        .map((i) => (i.id === firstItem.id ? normalizeFrameFields(joinedItem) : i));
      return withItemIndexes(nextItems, state);
    }),

    // Rate stretch item (video, audio, or GIF)
    _rateStretchItem: (id, newFrom, newDuration, newSpeed) => set((state) => {
      const nextItems = state.items.map((item) => {
        if (item.id !== id) return item;
        // Allow video, audio, compositions, and GIF images (detected by .gif extension)
        const isGif = item.type === 'image' && item.label?.toLowerCase().endsWith('.gif');
        if (item.type !== 'video' && item.type !== 'audio' && item.type !== 'composition' && !isGif) return item;

        // For clips with explicit source bounds (split clips and trimmed segments),
        // preserve sourceStart/sourceEnd exactly and only retime via speed+duration.
        // Recomputing sourceEnd here causes destructive source-span drift over repeated
        // rate-stretch operations.
        const hasExplicitSourceBounds =
          (item.type === 'video' || item.type === 'audio' || item.type === 'composition') &&
          item.sourceEnd !== undefined;

        const sourceStart = item.sourceStart ?? 0;
        const timelineFps = useTimelineSettingsStore.getState().fps;
        const sourceFps = item.sourceFps ?? timelineFps;
        const finalDuration = roundDuration(newDuration);
        let finalSpeed = newSpeed;

        if (hasExplicitSourceBounds) {
          // Explicit bounds mean the source span is fixed; derive speed from that span.
          const fixedSourceSpan = Math.max(1, (item.sourceEnd ?? sourceStart) - sourceStart);
          finalSpeed = clampSpeed(calculateSpeed(fixedSourceSpan, finalDuration, sourceFps, timelineFps));
        }

        // Recalculate sourceEnd only when bounds are not explicitly defined.
        const sourceFramesNeeded = timelineToSourceFrames(finalDuration, finalSpeed, timelineFps, sourceFps);
        const newSourceEnd = sourceStart + sourceFramesNeeded;
        const clampedSourceEnd = item.sourceDuration
          ? Math.min(newSourceEnd, item.sourceDuration)
          : newSourceEnd;

        const updatedItem = {
          ...item,
          from: roundFrame(newFrom),
          durationInFrames: finalDuration,
          speed: finalSpeed,
        } as typeof item;

        if (!hasExplicitSourceBounds) {
          updatedItem.sourceEnd = roundFrame(clampedSourceEnd);
        }

        return updatedItem;
      });
      return withItemIndexes(nextItems, state);
    }),

    // Update item transform
    _updateItemTransform: (id, transform) => set((state) => {
      const nextItems = state.items.map((item) => {
        if (item.id !== id) return item;
        if (!('transform' in item)) return item;

        return {
          ...item,
          transform: { ...item.transform, ...transform },
        } as typeof item;
      });
      return withItemIndexes(nextItems, state);
    }),

    // Reset item transform
    // Note: opacity is intentionally omitted - undefined means "use default (1.0)"
    _resetItemTransform: (id) => set((state) => {
      const nextItems = state.items.map((item) => {
        if (item.id !== id) return item;
        if (!('transform' in item)) return item;

        const updatedItem = {
          ...item,
          transform: {
            x: 0,
            y: 0,
            scale: 1,
            rotation: 0,
            // opacity intentionally not set - defaults to 1.0
          },
        };
        return updatedItem as TimelineItem;
      });
      return withItemIndexes(nextItems, state);
    }),

    // Update multiple items' transforms
    _updateItemsTransform: (ids, transform) => set((state) => {
      const idsSet = new Set(ids);
      const nextItems = state.items.map((item) => {
          if (!idsSet.has(item.id)) return item;
          if (!('transform' in item)) return item;

          return {
            ...item,
            transform: { ...item.transform, ...transform },
          } as typeof item;
        });
      return withItemIndexes(nextItems, state);
    }),

    // Update transforms from map
    _updateItemsTransformMap: (transformsMap) => set((state) => {
      const nextItems = state.items.map((item) => {
        const transform = transformsMap.get(item.id);
        if (!transform) return item;
        if (!('transform' in item)) return item;

        return {
          ...item,
          transform: { ...item.transform, ...transform },
        } as typeof item;
      });
      return withItemIndexes(nextItems, state);
    }),

    // Add effect to item
    _addEffect: (itemId, effect) => set((state) => {
      const nextItems = state.items.map((item) => {
        if (item.id !== itemId) return item;
        // Audio items don't support visual effects
        if (item.type === 'audio') return item;

        const effects = item.effects || [];
        const newEffect: ItemEffect = {
          id: crypto.randomUUID(),
          effect,
          enabled: true,
        };

        return {
          ...item,
          effects: [...effects, newEffect],
        } as typeof item;
      });
      return withItemIndexes(nextItems, state);
    }),

    // Add effects to multiple items
    _addEffects: (updates) => set((state) => {
      const updateMap = new Map(updates.map((u) => [u.itemId, u.effects]));

      const nextItems = state.items.map((item) => {
          const effectsToAdd = updateMap.get(item.id);
          if (!effectsToAdd) return item;
          // Audio items don't support visual effects
          if (item.type === 'audio') return item;

          const currentEffects = item.effects || [];
          const newEffects: ItemEffect[] = effectsToAdd.map((effect) => ({
            id: crypto.randomUUID(),
            effect,
            enabled: true,
          }));

          return {
            ...item,
            effects: [...currentEffects, ...newEffects],
          } as typeof item;
        });
      return withItemIndexes(nextItems, state);
    }),

    // Update effect
    _updateEffect: (itemId, effectId, updates) => set((state) => {
      const nextItems = state.items.map((item) => {
        if (item.id !== itemId) return item;
        // Audio items don't support visual effects
        if (item.type === 'audio') return item;

        const effects = item.effects || [];
        return {
          ...item,
          effects: effects.map((e) =>
            e.id === effectId
              ? {
                  ...e,
                  ...(updates.effect && { effect: updates.effect }),
                  ...(updates.enabled !== undefined && { enabled: updates.enabled }),
                }
              : e
          ),
        } as typeof item;
      });
      return withItemIndexes(nextItems, state);
    }),

    // Remove effect
    _removeEffect: (itemId, effectId) => set((state) => {
      const nextItems = state.items.map((item) => {
        if (item.id !== itemId) return item;
        // Audio items don't support visual effects
        if (item.type === 'audio') return item;

        const effects = item.effects || [];
        return {
          ...item,
          effects: effects.filter((e) => e.id !== effectId),
        } as typeof item;
      });
      return withItemIndexes(nextItems, state);
    }),

    // Toggle effect
    _toggleEffect: (itemId, effectId) => set((state) => {
      const nextItems = state.items.map((item) => {
        if (item.id !== itemId) return item;
        // Audio items don't support visual effects
        if (item.type === 'audio') return item;

        const effects = item.effects || [];
        return {
          ...item,
          effects: effects.map((e) =>
            e.id === effectId ? { ...e, enabled: !e.enabled } : e
          ),
        } as typeof item;
      });
      return withItemIndexes(nextItems, state);
    }),
  })
);

let prevItemsRef = useItemsStore.getState().items;
let prevItemsMediaDependencyIds = useItemsStore.getState().mediaDependencyIds;
let prevItemsMediaDependencyKey = buildMediaDependencyKey(prevItemsMediaDependencyIds);
useItemsStore.subscribe((state) => {
  if (state.items === prevItemsRef) {
    return;
  }
  prevItemsRef = state.items;
  const nextMediaDependencyIds = buildItemsMediaDependencyIds(state.items);
  const nextMediaDependencyKey = buildMediaDependencyKey(nextMediaDependencyIds);
  if (nextMediaDependencyKey === prevItemsMediaDependencyKey) {
    return;
  }
  prevItemsMediaDependencyIds = nextMediaDependencyIds;
  prevItemsMediaDependencyKey = nextMediaDependencyKey;
  useItemsStore.setState({
    mediaDependencyIds: prevItemsMediaDependencyIds,
    mediaDependencyVersion: state.mediaDependencyVersion + 1,
  });
});

function syncInOutPointsToTimelineBounds(items: TimelineItem[], fps: number) {
  const markersState = useMarkersStore.getState();
  const sanitizedInOutPoints = sanitizeInOutPoints({
    inPoint: markersState.inPoint,
    outPoint: markersState.outPoint,
    maxFrame: getEffectiveTimelineMaxFrame(items, fps),
  });

  if (
    sanitizedInOutPoints.inPoint === markersState.inPoint
    && sanitizedInOutPoints.outPoint === markersState.outPoint
  ) {
    return;
  }

  useMarkersStore.setState({
    inPoint: sanitizedInOutPoints.inPoint,
    outPoint: sanitizedInOutPoints.outPoint,
  });
}

let prevMaxItemEndFrame = useItemsStore.getState().maxItemEndFrame;
useItemsStore.subscribe((state) => {
  if (state.maxItemEndFrame === prevMaxItemEndFrame) {
    return;
  }

  prevMaxItemEndFrame = state.maxItemEndFrame;
  syncInOutPointsToTimelineBounds(state.items, useTimelineSettingsStore.getState().fps);
});

useTimelineSettingsStore.subscribe((state, prevState) => {
  if (state.fps === prevState.fps) {
    return;
  }

  syncInOutPointsToTimelineBounds(useItemsStore.getState().items, state.fps);
});
