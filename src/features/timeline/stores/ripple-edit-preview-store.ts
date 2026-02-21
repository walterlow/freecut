import { create } from 'zustand';

interface RippleEditPreviewState {
  /** The item being trimmed */
  trimmedItemId: string | null;
  /** Which handle on the trimmed item: 'start' or 'end' */
  handle: 'start' | 'end' | null;
  /** Track ID of the trimmed item (for filtering downstream items) */
  trackId: string | null;
  /** Original end frame of the trimmed item (items at or after this position are downstream) */
  trimmedItemEnd: number;
  /** Shift delta in frames for downstream items (positive = shift right, negative = shift left) */
  delta: number;
}

interface RippleEditPreviewActions {
  setPreview: (params: {
    trimmedItemId: string;
    handle: 'start' | 'end';
    trackId: string;
    trimmedItemEnd: number;
    delta: number;
  }) => void;
  setDelta: (delta: number) => void;
  clearPreview: () => void;
}

export const useRippleEditPreviewStore = create<
  RippleEditPreviewState & RippleEditPreviewActions
>()((set) => ({
  trimmedItemId: null,
  handle: null,
  trackId: null,
  trimmedItemEnd: 0,
  delta: 0,
  setPreview: (params) => set(params),
  setDelta: (delta) => set({ delta }),
  clearPreview: () =>
    set({
      trimmedItemId: null,
      handle: null,
      trackId: null,
      trimmedItemEnd: 0,
      delta: 0,
    }),
}));
