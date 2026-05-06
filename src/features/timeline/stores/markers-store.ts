import { create } from 'zustand'
import type { ProjectMarker } from '@/types/timeline'

/**
 * Markers state - timeline markers and in/out points.
 * Markers are independent of clips - they're reference points on the timeline.
 */

interface MarkersState {
  markers: ProjectMarker[]
  inPoint: number | null
  outPoint: number | null
}

interface MarkersActions {
  // Bulk setters for snapshot restore
  setMarkers: (markers: ProjectMarker[]) => void
  setInPoint: (frame: number | null) => void
  setOutPoint: (frame: number | null) => void

  // CRUD operations
  addMarker: (frame: number, color?: string, label?: string) => void
  updateMarker: (id: string, updates: Partial<Omit<ProjectMarker, 'id'>>) => void
  removeMarker: (id: string) => void
  clearAllMarkers: () => void

  // In/out point operations
  clearInOutPoints: () => void
}

export const useMarkersStore = create<MarkersState & MarkersActions>()((set) => ({
  // State
  markers: [],
  inPoint: null,
  outPoint: null,

  // Bulk setters
  setMarkers: (markers) => set({ markers }),
  setInPoint: (frame) => set({ inPoint: frame }),
  setOutPoint: (frame) => set({ outPoint: frame }),

  // Marker CRUD
  addMarker: (frame, color = '#3B82F6', label = '') =>
    set((state) => ({
      markers: [
        ...state.markers,
        {
          id: crypto.randomUUID(),
          frame,
          color,
          label,
        },
      ],
    })),

  updateMarker: (id, updates) =>
    set((state) => ({
      markers: state.markers.map((m) => (m.id === id ? { ...m, ...updates } : m)),
    })),

  removeMarker: (id) =>
    set((state) => ({
      markers: state.markers.filter((m) => m.id !== id),
    })),

  clearAllMarkers: () => set({ markers: [] }),

  // In/out points
  clearInOutPoints: () => set({ inPoint: null, outPoint: null }),
}))
