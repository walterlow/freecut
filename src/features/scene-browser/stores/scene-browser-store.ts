import { create, type StoreApi, type UseBoundStore } from 'zustand';
import type { PaletteEntry } from '../deps/analysis';

export type SceneBrowserSortMode = 'relevance' | 'time' | 'name';
export type SceneBrowserViewMode = 'list' | 'grid';

export interface SceneBrowserReference {
  /** Scene id whose palette is the reference — for dedupe and the clear chip. */
  sceneId: string;
  /** Short human label (e.g. `"foo.mp4 · 0:12"`) shown in the chip. */
  label: string;
  /** The reference palette (CIELAB + weight). */
  palette: PaletteEntry[];
}

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
  /**
   * Active "find similar palette" reference. When set, the ranker scores
   * scenes by palette distance against this reference instead of by
   * query semantics. Cleared explicitly (chip × or escape).
   */
  reference: SceneBrowserReference | null;
  /**
   * Panel-local Color Mode — swaps the search input for a grid of the
   * library's dominant colors. Orthogonal to captionSearchMode; a user
   * can come back to their preferred keyword/semantic lane by toggling
   * it off. Not persisted so the default is always "text search".
   */
  colorMode: boolean;
  /**
   * List vs grid layout for the results area. Grid is a responsive
   * thumbnail-first layout (good for color/visual scanning); list is
   * thumbnail + caption text (good for reading matches).
   */
  viewMode: SceneBrowserViewMode;
}

interface SceneBrowserActions {
  openBrowser: (options?: { mediaId?: string | null; focus?: boolean }) => void;
  closeBrowser: () => void;
  toggleBrowser: () => void;
  setQuery: (query: string) => void;
  setScope: (scope: string | null) => void;
  setSortMode: (mode: SceneBrowserSortMode) => void;
  requestFocus: () => void;
  setReference: (reference: SceneBrowserReference | null) => void;
  setColorMode: (colorMode: boolean) => void;
  setViewMode: (viewMode: SceneBrowserViewMode) => void;
  reset: () => void;
}

const INITIAL_STATE: SceneBrowserState = {
  open: false,
  query: '',
  scope: null,
  sortMode: 'relevance',
  focusNonce: 0,
  reference: null,
  colorMode: false,
  viewMode: 'list',
};

type SceneBrowserStoreApi = UseBoundStore<StoreApi<SceneBrowserState & SceneBrowserActions>>;

declare global {
  var __FREECUT_SCENE_BROWSER_STORE__: SceneBrowserStoreApi | undefined;
}

const hotStore = import.meta.env.DEV ? globalThis.__FREECUT_SCENE_BROWSER_STORE__ : undefined;

// Preserve query/scope/color-mode/reference across Vite HMR in dev so a
// file save doesn't wipe the panel's current search context.
const sceneBrowserStore: SceneBrowserStoreApi = hotStore ?? create<SceneBrowserState & SceneBrowserActions>((set) => ({
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

  setReference: (reference) => set({ reference }),

  setViewMode: (viewMode) => set({ viewMode }),

  setColorMode: (colorMode) => set((state) => ({
    colorMode,
    // Leaving color mode clears any active reference — the mode is the
    // only way to land on one, so the chip shouldn't outlive the mode.
    reference: colorMode ? state.reference : null,
    query: colorMode ? '' : state.query,
  })),

  reset: () => set(INITIAL_STATE),
}));

if (import.meta.env.DEV) {
  globalThis.__FREECUT_SCENE_BROWSER_STORE__ = sceneBrowserStore;
}

export const useSceneBrowserStore = sceneBrowserStore;
