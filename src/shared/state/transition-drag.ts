import { create } from 'zustand'
import type {
  FlipDirection,
  SlideDirection,
  TransitionPresentation,
  WipeDirection,
} from '@/types/transition'

export const TRANSITION_DRAG_MIME = 'application/x-freecut-transition'

export interface DraggedTransitionDescriptor {
  presentation: TransitionPresentation
  direction?: WipeDirection | SlideDirection | FlipDirection
}

export interface TransitionDragPreview {
  leftClipId: string
  rightClipId: string
  durationInFrames: number
  alignment: number
  existingTransitionId?: string
}

export interface TransitionDragHint {
  x: number
  y: number
  message: string
}

interface TransitionDragState {
  draggedTransition: DraggedTransitionDescriptor | null
  preview: TransitionDragPreview | null
  invalidHint: TransitionDragHint | null
  setDraggedTransition: (draggedTransition: DraggedTransitionDescriptor | null) => void
  setPreview: (preview: TransitionDragPreview | null) => void
  setInvalidHint: (invalidHint: TransitionDragHint | null) => void
  clearPreview: () => void
  clearDrag: () => void
}

export const useTransitionDragStore = create<TransitionDragState>()((set) => ({
  draggedTransition: null,
  preview: null,
  invalidHint: null,
  setDraggedTransition: (draggedTransition) => set({ draggedTransition }),
  setPreview: (preview) => set({ preview }),
  setInvalidHint: (invalidHint) => set({ invalidHint }),
  clearPreview: () => set({ preview: null }),
  clearDrag: () => set({ draggedTransition: null, preview: null, invalidHint: null }),
}))
