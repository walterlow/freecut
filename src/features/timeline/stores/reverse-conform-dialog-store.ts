import { create } from 'zustand'
import type { TimelineItem, VideoItem } from '@/types/timeline'

export interface ReverseConformDialogRequest {
  id: string
  items: TimelineItem[]
  videoItems: VideoItem[]
  timelineFps: number
}

interface ReverseConformDialogState {
  request: ReverseConformDialogRequest | null
  open: (request: Omit<ReverseConformDialogRequest, 'id'>) => void
  close: (id?: string) => void
}

export const useReverseConformDialogStore = create<ReverseConformDialogState>()((set, get) => ({
  request: null,
  open: (request) =>
    set({
      request: {
        ...request,
        id: crypto.randomUUID(),
      },
    }),
  close: (id) => {
    if (id && get().request?.id !== id) return
    set({ request: null })
  },
}))
