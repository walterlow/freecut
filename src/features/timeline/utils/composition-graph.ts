import type { AudioItem, CompositionItem, TimelineItem, TimelineTrack } from '@/types/timeline';
import type { SubComposition } from '../stores/compositions-store';

export type CompositionByIdLookup = Record<string, SubComposition>;

export function isCompositionWrapperItem(
  item: TimelineItem
): item is CompositionItem | (AudioItem & { compositionId: string }) {
  return !!item.compositionId && (item.type === 'composition' || item.type === 'audio');
}

export function getDirectReferencedCompositionIds(items: TimelineItem[]): string[] {
  const compositionIds = new Set<string>();
  for (const item of items) {
    if (isCompositionWrapperItem(item)) {
      compositionIds.add(item.compositionId);
    }
  }
  return [...compositionIds];
}

export function compositionReferencesComposition(
  compositionId: string,
  targetCompositionId: string,
  compositionById: CompositionByIdLookup,
  visited: Set<string> = new Set()
): boolean {
  if (compositionId === targetCompositionId) {
    return true;
  }
  if (visited.has(compositionId)) {
    return false;
  }
  visited.add(compositionId);

  const composition = compositionById[compositionId];
  if (!composition) {
    return false;
  }

  for (const referencedId of getDirectReferencedCompositionIds(composition.items)) {
    if (referencedId === targetCompositionId) {
      return true;
    }
    if (compositionReferencesComposition(referencedId, targetCompositionId, compositionById, visited)) {
      return true;
    }
  }

  return false;
}

export function wouldCreateCompositionCycle(params: {
  parentCompositionId: string | null;
  insertedCompositionId: string;
  compositionById: CompositionByIdLookup;
}): boolean {
  const { parentCompositionId, insertedCompositionId, compositionById } = params;
  if (!parentCompositionId) {
    return false;
  }
  return compositionReferencesComposition(insertedCompositionId, parentCompositionId, compositionById);
}

export function collectReachableCompositionIdsFromItems(
  items: TimelineItem[],
  compositionById: CompositionByIdLookup,
  visited: Set<string> = new Set()
): string[] {
  const reachableIds: string[] = [];

  for (const compositionId of getDirectReferencedCompositionIds(items)) {
    if (visited.has(compositionId)) {
      continue;
    }
    visited.add(compositionId);
    reachableIds.push(compositionId);

    const composition = compositionById[compositionId];
    if (!composition) {
      continue;
    }

    reachableIds.push(...collectReachableCompositionIdsFromItems(composition.items, compositionById, visited));
  }

  return reachableIds;
}

export function collectReachableCompositionIdsFromTracks(
  tracks: TimelineTrack[],
  compositionById: CompositionByIdLookup
): string[] {
  const items = tracks.flatMap((track) => track.items ?? []);
  return collectReachableCompositionIdsFromItems(items, compositionById);
}
