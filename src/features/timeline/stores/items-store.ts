import { create } from 'zustand';
import { createLogger } from '@/lib/logger';
import type { TimelineItem, TimelineTrack } from '@/types/timeline';
import type { TransformProperties } from '@/types/transform';
import type { VisualEffect, ItemEffect } from '@/types/effects';
import { clampTrimAmount, calculateTrimSourceUpdate } from '../utils/trim-utils';
import { getSourceProperties, isMediaItem, calculateSplitSourceBoundaries } from '../utils/source-calculations';

const log = createLogger('ItemsStore');

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

function normalizeFrameFields<T extends TimelineItem>(item: T): T {
  return {
    ...item,
    from: roundFrame(item.from),
    durationInFrames: roundDuration(item.durationInFrames),
    trimStart: roundOptionalFrame(item.trimStart),
    trimEnd: roundOptionalFrame(item.trimEnd),
    sourceStart: roundOptionalFrame(item.sourceStart),
    sourceEnd: roundOptionalFrame(item.sourceEnd),
    sourceDuration: roundOptionalFrame(item.sourceDuration),
  };
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

  return normalized;
}

/**
 * Items state - timeline clips/items and tracks.
 * This is the core timeline content. Complex cross-domain operations
 * (like removeItems which cascades to transitions/keyframes) are handled
 * by timeline-actions.ts using the command system.
 */

interface ItemsState {
  items: TimelineItem[];
  tracks: TimelineTrack[];
}

interface ItemsActions {
  // Bulk setters for snapshot restore
  setItems: (items: TimelineItem[]) => void;
  setTracks: (tracks: TimelineTrack[]) => void;

  // Internal mutations (prefixed with _ to indicate called by command system)
  _addItem: (item: TimelineItem) => void;
  _updateItem: (id: string, updates: Partial<TimelineItem>) => void;
  _removeItems: (ids: string[]) => void;

  // Specialized item operations
  _rippleDeleteItems: (ids: string[]) => void;
  _closeGapAtPosition: (trackId: string, frame: number) => void;
  _moveItem: (id: string, newFrom: number, newTrackId?: string) => void;
  _moveItems: (updates: Array<{ id: string; from: number; trackId?: string }>) => void;
  _duplicateItems: (itemIds: string[], positions: Array<{ from: number; trackId: string }>) => TimelineItem[];
  _trimItemStart: (id: string, trimAmount: number) => void;
  _trimItemEnd: (id: string, trimAmount: number) => void;
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
    tracks: [],

    // Bulk setters
    setItems: (items) => set({ items: items.map((item) => normalizeFrameFields(item)) }),
    setTracks: (tracks) => set({
      tracks: [...tracks].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
    }),

    // Add item
    _addItem: (item) => set((state) => ({
      items: [...state.items, normalizeFrameFields(item)],
    })),

    // Update item
    _updateItem: (id, updates) => {
      const normalizedUpdates = normalizeItemUpdates(updates);
      return set((state) => ({
      items: state.items.map((i) =>
        i.id === id ? normalizeFrameFields({ ...i, ...normalizedUpdates } as typeof i) : i
      ),
      }));
    },

    // Remove items (simple - cascade handled by timeline-actions)
    _removeItems: (ids) => set((state) => {
      const idsSet = new Set(ids);
      return {
        items: state.items.filter((i) => !idsSet.has(i.id)),
      };
    }),

    // Ripple delete: remove items AND shift subsequent items to close gaps
    _rippleDeleteItems: (ids) => set((state) => {
      const idsToDelete = new Set(ids);
      const itemsToDelete = state.items.filter((i) => idsToDelete.has(i.id));

      if (itemsToDelete.length === 0) return state;

      const newItems = state.items
        .filter((i) => !idsToDelete.has(i.id))
        .map((item) => {
          const shiftAmount = itemsToDelete
            .filter((d) => d.trackId === item.trackId && d.from + d.durationInFrames <= item.from)
            .reduce((sum, d) => sum + d.durationInFrames, 0);

          return shiftAmount > 0 ? { ...item, from: item.from - shiftAmount } : item;
        });

      return { items: newItems };
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

      return { items: newItems };
    }),

