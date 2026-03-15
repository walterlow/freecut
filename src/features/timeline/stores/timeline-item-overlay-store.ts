import { create } from 'zustand';

export type TimelineItemOverlayTone = 'neutral' | 'info' | 'success' | 'warning' | 'error';

export interface TimelineItemOverlay {
  id: string;
  label: string;
  progress?: number;
  tone?: TimelineItemOverlayTone;
}

interface TimelineItemOverlayState {
  overlaysByItemId: Record<string, TimelineItemOverlay[]>;
}

interface TimelineItemOverlayActions {
  upsertOverlay: (itemId: string, overlay: TimelineItemOverlay) => void;
  removeOverlay: (itemId: string, overlayId: string) => void;
  clearItemOverlays: (itemId: string) => void;
}

export const useTimelineItemOverlayStore =
  create<TimelineItemOverlayState & TimelineItemOverlayActions>()((set) => ({
    overlaysByItemId: {},

    upsertOverlay: (itemId, overlay) =>
      set((state) => {
        const current = state.overlaysByItemId[itemId] ?? [];
        const existingIndex = current.findIndex((entry) => entry.id === overlay.id);
        const nextItemOverlays = existingIndex === -1
          ? [...current, overlay]
          : current.map((entry, index) => (index === existingIndex ? overlay : entry));

        return {
          overlaysByItemId: {
            ...state.overlaysByItemId,
            [itemId]: nextItemOverlays,
          },
        };
      }),

    removeOverlay: (itemId, overlayId) =>
      set((state) => {
        const current = state.overlaysByItemId[itemId];
        if (!current) {
          return state;
        }

        const nextItemOverlays = current.filter((entry) => entry.id !== overlayId);
        if (nextItemOverlays.length === current.length) {
          return state;
        }

        if (nextItemOverlays.length === 0) {
          const remaining = { ...state.overlaysByItemId };
          delete remaining[itemId];
          return { overlaysByItemId: remaining };
        }

        return {
          overlaysByItemId: {
            ...state.overlaysByItemId,
            [itemId]: nextItemOverlays,
          },
        };
      }),

    clearItemOverlays: (itemId) =>
      set((state) => {
        if (!(itemId in state.overlaysByItemId)) {
          return state;
        }

        const remaining = { ...state.overlaysByItemId };
        delete remaining[itemId];
        return { overlaysByItemId: remaining };
      }),
  }));
