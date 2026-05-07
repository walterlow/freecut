import { create } from 'zustand'

/**
 * Timeline settings state - FPS, scroll position, snap, dirty tracking.
 * These are UI/editor settings, not timeline content.
 */

interface TimelineSettingsState {
  fps: number
  scrollPosition: number
  snapEnabled: boolean
  isDirty: boolean
  /** True while loadTimeline() is in progress - used to coordinate initial player sync */
  isTimelineLoading: boolean
  /** Project currently being restored into the timeline stores, if any. */
  loadingProjectId: string | null
  /** Last project whose timeline stores were fully restored and are safe to display. */
  loadedProjectId: string | null
  /** Monotonic token for the currently active loadTimeline() request. */
  timelineHydrationRequestId: number
}

interface TimelineSettingsActions {
  setFps: (fps: number) => void
  setScrollPosition: (position: number) => void
  setSnapEnabled: (enabled: boolean) => void
  toggleSnap: () => void
  setIsDirty: (dirty: boolean) => void
  markDirty: () => void
  markClean: () => void
  setTimelineLoading: (loading: boolean) => void
  beginTimelineHydration: (projectId: string) => number
  isTimelineHydrationCurrent: (projectId: string, requestId: number) => boolean
  completeTimelineHydration: (projectId: string, requestId: number) => void
  failTimelineHydration: (projectId: string, requestId: number) => void
  resetTimelineHydration: () => void
}

export const useTimelineSettingsStore = create<TimelineSettingsState & TimelineSettingsActions>()(
  (set, get) => ({
    // State
    fps: 30,
    scrollPosition: 0,
    snapEnabled: true,
    isDirty: false,
    isTimelineLoading: true, // Start true - set false after loadTimeline completes
    loadingProjectId: null,
    loadedProjectId: null,
    timelineHydrationRequestId: 0,

    // Actions
    setFps: (fps) => set({ fps }),
    setScrollPosition: (position) => set({ scrollPosition: position }),
    setSnapEnabled: (enabled) => set({ snapEnabled: enabled }),
    toggleSnap: () => set((state) => ({ snapEnabled: !state.snapEnabled })),
    setIsDirty: (dirty) => set({ isDirty: dirty }),
    markDirty: () => {
      if (!get().isDirty) set({ isDirty: true })
    },
    markClean: () => set({ isDirty: false }),
    setTimelineLoading: (loading) =>
      set((state) => ({
        isTimelineLoading: loading,
        loadingProjectId: loading ? state.loadingProjectId : null,
      })),
    beginTimelineHydration: (projectId) => {
      const requestId = get().timelineHydrationRequestId + 1
      set({
        isTimelineLoading: true,
        loadingProjectId: projectId,
        loadedProjectId: null,
        timelineHydrationRequestId: requestId,
      })
      return requestId
    },
    isTimelineHydrationCurrent: (projectId, requestId) => {
      const state = get()
      return state.loadingProjectId === projectId && state.timelineHydrationRequestId === requestId
    },
    completeTimelineHydration: (projectId, requestId) =>
      set((state) => {
        if (
          state.loadingProjectId !== projectId ||
          state.timelineHydrationRequestId !== requestId
        ) {
          return state
        }
        return {
          isTimelineLoading: false,
          loadingProjectId: null,
          loadedProjectId: projectId,
        }
      }),
    failTimelineHydration: (projectId, requestId) =>
      set((state) => {
        if (
          state.loadingProjectId !== projectId ||
          state.timelineHydrationRequestId !== requestId
        ) {
          return state
        }
        return {
          isTimelineLoading: false,
          loadingProjectId: null,
        }
      }),
    resetTimelineHydration: () =>
      set({
        isTimelineLoading: true,
        loadingProjectId: null,
        loadedProjectId: null,
        timelineHydrationRequestId: 0,
      }),
  }),
)
