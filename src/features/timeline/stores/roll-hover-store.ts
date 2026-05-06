import { create } from 'zustand'

interface RollHoverState {
  /** The item that published the roll hover (the one being hovered) */
  sourceItemId: string | null
  /** The neighbor item that should also show its edge handle */
  neighborItemId: string | null
  /** Which edge of the neighbor to highlight */
  neighborEdge: 'start' | 'end' | null
  setRollHover: (sourceId: string, neighborId: string, edge: 'start' | 'end') => void
  clearRollHover: (sourceId: string) => void
}

export const useRollHoverStore = create<RollHoverState>()((set, get) => ({
  sourceItemId: null,
  neighborItemId: null,
  neighborEdge: null,

  setRollHover: (sourceId, neighborId, edge) => {
    const state = get()
    if (
      state.sourceItemId === sourceId &&
      state.neighborItemId === neighborId &&
      state.neighborEdge === edge
    )
      return
    set({ sourceItemId: sourceId, neighborItemId: neighborId, neighborEdge: edge })
  },

  clearRollHover: (sourceId) => {
    // Only clear if this source owns the current hover
    if (get().sourceItemId !== sourceId) return
    set({ sourceItemId: null, neighborItemId: null, neighborEdge: null })
  },
}))