    // Move single item
    _moveItem: (id, newFrom, newTrackId) => {
      const normalizedFrom = roundFrame(newFrom);
      return set((state) => ({
      items: state.items.map((item) =>
        item.id === id
          ? normalizeFrameFields({ ...item, from: normalizedFrom, ...(newTrackId && { trackId: newTrackId }) })
          : item
      ),
      }));
    },

    // Move multiple items
    _moveItems: (updates) => set((state) => {
      const updateMap = new Map(updates.map((u) => [u.id, { ...u, from: roundFrame(u.from) }]));
      return {
        items: state.items.map((item) => {
          const update = updateMap.get(item.id);
          if (!update) return item;
          return normalizeFrameFields({
            ...item,
            from: update.from,
            ...(update.trackId && { trackId: update.trackId }),
          });
        }),
      };
    }),

    // Duplicate items
    _duplicateItems: (itemIds, positions) => {
      const state = get();
      const itemsMap = new Map(state.items.map((i) => [i.id, i]));
      const newItems: TimelineItem[] = [];

      for (let i = 0; i < itemIds.length; i++) {
        const original = itemsMap.get(itemIds[i]!);
        const position = positions[i]!;
        if (!original || !position) continue;

        const duplicate = {
          ...original,
          id: crypto.randomUUID(),
          from: roundFrame(position.from),
          trackId: position.trackId,
          // Give duplicate a new originId so it forms its own group in StableVideoSequence.
          // Without this, split clips that are duplicated would be grouped with the originals,
          // causing incorrect sourceStart calculations (can result in negative values).
          originId: crypto.randomUUID(),
        } as TimelineItem;

        newItems.push(normalizeFrameFields(duplicate));
      }

      set((state) => ({ items: [...state.items, ...newItems] }));
      return newItems;
    },

    // Trim item start
    _trimItemStart: (id, trimAmount) => set((state) => ({
      items: state.items.map((item) => {
        if (item.id !== id) return item;

        // Clamp trim amount to source boundaries and minimum duration
        const { clampedAmount } = clampTrimAmount(item, 'start', trimAmount);

        const newFrom = item.from + clampedAmount;
        const newDuration = item.durationInFrames - clampedAmount;

        if (newDuration <= 0) return item;

        // Calculate source boundary updates for media items
        const sourceUpdate = calculateTrimSourceUpdate(item, 'start', clampedAmount, newDuration);

        return {
          ...item,
          from: roundFrame(newFrom),
          durationInFrames: roundDuration(newDuration),
          ...sourceUpdate,
        } as typeof item;
      }),
    })),

    // Trim item end
    _trimItemEnd: (id, trimAmount) => set((state) => ({
      items: state.items.map((item) => {
        if (item.id !== id) return item;

        // Clamp trim amount to source boundaries and minimum duration
        const { clampedAmount } = clampTrimAmount(item, 'end', trimAmount);

        const newDuration = item.durationInFrames + clampedAmount;
        if (newDuration <= 0) return item;

        // Calculate source boundary updates for media items
        const sourceUpdate = calculateTrimSourceUpdate(item, 'end', clampedAmount, newDuration);

        return {
          ...item,
          durationInFrames: roundDuration(newDuration),
          ...sourceUpdate,
        } as typeof item;
      }),
    })),

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
        const { sourceStart, speed } = getSourceProperties(item);
        const boundaries = calculateSplitSourceBoundaries(sourceStart, leftDuration, rightDuration, speed);

        (leftItem as typeof item).sourceEnd = boundaries.left.sourceEnd;
        (rightItem as typeof item).sourceStart = boundaries.right.sourceStart;
        (rightItem as typeof item).sourceEnd = boundaries.right.sourceEnd;

