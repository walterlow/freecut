import type { TimelineItem } from '@/types/timeline';
import { useItemsStore } from '../items-store';
import { useTransitionsStore } from '../transitions-store';
import { useKeyframesStore } from '../keyframes-store';
import { useTimelineSettingsStore } from '../timeline-settings-store';
import { useCompositionsStore } from '../compositions-store';
import { useCompositionNavigationStore } from '../composition-navigation-store';
import { useSelectionStore } from '@/shared/state/selection';
import {
  applyTransitionRepairs,
  execute,
  getCurrentTimelineSnapshot,
  getEffectiveCompositions,
  getRootTimelineSnapshot,
  type TimelineSnapshotLike,
} from './shared';

export interface MediaDeletionImpact {
  itemIds: string[];
  rootReferenceCount: number;
  nestedReferenceCount: number;
  totalReferenceCount: number;
}

function isMediaReferenceItem(item: TimelineItem, mediaIds: ReadonlySet<string>): boolean {
  return !!item.mediaId && mediaIds.has(item.mediaId);
}

function countMediaReferenceItems(items: TimelineItem[], mediaIds: ReadonlySet<string>): number {
  return items.filter((item) => isMediaReferenceItem(item, mediaIds)).length;
}

function collectMediaReferenceItemIds(items: TimelineItem[], mediaIds: ReadonlySet<string>): string[] {
  return items
    .filter((item) => isMediaReferenceItem(item, mediaIds))
    .map((item) => item.id);
}

function sanitizeSnapshotByItemIds<TSnapshot extends TimelineSnapshotLike>(
  snapshot: TSnapshot,
  targetIds: ReadonlySet<string>,
): TSnapshot & { removedItemIds: string[] } {
  const removedItemIds = snapshot.items
    .filter((item) => targetIds.has(item.id))
    .map((item) => item.id);

  if (removedItemIds.length === 0) {
    return {
      ...snapshot,
      removedItemIds,
    };
  }

  const removedIdSet = new Set(removedItemIds);
  return {
    ...snapshot,
    items: snapshot.items.filter((item) => !removedIdSet.has(item.id)),
    transitions: snapshot.transitions.filter((transition) => (
      !removedIdSet.has(transition.leftClipId) && !removedIdSet.has(transition.rightClipId)
    )),
    keyframes: snapshot.keyframes.filter((keyframe) => !removedIdSet.has(keyframe.itemId)),
    removedItemIds,
  };
}

function applyItemUpdates(items: TimelineItem[], itemId: string, updates: Partial<TimelineItem>): {
  items: TimelineItem[];
  changed: boolean;
} {
  let changed = false;
  const nextItems = items.map((item) => {
    if (item.id !== itemId) {
      return item;
    }

    changed = true;
    return {
      ...item,
      ...updates,
    } as TimelineItem;
  });

  return {
    items: changed ? nextItems : items,
    changed,
  };
}

export function getMediaDeletionImpact(mediaIds: string[]): MediaDeletionImpact {
  const targetMediaIds = new Set(mediaIds.filter(Boolean));
  if (targetMediaIds.size === 0) {
    return {
      itemIds: [],
      rootReferenceCount: 0,
      nestedReferenceCount: 0,
      totalReferenceCount: 0,
    };
  }

  const currentSnapshot = getCurrentTimelineSnapshot();
  const rootSnapshot = getRootTimelineSnapshot(currentSnapshot);
  const rootItemIds = collectMediaReferenceItemIds(rootSnapshot.items, targetMediaIds);
  const nestedItemIds = getEffectiveCompositions(currentSnapshot)
    .flatMap((composition) => collectMediaReferenceItemIds(composition.items, targetMediaIds));
  const itemIds = Array.from(new Set([...rootItemIds, ...nestedItemIds]));

  return {
    itemIds,
    rootReferenceCount: countMediaReferenceItems(rootSnapshot.items, targetMediaIds),
    nestedReferenceCount: getEffectiveCompositions(currentSnapshot)
      .reduce((count, composition) => count + countMediaReferenceItems(composition.items, targetMediaIds), 0),
    totalReferenceCount: itemIds.length,
  };
}

