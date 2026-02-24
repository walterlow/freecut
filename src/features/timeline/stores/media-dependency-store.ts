import { create } from 'zustand';
import { useCompositionsStore } from './compositions-store';
import { useItemsStore } from './items-store';

interface MediaDependencyState {
  mediaIds: string[];
  mediaDependencyVersion: number;
}

function areStringArraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function mergeSortedUnique(left: string[], right: string[]): string[] {
  const merged: string[] = [];
  let i = 0;
  let j = 0;

  while (i < left.length && j < right.length) {
    const a = left[i]!;
    const b = right[j]!;
    if (a === b) {
      merged.push(a);
      i += 1;
      j += 1;
      continue;
    }
    if (a < b) {
      merged.push(a);
      i += 1;
      continue;
    }
    merged.push(b);
    j += 1;
  }

  while (i < left.length) {
    merged.push(left[i]!);
    i += 1;
  }

  while (j < right.length) {
    merged.push(right[j]!);
    j += 1;
  }

  return merged;
}

function buildCombinedMediaIds(): string[] {
  const itemIds = useItemsStore.getState().mediaDependencyIds;
  const compositionIds = useCompositionsStore.getState().mediaDependencyIds;
  return mergeSortedUnique(itemIds, compositionIds);
}

function recomputeMediaDependencies() {
  const nextMediaIds = buildCombinedMediaIds();
  useMediaDependencyStore.setState((state) => {
    if (areStringArraysEqual(state.mediaIds, nextMediaIds)) {
      return state;
    }
    return {
      mediaIds: nextMediaIds,
      mediaDependencyVersion: state.mediaDependencyVersion + 1,
    };
  });
}

export const useMediaDependencyStore = create<MediaDependencyState>()(() => ({
  mediaIds: buildCombinedMediaIds(),
  mediaDependencyVersion: 0,
}));

let prevItemsMediaDependencyVersion = useItemsStore.getState().mediaDependencyVersion;
useItemsStore.subscribe((state) => {
  if (state.mediaDependencyVersion === prevItemsMediaDependencyVersion) {
    return;
  }
  prevItemsMediaDependencyVersion = state.mediaDependencyVersion;
  recomputeMediaDependencies();
});

let prevCompositionsMediaDependencyVersion = useCompositionsStore.getState().mediaDependencyVersion;
useCompositionsStore.subscribe((state) => {
  if (state.mediaDependencyVersion === prevCompositionsMediaDependencyVersion) {
    return;
  }
  prevCompositionsMediaDependencyVersion = state.mediaDependencyVersion;
  recomputeMediaDependencies();
});
