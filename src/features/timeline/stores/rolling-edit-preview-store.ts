import { createEditPreviewStore } from './edit-preview-store-factory'

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

const createInitialState = (): RollingEditPreviewState => ({
  trimmedItemId: null,
  neighborItemId: null,
  handle: null,
  neighborDelta: 0,
  constrained: false,
})

export const useRollingEditPreviewStore = createEditPreviewStore<
  RollingEditPreviewState,
  Parameters<RollingEditPreviewActions['setPreview']>[0],
  Pick<RollingEditPreviewActions, 'setNeighborDelta'>
>({
  initialState: createInitialState,
  normalizePreview: (params) => ({ ...params, constrained: params.constrained ?? false }),
  createActions: (set) => ({
    setNeighborDelta: (neighborDelta, constrained) =>
      set({ neighborDelta, constrained: constrained ?? false }),
  }),
})
