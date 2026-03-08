import { create } from 'zustand';

interface PreviewOverlayStoreState {
  isVisualBypassActive: boolean;
  setVisualBypassActive: (active: boolean) => void;
}

export const usePreviewOverlayStore = create<PreviewOverlayStoreState>((set) => ({
  isVisualBypassActive: false,
  setVisualBypassActive: (active) => set({ isVisualBypassActive: active }),
}));
