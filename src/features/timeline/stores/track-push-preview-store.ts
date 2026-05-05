import { createEditPreviewStore } from './edit-preview-store-factory'

interface TrackPushPreviewState {
  /** The anchor item being pushed */
  anchorItemId: string | null
  /** Track ID of the anchor item */
  trackId: string | null
  /** IDs of items that shift (anchor + downstream) */
  shiftedItemIds: Set<string>
  /** Shift delta in frames (positive = right, negative = left) */
  delta: number
}

interface TrackPushPreviewActions {
  setPreview: (params: {
    anchorItemId: string
    trackId: string
    shiftedItemIds: Set<string>
    delta: number
  }) => void
  setDelta: (delta: number) => void
  clearPreview: () => void
}

const createInitialState = (): TrackPushPreviewState => ({
  anchorItemId: null,
  trackId: null,
  shiftedItemIds: new Set<string>(),
  delta: 0,
})

export const useTrackPushPreviewStore = createEditPreviewStore<
  TrackPushPreviewState,
  Parameters<TrackPushPreviewActions['setPreview']>[0],
  Pick<TrackPushPreviewActions, 'setDelta'>
>({
  initialState: createInitialState,
  createActions: (set) => ({
    setDelta: (delta) => set({ delta }),
  }),
})
