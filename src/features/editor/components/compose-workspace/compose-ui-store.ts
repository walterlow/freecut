import { create } from 'zustand'

interface ComposeUiState {
  expandedLayerIdsByComposition: Record<string, string[]>
  lastOpenedCompositionId: string | null
  motionReturnTabCaptured: boolean
  motionReturnTabId: string | null
  setLastOpenedCompositionId: (compositionId: string | null) => void
  captureMotionReturnTab: (tabId: string | null) => void
  clearMotionReturnTab: () => void
  toggleLayerExpanded: (compositionId: string, itemId: string) => void
  setAllLayersExpanded: (
    compositionId: string,
    itemIds: Iterable<string>,
    expanded: boolean,
  ) => void
  pruneCompositionLayers: (compositionId: string, validItemIds: Iterable<string>) => void
}

export const useComposeUiStore = create<ComposeUiState>((set) => ({
  expandedLayerIdsByComposition: {},
  lastOpenedCompositionId: null,
  motionReturnTabCaptured: false,
  motionReturnTabId: null,
  setLastOpenedCompositionId: (compositionId) => set({ lastOpenedCompositionId: compositionId }),
  captureMotionReturnTab: (tabId) =>
    set((state) =>
      state.motionReturnTabCaptured
        ? state
        : { motionReturnTabCaptured: true, motionReturnTabId: tabId },
    ),
  clearMotionReturnTab: () => set({ motionReturnTabCaptured: false, motionReturnTabId: null }),
  toggleLayerExpanded: (compositionId, itemId) =>
    set((state) => {
      const current = state.expandedLayerIdsByComposition[compositionId] ?? []
      const next = current.includes(itemId)
        ? current.filter((id) => id !== itemId)
        : [...current, itemId]
      return {
        expandedLayerIdsByComposition: {
          ...state.expandedLayerIdsByComposition,
          [compositionId]: next,
        },
      }
    }),
  setAllLayersExpanded: (compositionId, itemIds, expanded) =>
    set((state) => ({
      expandedLayerIdsByComposition: {
        ...state.expandedLayerIdsByComposition,
        [compositionId]: expanded ? [...new Set(itemIds)] : [],
      },
    })),
  pruneCompositionLayers: (compositionId, validItemIds) =>
    set((state) => {
      const current = state.expandedLayerIdsByComposition[compositionId]
      if (!current) return state
      const valid = new Set(validItemIds)
      const next = current.filter((id) => valid.has(id))
      if (next.length === current.length) return state
      return {
        expandedLayerIdsByComposition: {
          ...state.expandedLayerIdsByComposition,
          [compositionId]: next,
        },
      }
    }),
}))
