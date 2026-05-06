import { create } from 'zustand'

interface SlideEditPreviewState {
  /** The item being slid */
  itemId: string | null
  /** Track ID of the slid item */
  trackId: string | null
  /** ID of left neighbor (whose end adjusts) */
  leftNeighborId: string | null
  /** ID of right neighbor (whose start adjusts) */
  rightNeighborId: string | null
  /** Delta in timeline frames (positive = slide right, negative = slide left) */
  slideDelta: number
  /** Max leftward slide delta (negative), combining all track constraints */
  minDelta: number
  /** Max rightward slide delta (positive), combining all track constraints */
  maxDelta: number
}

interface SlideEditPreviewActions {
  setPreview: (params: {
    itemId: string
    trackId: string
    leftNeighborId: string | null
    rightNeighborId: string | null
    slideDelta: number
    minDelta?: number
    maxDelta?: number
  }) => void
  setSlideDelta: (slideDelta: number) => void
  setSlideRange: (minDelta: number, maxDelta: number) => void
  clearPreview: () => void
}

export const useSlideEditPreviewStore = create<SlideEditPreviewState & SlideEditPreviewActions>()(
  (set) => ({
    itemId: null,
    trackId: null,
    leftNeighborId: null,
    rightNeighborId: null,
    slideDelta: 0,
    minDelta: 0,
    maxDelta: 0,
    setPreview: (params) =>
      set({
        ...params,
        minDelta: params.minDelta ?? 0,
        maxDelta: params.maxDelta ?? 0,
      }),
    setSlideDelta: (slideDelta) => set({ slideDelta }),
    setSlideRange: (minDelta, maxDelta) => set({ minDelta, maxDelta }),
    clearPreview: () =>
      set({
        itemId: null,
        trackId: null,
        leftNeighborId: null,
        rightNeighborId: null,
        slideDelta: 0,
        minDelta: 0,
        maxDelta: 0,
      }),
  }),
)
