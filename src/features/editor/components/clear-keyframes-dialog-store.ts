import { create } from 'zustand';
import type { AnimatableProperty } from '@/types/keyframe';

interface ClearKeyframesDialogState {
  isOpen: boolean;
  itemIds: string[];
  property: AnimatableProperty | null;
  openClearAll: (itemIds: string[]) => void;
  openClearProperty: (itemIds: string[], property: AnimatableProperty) => void;
  close: () => void;
}

export const useClearKeyframesDialogStore = create<ClearKeyframesDialogState>((set) => ({
  isOpen: false,
  itemIds: [],
  property: null,
  openClearAll: (itemIds) => set({ isOpen: true, itemIds, property: null }),
  openClearProperty: (itemIds, property) => set({ isOpen: true, itemIds, property }),
  close: () => set({ isOpen: false, itemIds: [], property: null }),
}));
