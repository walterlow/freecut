import { create } from 'zustand'
import type { PreviewItemUpdate } from '../utils/item-edit-preview'

interface LinkedEditPreviewState {
  updatesById: Record<string, PreviewItemUpdate>
}

interface LinkedEditPreviewActions {
  setUpdates: (updates: PreviewItemUpdate[]) => void
  clear: () => void
}

export const useLinkedEditPreviewStore = create<
  LinkedEditPreviewState & LinkedEditPreviewActions
>()((set) => ({
  updatesById: {},
  setUpdates: (updates) =>
    set({
      updatesById: Object.fromEntries(updates.map((update) => [update.id, update])),
    }),
  clear: () => set({ updatesById: {} }),
}))
