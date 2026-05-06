import { create } from 'zustand'

interface BentoLayoutDialogState {
  isOpen: boolean
  itemIds: string[]
  open: (itemIds: string[]) => void
  close: () => void
}

export const useBentoLayoutDialogStore = create<BentoLayoutDialogState>((set) => ({
  isOpen: false,
  itemIds: [],
  open: (itemIds) => set({ isOpen: true, itemIds }),
  close: () => set({ isOpen: false, itemIds: [] }),
}))