        log.debug(`_splitItem: Original sourceStart:${sourceStart} speed:${speed} leftDuration:${leftDuration} rightDuration:${rightDuration}`);
        log.debug(`_splitItem: boundaries.right.sourceStart:${boundaries.right.sourceStart} rightItem.sourceStart:${(rightItem as typeof item).sourceStart}`);
      }

      set((state) => ({
        items: state.items
          .map((i) => (i.id === id ? normalizeFrameFields(leftItem) : i))
          .concat(normalizeFrameFields(rightItem)),
      }));

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
      return {
        items: state.items
          .filter((i) => !idsToRemove.has(i.id))
          .map((i) => (i.id === firstItem.id ? normalizeFrameFields(joinedItem) : i)),
      };
    }),

    // Rate stretch item (video, audio, or GIF)
    _rateStretchItem: (id, newFrom, newDuration, newSpeed) => set((state) => ({
      items: state.items.map((item) => {
        if (item.id !== id) return item;
        // Allow video, audio, and GIF images (detected by .gif extension)
        const isGif = item.type === 'image' && item.label?.toLowerCase().endsWith('.gif');
        if (item.type !== 'video' && item.type !== 'audio' && !isGif) return item;

        // Recalculate sourceEnd based on new duration and speed
        // This keeps sourceEnd in sync with the current playback state
        const sourceStart = item.sourceStart ?? 0;
        const newSourceEnd = sourceStart + Math.round(newDuration * newSpeed);
        const clampedSourceEnd = item.sourceDuration
          ? Math.min(newSourceEnd, item.sourceDuration)
          : newSourceEnd;

        return {
          ...item,
          from: roundFrame(newFrom),
          durationInFrames: roundDuration(newDuration),
          speed: newSpeed,
          sourceEnd: roundFrame(clampedSourceEnd),
        } as typeof item;
      }),
    })),

    // Update item transform
    _updateItemTransform: (id, transform) => set((state) => ({
      items: state.items.map((item) => {
        if (item.id !== id) return item;
        if (!('transform' in item)) return item;

        return {
          ...item,
          transform: { ...item.transform, ...transform },
        } as typeof item;
      }),
    })),

    // Reset item transform
    // Note: opacity is intentionally omitted - undefined means "use default (1.0)"
    _resetItemTransform: (id) => set((state) => ({
      items: state.items.map((item) => {
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
      }),
    })),

    // Update multiple items' transforms
    _updateItemsTransform: (ids, transform) => set((state) => {
      const idsSet = new Set(ids);
      return {
        items: state.items.map((item) => {
          if (!idsSet.has(item.id)) return item;
          if (!('transform' in item)) return item;

          return {
            ...item,
            transform: { ...item.transform, ...transform },
          } as typeof item;
        }),
      };
    }),

    // Update transforms from map
    _updateItemsTransformMap: (transformsMap) => set((state) => ({
      items: state.items.map((item) => {
        const transform = transformsMap.get(item.id);
        if (!transform) return item;
        if (!('transform' in item)) return item;

        return {
          ...item,
          transform: { ...item.transform, ...transform },
        } as typeof item;
      }),
    })),

    // Add effect to item
    _addEffect: (itemId, effect) => set((state) => ({
      items: state.items.map((item) => {
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
      }),
    })),

    // Add effects to multiple items
    _addEffects: (updates) => set((state) => {
      const updateMap = new Map(updates.map((u) => [u.itemId, u.effects]));

      return {
        items: state.items.map((item) => {
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
        }),
      };
    }),

    // Update effect
    _updateEffect: (itemId, effectId, updates) => set((state) => ({
      items: state.items.map((item) => {
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
      }),
    })),

    // Remove effect
    _removeEffect: (itemId, effectId) => set((state) => ({
      items: state.items.map((item) => {
        if (item.id !== itemId) return item;
        // Audio items don't support visual effects
        if (item.type === 'audio') return item;

        const effects = item.effects || [];
        return {
          ...item,
          effects: effects.filter((e) => e.id !== effectId),
        } as typeof item;
      }),
    })),

    // Toggle effect
    _toggleEffect: (itemId, effectId) => set((state) => ({
      items: state.items.map((item) => {
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
      }),
    })),
  })
);
