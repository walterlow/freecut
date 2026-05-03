import { create } from 'zustand'

interface DebugState {
  /** Show debug overlay on video clips */
  showVideoDebugOverlay: boolean
  setShowVideoDebugOverlay: (show: boolean) => void
  toggleVideoDebugOverlay: () => void
  /** Show preview performance diagnostics panel */
  showPreviewPerfPanel: boolean
  setShowPreviewPerfPanel: (show: boolean) => void
  togglePreviewPerfPanel: () => void
  /** Debug panel open state */
  debugPanelOpen: boolean
  setDebugPanelOpen: (open: boolean) => void
  toggleDebugPanel: () => void
}

/**
 * Debug store for development-only settings
 * In production, all values are false/no-op for tree-shaking
 *
 * Note: Safe check for import.meta.env to support both Vite (client) and
 * webpack (Composition server-side rendering) bundlers
 */
const isDev =
  typeof import.meta !== 'undefined' &&
  typeof import.meta.env !== 'undefined' &&
  import.meta.env.DEV

export const useDebugStore = isDev
  ? create<DebugState>((set) => ({
      showVideoDebugOverlay: false,
      setShowVideoDebugOverlay: (show) => set({ showVideoDebugOverlay: show }),
      toggleVideoDebugOverlay: () =>
        set((s) => ({ showVideoDebugOverlay: !s.showVideoDebugOverlay })),
      showPreviewPerfPanel: false,
      setShowPreviewPerfPanel: (show) => set({ showPreviewPerfPanel: show }),
      togglePreviewPerfPanel: () => set((s) => ({ showPreviewPerfPanel: !s.showPreviewPerfPanel })),
      debugPanelOpen: false,
      setDebugPanelOpen: (open) => set({ debugPanelOpen: open }),
      toggleDebugPanel: () => set((s) => ({ debugPanelOpen: !s.debugPanelOpen })),
    }))
  : create<DebugState>(() => ({
      showVideoDebugOverlay: false,
      setShowVideoDebugOverlay: () => {},
      toggleVideoDebugOverlay: () => {},
      showPreviewPerfPanel: false,
      setShowPreviewPerfPanel: () => {},
      togglePreviewPerfPanel: () => {},
      debugPanelOpen: false,
      setDebugPanelOpen: () => {},
      toggleDebugPanel: () => {},
    }))
