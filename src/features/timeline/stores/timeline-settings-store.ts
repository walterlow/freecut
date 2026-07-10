import { create } from 'zustand'

/**
 * Timeline settings state - FPS, scroll position, snap, dirty tracking.
 * These are UI/editor settings, not timeline content.
 */

interface TimelineSettingsState {
  fps: number
  scrollPosition: number
  snapEnabled: boolean
  audioSkimmingEnabled: boolean
  /** Auto-apply a cinematic camera move (Ken Burns) to stills added to the timeline. */
  autoCameraOnStills: boolean
  isDirty: boolean
  /** True while loadTimeline() is in progress - used to coordinate initial player sync */
  isTimelineLoading: boolean
}

interface TimelineSettingsActions {
  setFps: (fps: number) => void
  setScrollPosition: (position: number) => void
  setSnapEnabled: (enabled: boolean) => void
  toggleSnap: () => void
  setAudioSkimmingEnabled: (enabled: boolean) => void
  toggleAudioSkimming: () => void
  setAutoCameraOnStills: (enabled: boolean) => void
  toggleAutoCameraOnStills: () => void
  setIsDirty: (dirty: boolean) => void
  markDirty: () => void
  markClean: () => void
  setTimelineLoading: (loading: boolean) => void
}

export const useTimelineSettingsStore = create<TimelineSettingsState & TimelineSettingsActions>()(
  (set, get) => ({
    // State
    fps: 30,
    scrollPosition: 0,
    snapEnabled: true,
    audioSkimmingEnabled: true,
    autoCameraOnStills: true,
    isDirty: false,
    isTimelineLoading: true, // Start true - set false after loadTimeline completes

    // Actions
    setFps: (fps) => set({ fps }),
    setScrollPosition: (position) => set({ scrollPosition: position }),
    setSnapEnabled: (enabled) => set({ snapEnabled: enabled }),
    toggleSnap: () => set((state) => ({ snapEnabled: !state.snapEnabled })),
    setAudioSkimmingEnabled: (enabled) => set({ audioSkimmingEnabled: enabled }),
    toggleAudioSkimming: () =>
      set((state) => ({ audioSkimmingEnabled: !state.audioSkimmingEnabled })),
    setAutoCameraOnStills: (enabled) => set({ autoCameraOnStills: enabled }),
    toggleAutoCameraOnStills: () =>
      set((state) => ({ autoCameraOnStills: !state.autoCameraOnStills })),
    setIsDirty: (dirty) => set({ isDirty: dirty }),
    markDirty: () => {
      if (!get().isDirty) set({ isDirty: true })
    },
    markClean: () => set({ isDirty: false }),
    setTimelineLoading: (loading) => set({ isTimelineLoading: loading }),
  }),
)
