import { create } from 'zustand'

interface RollingEditPreviewState {
  /** The item being directly trimmed (the one the user grabbed) */
  trimmedItemId: string | null
  /** The adjacent neighbor being inversely adjusted */
  neighborItemId: string | null
  /** Which handle on the trimmed item: 'start' or 'end' */
  handle: 'start' | 'end' | null
  /** Delta in frames applied to the neighbor */
  neighborDelta: number
  /** Whether the rolling edit is constrained (from either clip's source limit) */
  constrained: boolean
}

interface RollingEditPreviewActions {
  setPreview: (params: {
    trimmedItemId: string
    neighborItemId: string
    handle: 'start' | 'end'
    neighborDelta: number
    constrained?: boolean
  }) => void
  setNeighborDelta: (neighborDelta: number, constrained?: boolean) => void
  clearPreview: () => void
}

export const useRollingEditPreviewStore = create<
  RollingEditPreviewState & RollingEditPreviewActions
>()((set) => ({
  trimmedItemId: null,
  neighborItemId: null,
  handle: null,
  neighborDelta: 0,
  constrained: false,
  setPreview: (params) => set({ ...params, constrained: params.constrained ?? false }),
  setNeighborDelta: (neighborDelta, constrained) =>
    set({ neighborDelta, constrained: constrained ?? false }),
  clearPreview: () =>
    set({
      trimmedItemId: null,
      neighborItemId: null,
      handle: null,
      neighborDelta: 0,
      constrained: false,
    }),
}))
