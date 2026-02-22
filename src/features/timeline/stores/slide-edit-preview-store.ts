import { create } from 'zustand';

interface SlideEditPreviewState {
  /** The item being slid */
  itemId: string | null;
  /** Track ID of the slid item */
  trackId: string | null;
  /** ID of left neighbor (whose end adjusts) */
  leftNeighborId: string | null;
  /** ID of right neighbor (whose start adjusts) */
  rightNeighborId: string | null;
  /** Delta in timeline frames (positive = slide right, negative = slide left) */
  slideDelta: number;
}

interface SlideEditPreviewActions {
  setPreview: (params: {
    itemId: string;
    trackId: string;
    leftNeighborId: string | null;
    rightNeighborId: string | null;
    slideDelta: number;
  }) => void;
  setSlideDelta: (slideDelta: number) => void;
  clearPreview: () => void;
}

export const useSlideEditPreviewStore = create<
  SlideEditPreviewState & SlideEditPreviewActions
>()((set) => ({
  itemId: null,
  trackId: null,
  leftNeighborId: null,
  rightNeighborId: null,
  slideDelta: 0,
  setPreview: (params) => set(params),
  setSlideDelta: (slideDelta) => set({ slideDelta }),
  clearPreview: () =>
    set({
      itemId: null,
      trackId: null,
      leftNeighborId: null,
      rightNeighborId: null,
      slideDelta: 0,
    }),
}));
