import { create } from 'zustand'

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

export const useTrackPushPreviewStore = create<TrackPushPreviewState & TrackPushPreviewActions>()(
  (set) => ({
    anchorItemId: null,
    trackId: null,
    shiftedItemIds: new Set<string>(),
    delta: 0,
    setPreview: (params) => set(params),
    setDelta: (delta) => set({ delta }),
    clearPreview: () =>
      set({
        anchorItemId: null,
        trackId: null,
        shiftedItemIds: new Set<string>(),
        delta: 0,
      }),
  }),
)
