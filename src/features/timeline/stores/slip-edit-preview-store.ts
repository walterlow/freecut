import { createEditPreviewStore } from './edit-preview-store-factory'

interface SlipEditPreviewState {
  /** The item being slipped */
  itemId: string | null
  /** Track ID of the slipped item */
  trackId: string | null
  /** Delta in source frames (positive = shift source right, negative = shift source left) */
  slipDelta: number
}

interface SlipEditPreviewActions {
  setPreview: (params: { itemId: string; trackId: string; slipDelta: number }) => void
  setSlipDelta: (slipDelta: number) => void
  clearPreview: () => void
}

const createInitialState = (): SlipEditPreviewState => ({
  itemId: null,
  trackId: null,
  slipDelta: 0,
})

export const useSlipEditPreviewStore = createEditPreviewStore<
  SlipEditPreviewState,
  Parameters<SlipEditPreviewActions['setPreview']>[0],
  Pick<SlipEditPreviewActions, 'setSlipDelta'>
>({
  initialState: createInitialState,
  createActions: (set) => ({
    setSlipDelta: (slipDelta) => set({ slipDelta }),
  }),
})
