import { create } from 'zustand';
import type { SourcePlayerState } from './types';

export const useSourcePlayerStore = create<SourcePlayerState>((set) => ({
  hoveredPanel: null,
  playerMethods: null,
  currentMediaId: null,
  currentSourceFrame: 0,
  inPoint: null,
  outPoint: null,
  pendingSeekFrame: null,
  setHoveredPanel: (panel) => set({ hoveredPanel: panel }),
  setPlayerMethods: (methods) => set({ playerMethods: methods }),
  setCurrentMediaId: (id) => set((state) => {
    if (id === state.currentMediaId) return state;
    return { currentMediaId: id, inPoint: null, outPoint: null, currentSourceFrame: 0 };
  }),
  setCurrentSourceFrame: (frame) => set({ currentSourceFrame: frame }),
  setInPoint: (frame) => set((state) => {
    if (frame !== null && state.outPoint !== null && frame >= state.outPoint) {
      return { inPoint: frame, outPoint: null };
    }
    return { inPoint: frame };
  }),
  setOutPoint: (frame) => set((state) => {
    if (frame !== null && state.inPoint !== null && frame <= state.inPoint) {
      return { outPoint: frame, inPoint: null };
    }
    return { outPoint: frame };
  }),
  clearInOutPoints: () => set({ inPoint: null, outPoint: null }),
  setPendingSeekFrame: (frame) => set({ pendingSeekFrame: frame }),
}));
