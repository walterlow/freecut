import { create } from 'zustand';

interface TransitionResizePreviewState {
  transitionId: string | null;
  previewDuration: number;
  // Ripple context — set at resize start, stable during drag
  leftClipId: string | null;
  rightClipId: string | null;
  trackId: string | null;
  rightClipFrom: number;
  committedDuration: number;
}

interface TransitionResizePreviewActions {
  /** Full init at resize start — sets all fields */
  setPreview: (params: {
    transitionId: string;
    previewDuration: number;
    leftClipId: string;
    rightClipId: string;
    trackId: string;
    rightClipFrom: number;
    committedDuration: number;
  }) => void;
  /** Lightweight update on mouse move — only duration */
  setPreviewDuration: (previewDuration: number) => void;
  /** Reset all fields on mouseup */
  clearPreview: () => void;
}

export const useTransitionResizePreviewStore = create<
  TransitionResizePreviewState & TransitionResizePreviewActions
>()((set) => ({
  transitionId: null,
  previewDuration: 0,
  leftClipId: null,
  rightClipId: null,
  trackId: null,
  rightClipFrom: 0,
  committedDuration: 0,
  setPreview: (params) => set(params),
  setPreviewDuration: (previewDuration) => set({ previewDuration }),
  clearPreview: () =>
    set({
      transitionId: null,
      previewDuration: 0,
      leftClipId: null,
      rightClipId: null,
      trackId: null,
      rightClipFrom: 0,
      committedDuration: 0,
    }),
}));
