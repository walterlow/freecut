import { create } from 'zustand'

interface EffectDropPreviewState {
  targetItemIds: string[]
  hoveredItemId: string | null
  setPreview: (targetItemIds: string[], hoveredItemId: string) => void
  clearPreview: () => void
}

function areItemIdListsEqual(previous: string[], next: string[]): boolean {
  if (previous === next) {
    return true
  }

  if (previous.length !== next.length) {
    return false
  }

  for (let index = 0; index < previous.length; index += 1) {
    if (previous[index] !== next[index]) {
      return false
    }
  }

  return true
}

export const useEffectDropPreviewStore = create<EffectDropPreviewState>((set) => ({
  targetItemIds: [],
  hoveredItemId: null,
  setPreview: (targetItemIds, hoveredItemId) =>
    set((state) =>
      state.hoveredItemId === hoveredItemId &&
      areItemIdListsEqual(state.targetItemIds, targetItemIds)
        ? state
        : { targetItemIds, hoveredItemId },
    ),
  clearPreview: () =>
    set((state) =>
      state.hoveredItemId === null && state.targetItemIds.length === 0
        ? state
        : { targetItemIds: [], hoveredItemId: null },
    ),
}))
