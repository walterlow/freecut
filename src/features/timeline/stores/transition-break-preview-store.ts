import { create } from 'zustand'

interface TransitionBreakPreviewState {
  itemId: string | null
  handle: 'start' | 'end' | null
  delta: number
}

interface TransitionBreakPreviewActions {
  setPreview: (params: { itemId: string; handle: 'start' | 'end'; delta: number }) => void
  setDelta: (delta: number) => void
  clearPreview: () => void
}

export const useTransitionBreakPreviewStore = create<
  TransitionBreakPreviewState & TransitionBreakPreviewActions
>()((set) => ({
  itemId: null,
  handle: null,
  delta: 0,
  setPreview: (params) => set(params),
  setDelta: (delta) => set({ delta }),
  clearPreview: () =>
    set({
      itemId: null,
      handle: null,
      delta: 0,
    }),
}))
