import { create } from 'zustand';

export type SceneBrowserSortMode = 'relevance' | 'time' | 'name';

/**
 * `scope === null` is the default cross-library view. A non-null scope is
 * the mediaId the Scene Browser was opened from — set when the user clicks
 * "Open in Scene Browser" from a media card's info popover.
 */
interface SceneBrowserState {
  open: boolean;
  query: string;
  scope: string | null;
  sortMode: SceneBrowserSortMode;
  /** Incrementing token the search input watches to force a focus. */
  focusNonce: number;
}

interface SceneBrowserActions {
  openBrowser: (options?: { mediaId?: string | null; focus?: boolean }) => void;
  closeBrowser: () => void;
  toggleBrowser: () => void;
  setQuery: (query: string) => void;
  setScope: (scope: string | null) => void;
  setSortMode: (mode: SceneBrowserSortMode) => void;
  requestFocus: () => void;
  reset: () => void;
}

const INITIAL_STATE: SceneBrowserState = {
  open: false,
  query: '',
  scope: null,
  sortMode: 'relevance',
  focusNonce: 0,
};

export const useSceneBrowserStore = create<SceneBrowserState & SceneBrowserActions>((set) => ({
  ...INITIAL_STATE,

  openBrowser: (options) => set((state) => ({
    open: true,
    scope: options?.mediaId !== undefined ? options.mediaId : state.scope,
    focusNonce: options?.focus === false ? state.focusNonce : state.focusNonce + 1,
  })),

  closeBrowser: () => set({ open: false }),

  toggleBrowser: () => set((state) => ({
    open: !state.open,
    focusNonce: !state.open ? state.focusNonce + 1 : state.focusNonce,
  })),

  setQuery: (query) => set({ query }),

  setScope: (scope) => set({ scope }),

  setSortMode: (sortMode) => set({ sortMode }),

  requestFocus: () => set((state) => ({ focusNonce: state.focusNonce + 1 })),

  reset: () => set(INITIAL_STATE),
}));
