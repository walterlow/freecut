import { create } from 'zustand';

interface RollingEditPreviewState {
  /** The item being directly trimmed (the one the user grabbed) */
  trimmedItemId: string | null;
  /** The adjacent neighbor being inversely adjusted */
  neighborItemId: string | null;
  /** Which handle on the trimmed item: 'start' or 'end' */
  handle: 'start' | 'end' | null;
  /** Delta in frames applied to the neighbor (positive = extend, negative = shrink).
   *  For the neighbor:
   *    - If trimmedItem's end handle is dragged right → neighbor's start moves right (neighborDelta > 0 means shrink start)
   *    - Convention: neighborDelta matches the trimmed item's delta sign convention from use-timeline-trim */
  neighborDelta: number;
}

interface RollingEditPreviewActions {
  setPreview: (params: {
    trimmedItemId: string;
    neighborItemId: string;
    handle: 'start' | 'end';
    neighborDelta: number;
  }) => void;
  setNeighborDelta: (neighborDelta: number) => void;
  clearPreview: () => void;
}

export const useRollingEditPreviewStore = create<
  RollingEditPreviewState & RollingEditPreviewActions
>()((set) => ({
  trimmedItemId: null,
  neighborItemId: null,
  handle: null,
  neighborDelta: 0,
  setPreview: (params) => set(params),
  setNeighborDelta: (neighborDelta) => set({ neighborDelta }),
  clearPreview: () =>
    set({
      trimmedItemId: null,
      neighborItemId: null,
      handle: null,
      neighborDelta: 0,
    }),
}));
