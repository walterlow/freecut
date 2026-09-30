import { create } from 'zustand'

interface Projection360OrbitState {
  /** Whether 360 camera orbit mode is active on the preview canvas */
  isOrbitActive: boolean
  /** The item ID being orbited */
  orbitItemId: string | null
  /** Live drag state */
  isDragging: boolean
}

interface Projection360OrbitActions {
  setOrbitActive: (active: boolean, itemId?: string | null) => void
  setIsDragging: (dragging: boolean) => void
}

export const useProjection360OrbitStore = create<
  Projection360OrbitState & Projection360OrbitActions
>()((set) => ({
  isOrbitActive: true, // Active by default when 360 projection is enabled on selected item
  orbitItemId: null,
  isDragging: false,

  setOrbitActive: (active, itemId = null) =>
    set({
      isOrbitActive: active,
      orbitItemId: active ? itemId : null,
      isDragging: false,
    }),

  setIsDragging: (dragging) => set({ isDragging: dragging }),
}))