export function removeProjectItems(itemIds: string[]): boolean {
  const targetIds = Array.from(new Set(itemIds.filter(Boolean)));
  if (targetIds.length === 0) return false;

  return execute('REMOVE_PROJECT_ITEMS', () => {
    const targetIdSet = new Set(targetIds);
    const currentSnapshot = getCurrentTimelineSnapshot();
    const sanitizedCurrent = sanitizeSnapshotByItemIds(currentSnapshot, targetIdSet);
    let removedAny = sanitizedCurrent.removedItemIds.length > 0;

    if (sanitizedCurrent.removedItemIds.length > 0) {
      useItemsStore.getState().setItems(sanitizedCurrent.items);
      useTransitionsStore.getState().setTransitions(sanitizedCurrent.transitions);
      useKeyframesStore.getState().setKeyframes(sanitizedCurrent.keyframes);
    }

    const activeCompositionId = useCompositionNavigationStore.getState().activeCompositionId;
    const nextCompositions = useCompositionsStore.getState().compositions.map((composition) => {
      if (composition.id === activeCompositionId && sanitizedCurrent.removedItemIds.length > 0) {
        return {
          ...composition,
          items: sanitizedCurrent.items,
          tracks: sanitizedCurrent.tracks,
          transitions: sanitizedCurrent.transitions,
          keyframes: sanitizedCurrent.keyframes,
        };
      }

      const baseSnapshot: TimelineSnapshotLike = composition.id === activeCompositionId
        ? {
          items: sanitizedCurrent.items,
          tracks: sanitizedCurrent.tracks,
          transitions: sanitizedCurrent.transitions,
          keyframes: sanitizedCurrent.keyframes,
        }
        : {
          items: composition.items,
          tracks: composition.tracks,
          transitions: composition.transitions,
          keyframes: composition.keyframes,
        };

      const sanitizedComposition = sanitizeSnapshotByItemIds(baseSnapshot, targetIdSet);
      if (sanitizedComposition.removedItemIds.length > 0) {
        removedAny = true;
      }

      return sanitizedComposition.removedItemIds.length === 0
        ? composition
        : {
          ...composition,
          items: sanitizedComposition.items,
          tracks: sanitizedComposition.tracks,
          transitions: sanitizedComposition.transitions,
          keyframes: sanitizedComposition.keyframes,
        };
    });

    const latestNavState = useCompositionNavigationStore.getState();
    const nextStashStack = latestNavState.stashStack.map((stash) => {
      const sanitizedStash = sanitizeSnapshotByItemIds(stash, targetIdSet);
      if (sanitizedStash.removedItemIds.length > 0) {
        removedAny = true;
      }

      return sanitizedStash.removedItemIds.length === 0
        ? stash
        : {
          ...stash,
          items: sanitizedStash.items,
          transitions: sanitizedStash.transitions,
          keyframes: sanitizedStash.keyframes,
        };
    });

    if (removedAny) {
      useCompositionsStore.getState().setCompositions(nextCompositions);
      useCompositionNavigationStore.setState((state) => ({
        ...state,
        stashStack: nextStashStack,
      }));
      useSelectionStore.getState().clearSelection();
      useTimelineSettingsStore.getState().markDirty();
    }

    return removedAny;
  }, { itemIds: targetIds });
}

export function updateProjectItem(itemId: string, updates: Partial<TimelineItem>): boolean {
  if (!itemId) return false;

  return execute('UPDATE_PROJECT_ITEM', () => {
    const currentSnapshot = getCurrentTimelineSnapshot();
    const updatedCurrent = applyItemUpdates(currentSnapshot.items, itemId, updates);
    let changed = updatedCurrent.changed;

    if (updatedCurrent.changed) {
      useItemsStore.getState().setItems(updatedCurrent.items);
    }

    const activeCompositionId = useCompositionNavigationStore.getState().activeCompositionId;
    const nextCompositions = useCompositionsStore.getState().compositions.map((composition) => {
      if (composition.id === activeCompositionId && updatedCurrent.changed) {
        return {
          ...composition,
          items: updatedCurrent.items,
        };
      }

      const sourceItems = composition.id === activeCompositionId ? updatedCurrent.items : composition.items;
      const nextItems = applyItemUpdates(sourceItems, itemId, updates);
      if (nextItems.changed) {
        changed = true;
      }

      return nextItems.changed
        ? {
          ...composition,
          items: nextItems.items,
        }
        : composition;
    });

    const nextStashStack = useCompositionNavigationStore.getState().stashStack.map((stash) => {
      const nextItems = applyItemUpdates(stash.items, itemId, updates);
      if (nextItems.changed) {
        changed = true;
      }

      return nextItems.changed
        ? {
          ...stash,
          items: nextItems.items,
        }
        : stash;
    });

    if (!changed) {
      return false;
    }

    useCompositionsStore.getState().setCompositions(nextCompositions);
    useCompositionNavigationStore.setState((state) => ({
      ...state,
      stashStack: nextStashStack,
    }));

    const positionChanged = 'from' in updates || 'durationInFrames' in updates || 'trackId' in updates;
    if (positionChanged && updatedCurrent.changed) {
      applyTransitionRepairs([itemId]);
    }

    useTimelineSettingsStore.getState().markDirty();
    return true;
  }, { itemId, updates });
}
