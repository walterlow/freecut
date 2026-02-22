import { create } from 'zustand';

interface SlipEditPreviewState {
  /** The item being slipped */
  itemId: string | null;
  /** Track ID of the slipped item */
  trackId: string | null;
  /** Delta in source frames (positive = shift source right, negative = shift source left) */
  slipDelta: number;
}

interface SlipEditPreviewActions {
  setPreview: (params: {
    itemId: string;
    trackId: string;
    slipDelta: number;
  }) => void;
  setSlipDelta: (slipDelta: number) => void;
  clearPreview: () => void;
}

export const useSlipEditPreviewStore = create<
  SlipEditPreviewState & SlipEditPreviewActions
>()((set) => ({
  itemId: null,
  trackId: null,
  slipDelta: 0,
  setPreview: (params) => set(params),
  setSlipDelta: (slipDelta) => set({ slipDelta }),
  clearPreview: () =>
    set({
      itemId: null,
      trackId: null,
      slipDelta: 0,
    }),
}));
