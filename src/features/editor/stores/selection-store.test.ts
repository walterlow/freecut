import { describe, expect, it, beforeEach } from 'vitest';
import { useSelectionStore } from './selection-store';

describe('selection-store', () => {
  beforeEach(() => {
    useSelectionStore.getState().clearSelection();
  });

  it('has correct initial state', () => {
    const state = useSelectionStore.getState();
    expect(state.selectedItemIds).toEqual([]);
    expect(state.selectedMarkerId).toBe(null);
    expect(state.selectedTransitionId).toBe(null);
    expect(state.selectedTrackIds).toEqual([]);
    expect(state.activeTrackId).toBe(null);
    expect(state.selectionType).toBe(null);
    expect(state.activeTool).toBe('select');
    expect(state.dragState).toBe(null);
  });

  describe('selectItems', () => {
    it('selects items and sets selectionType to item', () => {
      useSelectionStore.getState().selectItems(['item-1', 'item-2']);
      const state = useSelectionStore.getState();
      expect(state.selectedItemIds).toEqual(['item-1', 'item-2']);
      expect(state.selectionType).toBe('item');
    });

    it('clears marker and transition selection', () => {
      useSelectionStore.getState().selectMarker('marker-1');
      useSelectionStore.getState().selectItems(['item-1']);
      const state = useSelectionStore.getState();
      expect(state.selectedMarkerId).toBe(null);
      expect(state.selectedTransitionId).toBe(null);
    });

    it('sets selectionType to null when selecting empty array without tracks', () => {
      useSelectionStore.getState().selectItems([]);
      expect(useSelectionStore.getState().selectionType).toBe(null);
    });

    it('preserves track selectionType when deselecting items with active tracks', () => {
      useSelectionStore.getState().selectTracks(['track-1']);
      useSelectionStore.getState().selectItems([]);
      expect(useSelectionStore.getState().selectionType).toBe('track');
    });
  });

  describe('selectMarker', () => {
    it('selects a marker and clears item/transition selection', () => {
      useSelectionStore.getState().selectItems(['item-1']);
      useSelectionStore.getState().selectMarker('marker-1');
      const state = useSelectionStore.getState();
      expect(state.selectedMarkerId).toBe('marker-1');
      expect(state.selectedItemIds).toEqual([]);
      expect(state.selectedTransitionId).toBe(null);
      expect(state.selectionType).toBe('marker');
    });

    it('sets selectionType to null when deselecting marker', () => {
      useSelectionStore.getState().selectMarker(null);
      expect(useSelectionStore.getState().selectionType).toBe(null);
    });
  });

  describe('selectTransition', () => {
    it('selects a transition and clears item/marker selection', () => {
      useSelectionStore.getState().selectItems(['item-1']);
      useSelectionStore.getState().selectTransition('trans-1');
      const state = useSelectionStore.getState();
      expect(state.selectedTransitionId).toBe('trans-1');
      expect(state.selectedItemIds).toEqual([]);
      expect(state.selectedMarkerId).toBe(null);
      expect(state.selectionType).toBe('transition');
    });
  });

  describe('selectTrack / selectTracks', () => {
    it('selects a single track', () => {
      useSelectionStore.getState().selectTrack('track-1');
      const state = useSelectionStore.getState();
      expect(state.activeTrackId).toBe('track-1');
      expect(state.selectedTrackIds).toEqual(['track-1']);
      expect(state.selectionType).toBe('track');
      expect(state.selectedItemIds).toEqual([]);
    });

    it('clears track selection with null', () => {
      useSelectionStore.getState().selectTrack('track-1');
      useSelectionStore.getState().selectTrack(null);
      const state = useSelectionStore.getState();
      expect(state.activeTrackId).toBe(null);
      expect(state.selectedTrackIds).toEqual([]);
      expect(state.selectionType).toBe(null);
    });

    it('selects multiple tracks', () => {
      useSelectionStore.getState().selectTracks(['track-1', 'track-2']);
      const state = useSelectionStore.getState();
      expect(state.selectedTrackIds).toEqual(['track-1', 'track-2']);
      expect(state.activeTrackId).toBe('track-1');
    });

    it('appends to track selection', () => {
      useSelectionStore.getState().selectTracks(['track-1']);
      useSelectionStore.getState().selectTracks(['track-2'], true);
      expect(useSelectionStore.getState().selectedTrackIds).toEqual(['track-1', 'track-2']);
    });

    it('deduplicates when appending', () => {
      useSelectionStore.getState().selectTracks(['track-1']);
      useSelectionStore.getState().selectTracks(['track-1', 'track-2'], true);
      expect(useSelectionStore.getState().selectedTrackIds).toEqual(['track-1', 'track-2']);
    });
  });

  describe('toggleTrackSelection', () => {
    it('adds a track to selection', () => {
      useSelectionStore.getState().selectTracks(['track-1']);
      useSelectionStore.getState().toggleTrackSelection('track-2');
      expect(useSelectionStore.getState().selectedTrackIds).toEqual(['track-1', 'track-2']);
    });

    it('removes a track from selection', () => {
      useSelectionStore.getState().selectTracks(['track-1', 'track-2']);
      useSelectionStore.getState().toggleTrackSelection('track-1');
      expect(useSelectionStore.getState().selectedTrackIds).toEqual(['track-2']);
      expect(useSelectionStore.getState().activeTrackId).toBe('track-2');
    });

    it('clears selectionType when all tracks removed', () => {
      useSelectionStore.getState().selectTracks(['track-1']);
      useSelectionStore.getState().toggleTrackSelection('track-1');
      expect(useSelectionStore.getState().selectedTrackIds).toEqual([]);
      expect(useSelectionStore.getState().selectionType).toBe(null);
    });
  });

  describe('clearSelection', () => {
    it('clears all selection state', () => {
      useSelectionStore.getState().selectItems(['item-1']);
      useSelectionStore.getState().selectTracks(['track-1']);
      useSelectionStore.getState().clearSelection();

      const state = useSelectionStore.getState();
      expect(state.selectedItemIds).toEqual([]);
      expect(state.selectedMarkerId).toBe(null);
      expect(state.selectedTransitionId).toBe(null);
      expect(state.selectedTrackIds).toEqual([]);
      expect(state.activeTrackId).toBe(null);
      expect(state.selectionType).toBe(null);
    });
  });

  describe('clearItemSelection', () => {
    it('clears only item selection, preserves track selection', () => {
      useSelectionStore.getState().selectTracks(['track-1']);
      useSelectionStore.getState().selectItems(['item-1']);
      useSelectionStore.getState().clearItemSelection();

      const state = useSelectionStore.getState();
      expect(state.selectedItemIds).toEqual([]);
      expect(state.selectedTrackIds).toEqual(['track-1']);
      expect(state.selectionType).toBe('track');
    });
  });

  describe('activeTool', () => {
    it('sets active tool', () => {
      useSelectionStore.getState().setActiveTool('razor');
      expect(useSelectionStore.getState().activeTool).toBe('razor');

      useSelectionStore.getState().setActiveTool('rate-stretch');
      expect(useSelectionStore.getState().activeTool).toBe('rate-stretch');

      useSelectionStore.getState().setActiveTool('select');
      expect(useSelectionStore.getState().activeTool).toBe('select');
    });
  });

  describe('dragState', () => {
    it('sets and clears drag state', () => {
      const dragState = {
        isDragging: true,
        draggedItemIds: ['item-1'],
        offset: { x: 10, y: 20 },
      };
      useSelectionStore.getState().setDragState(dragState);
      expect(useSelectionStore.getState().dragState).toEqual(dragState);

      useSelectionStore.getState().setDragState(null);
      expect(useSelectionStore.getState().dragState).toBe(null);
    });
  });

  describe('keyframe lanes', () => {
    it('toggles keyframe lane expansion', () => {
      useSelectionStore.getState().toggleKeyframeLanes('item-1');
      expect(useSelectionStore.getState().expandedKeyframeLanes.has('item-1')).toBe(true);

      useSelectionStore.getState().toggleKeyframeLanes('item-1');
      expect(useSelectionStore.getState().expandedKeyframeLanes.has('item-1')).toBe(false);
    });

    it('sets keyframe lane expanded state explicitly', () => {
      useSelectionStore.getState().setKeyframeLanesExpanded('item-1', true);
      expect(useSelectionStore.getState().expandedKeyframeLanes.has('item-1')).toBe(true);

      useSelectionStore.getState().setKeyframeLanesExpanded('item-1', false);
      expect(useSelectionStore.getState().expandedKeyframeLanes.has('item-1')).toBe(false);
    });
  });
});
