import { create } from 'zustand';

export interface ZoomState {
  level: number;
  pixelsPerSecond: number;
}

export interface ZoomActions {
  setZoomLevel: (level: number) => void;
  zoomIn: () => void;
  zoomOut: () => void;
}

// IMPORTANT: Always use granular selectors to prevent unnecessary re-renders!
//
// ✅ CORRECT: Use granular selectors
// const zoomLevel = useZoomStore(s => s.level);
// const zoomIn = useZoomStore(s => s.zoomIn);
//
// ❌ WRONG: Don't destructure the entire store
// const { level, zoomIn } = useZoomStore();

export const useZoomStore = create<ZoomState & ZoomActions>((set) => ({
  level: 1,
  pixelsPerSecond: 100,

  setZoomLevel: (level) => set({ level, pixelsPerSecond: level * 100 }),
  zoomIn: () =>
    set((state) => {
      const newLevel = Math.min(state.level * 1.2, 50); // Increased from 10 to 50 for finer detail
      return { level: newLevel, pixelsPerSecond: newLevel * 100 };
    }),
  zoomOut: () =>
    set((state) => {
      const newLevel = Math.max(state.level / 1.2, 0.01);
      return { level: newLevel, pixelsPerSecond: newLevel * 100 };
    }),
}));
