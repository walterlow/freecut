import { create } from 'zustand'
import type { SelectionState, SelectionActions, SelectionDragState } from './types'

function areStringListsEqual(previous: readonly string[], next: readonly string[]): boolean {
  if (previous.length !== next.length) {
    return false
  }

  for (let index = 0; index < previous.length; index += 1) {
    if (previous[index] !== next[index]) {
      return false
    }
  }

  return true
}

function normalizeDragState(dragState: SelectionDragState): SelectionDragState {
  if (!dragState) {
    return null
  }

  return {
    ...dragState,
    draggedItemIdSet: dragState.draggedItemIdSet ?? new Set(dragState.draggedItemIds),
    draggedTrackIdSet: dragState.draggedTrackIdSet ?? new Set(dragState.draggedTrackIds ?? []),
  }
}

export const useSelectionStore = create<SelectionState & SelectionActions>((set) => ({
  // State
  selectedItemIds: [],
  selectedItemIdSet: new Set<string>(),
  selectedMarkerId: null,
  selectedTransitionId: null,
  selectedTrackId: null, // Deprecated
  selectedTrackIds: [],
  activeTrackId: null,
  selectionType: null,
  activeTool: 'select',
  activeSnapTarget: null,
  activeLinkedDropTarget: null,
  dragState: null,
  expandedKeyframeLanes: new Set<string>(),

  // Actions
  selectItems: (ids) =>
    set((state) => {
      const nextSelectionType =
        ids.length > 0 ? 'item' : state.selectedTrackIds.length > 0 ? 'track' : null
      if (
        areStringListsEqual(state.selectedItemIds, ids) &&
        state.selectedMarkerId === null &&
        state.selectedTransitionId === null &&
        state.selectionType === nextSelectionType
      ) {
        return state
      }

      return {
        selectedItemIds: ids,
        selectedItemIdSet: new Set(ids),
        selectedMarkerId: null, // Clear marker selection (mutually exclusive)
        selectedTransitionId: null, // Clear transition selection
        // Preserve track selection when selecting items
        selectionType: nextSelectionType,
      }
    }),
  selectMarker: (id) =>
    set({
      selectedMarkerId: id,
      selectedTransitionId: null, // Clear transition selection
      selectedItemIds: [], // Clear clip selection (mutually exclusive)
      selectedItemIdSet: new Set<string>(),
      // Don't clear activeTrackId - it's for track operations, not selection display
      selectionType: id ? 'marker' : null,
    }),
  selectTransition: (id) =>
    set({
      selectedTransitionId: id,
      selectedMarkerId: null, // Clear marker selection
      selectedItemIds: [], // Clear clip selection (mutually exclusive)
      selectedItemIdSet: new Set<string>(),
      selectionType: id ? 'transition' : null,
    }),
  selectTrack: (id) =>
    set({
      selectedTrackId: id,
      activeTrackId: id,
      selectedTrackIds: id ? [id] : [],
      selectedItemIds: [],
      selectedItemIdSet: new Set<string>(),
      selectedMarkerId: null, // Clear marker selection
      selectionType: id ? 'track' : null,
    }),
  selectTracks: (ids, append = false) =>
    set((state) => {
      const newSelectedIds = append ? Array.from(new Set([...state.selectedTrackIds, ...ids])) : ids
      return {
        selectedTrackIds: newSelectedIds,
        activeTrackId: ids[0] || null, // First selected becomes active
        selectedTrackId: ids[0] || null, // Deprecated
        selectedItemIds: [],
        selectedItemIdSet: new Set<string>(),
        selectedMarkerId: null, // Clear marker selection
        selectionType: newSelectedIds.length > 0 ? 'track' : null,
      }
    }),
  setActiveTrack: (id) =>
    set({
      activeTrackId: id,
      selectedTrackId: id, // Deprecated
      selectedTrackIds: id ? [id] : [],
      selectedItemIds: [],
      selectedItemIdSet: new Set<string>(),
      selectedMarkerId: null, // Clear marker selection
      selectionType: id ? 'track' : null,
    }),
  toggleTrackSelection: (id) =>
    set((state) => {
      const isSelected = state.selectedTrackIds.includes(id)
      const newSelectedIds = isSelected
        ? state.selectedTrackIds.filter((trackId) => trackId !== id)
        : [...state.selectedTrackIds, id]

      return {
        selectedTrackIds: newSelectedIds,
        activeTrackId: newSelectedIds[0] || null,
        selectedTrackId: newSelectedIds[0] || null, // Deprecated
        selectedItemIds: [],
        selectedItemIdSet: new Set<string>(),
        selectedMarkerId: null, // Clear marker selection
        selectionType: newSelectedIds.length > 0 ? 'track' : null,
      }
    }),
  clearSelection: () =>
    set({
      selectedItemIds: [],
      selectedItemIdSet: new Set<string>(),
      selectedMarkerId: null,
      selectedTransitionId: null,
      selectedTrackId: null,
      selectedTrackIds: [],
      activeTrackId: null,
      selectionType: null,
    }),
  clearItemSelection: () =>
    set((state) => ({
      selectedItemIds: [],
      selectedItemIdSet: new Set<string>(),
      selectionType: state.selectedTrackIds.length > 0 ? 'track' : null,
    })),
  setDragState: (dragState) =>
    set((state) => ({
      dragState: normalizeDragState(dragState),
      activeSnapTarget: dragState ? state.activeSnapTarget : null,
      activeLinkedDropTarget: dragState ? state.activeLinkedDropTarget : null,
    })),
  setActiveSnapTarget: (activeSnapTarget) => set({ activeSnapTarget }),
  setActiveLinkedDropTarget: (activeLinkedDropTarget) => set({ activeLinkedDropTarget }),
  setActiveTool: (tool) => set({ activeTool: tool }),
  // Keyframe lanes expansion
  toggleKeyframeLanes: (itemId) =>
    set((state) => {
      const newSet = new Set(state.expandedKeyframeLanes)
      if (newSet.has(itemId)) {
        newSet.delete(itemId)
      } else {
        newSet.add(itemId)
      }
      return { expandedKeyframeLanes: newSet }
    }),
  setKeyframeLanesExpanded: (itemId, expanded) =>
    set((state) => {
      const newSet = new Set(state.expandedKeyframeLanes)
      if (expanded) {
        newSet.add(itemId)
      } else {
        newSet.delete(itemId)
      }
      return { expandedKeyframeLanes: newSet }
    }),
}))
