import { create } from 'zustand';

interface TimelineViewportState {
  scrollLeft: number;
  scrollTop: number;
  viewportWidth: number;
  viewportHeight: number;
}

interface TimelineViewportActions {
  setViewport: (next: TimelineViewportState) => void;
}

const EPSILON = 0.5;

function hasMeaningfulChange(prev: TimelineViewportState, next: TimelineViewportState): boolean {
  return Math.abs(prev.scrollLeft - next.scrollLeft) > EPSILON
    || Math.abs(prev.scrollTop - next.scrollTop) > EPSILON
    || Math.abs(prev.viewportWidth - next.viewportWidth) > EPSILON
    || Math.abs(prev.viewportHeight - next.viewportHeight) > EPSILON;
}

export const useTimelineViewportStore = create<TimelineViewportState & TimelineViewportActions>()(
  (set, get) => ({
    scrollLeft: 0,
    scrollTop: 0,
    viewportWidth: 0,
    viewportHeight: 0,
    setViewport: (next) => {
      const current = get();
      if (!hasMeaningfulChange(current, next)) {
        return;
      }
      set(next);
    },
  })
);

