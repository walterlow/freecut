import { create } from 'zustand';

interface RippleEditPreviewState {
  /** The item being trimmed */
  trimmedItemId: string | null;
  /** Which handle on the trimmed item: 'start' or 'end' */
  handle: 'start' | 'end' | null;
  /** Track ID of the trimmed item (for filtering downstream items) */
  trackId: string | null;
  /** IDs of downstream items that should shift during the ripple preview */
  downstreamItemIds: Set<string>;
  /** Shift delta in frames for downstream items (positive = shift right, negative = shift left) */
  delta: number;
  /** Trim delta in frames for the trimmed item (same value the hook sends to setTrimState) */
  trimDelta: number;
}

interface RippleEditPreviewActions {
  setPreview: (params: {
    trimmedItemId: string;
    handle: 'start' | 'end';
    trackId: string;
    downstreamItemIds: Set<string>;
    delta: number;
    trimDelta: number;
  }) => void;
  setDeltas: (delta: number, trimDelta: number) => void;
  clearPreview: () => void;
}

export const useRippleEditPreviewStore = create<
  RippleEditPreviewState & RippleEditPreviewActions
>()((set) => ({
  trimmedItemId: null,
  handle: null,
  trackId: null,
  downstreamItemIds: new Set<string>(),
  delta: 0,
  trimDelta: 0,
  setPreview: (params) => set(params),
  setDeltas: (delta, trimDelta) => set({ delta, trimDelta }),
  clearPreview: () =>
    set({
      trimmedItemId: null,
      handle: null,
      trackId: null,
      downstreamItemIds: new Set<string>(),
      delta: 0,
      trimDelta: 0,
    }),
}));
