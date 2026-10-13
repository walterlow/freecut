import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { PlaybackState, PlaybackActions, PreviewQuality } from './types'
import { getNextShuttleRate } from './shuttle'

function normalizeFrame(frame: number): number {
  if (!Number.isFinite(frame)) return 0
  return Math.max(0, Math.round(frame))
}

function normalizePreviewQuality(quality: PreviewQuality): PreviewQuality {
  if (quality === 0.5 || quality === 0.33 || quality === 0.25) {
    return quality
  }
  return 1
}

function enterPlayback(state: PlaybackState & PlaybackActions) {
  if (state.isPlaying && state.previewFrame === null && state.previewItemId === null) {
    return state
  }
  if (state.previewFrame === null && state.previewItemId === null) {
    return { isPlaying: true }
  }
  const nextEpoch = state.frameUpdateEpoch + 1
  return {
    isPlaying: true,
    previewFrame: null,
    previewItemId: null,
    previewFrameEpoch: nextEpoch,
    frameUpdateEpoch: nextEpoch,
  }
}

function enterNormalPlayback(state: PlaybackState & PlaybackActions) {
  const playbackState = enterPlayback(state)
  if (playbackState === state) {
    if (state.playbackRate === 1 && state.transportMode === 'normal') {
      return state.playbackScrubResumeTransport === null
        ? state
        : { playbackScrubResumeTransport: null }
    }
    return {
      playbackRate: 1,
      transportMode: 'normal' as const,
      playbackScrubResumeTransport: null,
    }
  }
  return {
    ...playbackState,
    playbackRate: 1,
    transportMode: 'normal' as const,
    playbackScrubResumeTransport: null,
  }
}

function enterShuttlePlayback(state: PlaybackState & PlaybackActions, direction: -1 | 1) {
  const playbackState = enterPlayback(state)
  return {
    ...(playbackState === state ? {} : playbackState),
    playbackRate: state.isPlaying ? getNextShuttleRate(state.playbackRate, direction) : direction,
    transportMode: 'shuttle' as const,
    playbackScrubResumeTransport: null,
  }
}

function updatePausedScrubFrame(
  state: PlaybackState & PlaybackActions,
  frame: number,
  itemId?: string | null,
) {
  const nextFrame = normalizeFrame(frame)
  const nextItemId = itemId ?? null
  if (state.currentFrame === nextFrame && state.previewFrame === null && nextItemId === null) {
    return state
  }
  if (
    state.currentFrame === nextFrame &&
    state.previewFrame === nextFrame &&
    state.previewItemId === nextItemId
  ) {
    return state
  }
  const nextEpoch = state.frameUpdateEpoch + 1
  return {
    currentFrame: nextFrame,
    currentFrameEpoch: nextEpoch,
    previewFrame: nextFrame,
    previewItemId: nextItemId,
    previewFrameEpoch: nextEpoch,
    frameUpdateEpoch: nextEpoch,
  }
}

export const usePlaybackStore = create<PlaybackState & PlaybackActions>()(
  persist(
    (set) => ({
      // State
      currentFrame: 0,
      currentFrameEpoch: 0,
      isPlaying: false,
      playbackRate: 1,
      transportMode: 'normal',
      playbackScrubResumeTransport: null,
      loop: false,
      volume: 1,
      muted: false,
      masterBusDb: 0,
      busAudioEq: undefined,
      zoom: -1, // -1 = auto-fit, positive values = specific zoom percentage
      previewFrame: null,
      previewFrameEpoch: 0,
      frameUpdateEpoch: 0,
      previewItemId: null,
      useProxy: true,
      previewQuality: 1 as PreviewQuality,
      compositionVisualFrozen: false,

      // Actions
      setCurrentFrame: (frame) =>
        set((state) => {
          const nextFrame = normalizeFrame(frame)
          if (state.currentFrame === nextFrame) return state
          const nextEpoch = state.frameUpdateEpoch + 1
          return {
            currentFrame: nextFrame,
            currentFrameEpoch: nextEpoch,
            frameUpdateEpoch: nextEpoch,
          }
        }),
      setScrubFrame: (frame, itemId) =>
        set((state) => (state.isPlaying ? state : updatePausedScrubFrame(state, frame, itemId))),
      finishScrub: (frame) =>
        set((state) => {
          const nextFrame = normalizeFrame(frame)
          if (
            state.currentFrame === nextFrame &&
            state.previewFrame === null &&
            state.previewItemId === null &&
            !state.compositionVisualFrozen
          ) {
            return state
          }
          const nextEpoch = state.frameUpdateEpoch + 1
          return {
            currentFrame: nextFrame,
            currentFrameEpoch: nextEpoch,
            previewFrame: null,
            previewItemId: null,
            previewFrameEpoch: nextEpoch,
            frameUpdateEpoch: nextEpoch,
            compositionVisualFrozen: false,
          }
        }),
      beginPlaybackScrub: () =>
        set((state) => ({
          isPlaying: false,
          playbackRate: 1,
          transportMode: 'normal',
          playbackScrubResumeTransport: state.isPlaying
            ? {
                playbackRate: state.playbackRate,
                transportMode: state.transportMode,
              }
            : null,
        })),
      resumePlaybackAfterScrub: () =>
        set((state) => {
          const resumeTransport = state.playbackScrubResumeTransport
          if (!resumeTransport) return state
          if (state.isPlaying) {
            return { playbackScrubResumeTransport: null }
          }
          return {
            isPlaying: true,
            playbackRate: resumeTransport.playbackRate,
            transportMode: resumeTransport.transportMode,
            playbackScrubResumeTransport: null,
          }
        }),
      cancelPlaybackScrubResume: () =>
        set((state) =>
          state.playbackScrubResumeTransport === null
            ? state
            : { playbackScrubResumeTransport: null },
        ),
      play: () => set(enterNormalPlayback),
      pause: () =>
        set((state) =>
          state.isPlaying ||
          state.playbackRate !== 1 ||
          state.transportMode !== 'normal' ||
          state.playbackScrubResumeTransport !== null
            ? {
                isPlaying: false,
                playbackRate: 1,
                transportMode: 'normal',
                playbackScrubResumeTransport: null,
              }
            : state,
        ),
      togglePlayPause: () =>
        set((state) =>
          state.isPlaying
            ? {
                isPlaying: false,
                playbackRate: 1,
                transportMode: 'normal',
                playbackScrubResumeTransport: null,
              }
            : enterNormalPlayback(state),
        ),
      shuttleForward: () => set((state) => enterShuttlePlayback(state, 1)),
      shuttleReverse: () => set((state) => enterShuttlePlayback(state, -1)),
      setPlaybackRate: (rate) => set({ playbackRate: rate, playbackScrubResumeTransport: null }),
      toggleLoop: () => set((state) => ({ loop: !state.loop })),
      setVolume: (volume) => set({ volume }),
      toggleMute: () => set((state) => ({ muted: !state.muted })),
      setMuted: (muted) => set((state) => (state.muted === muted ? state : { muted })),
      setMasterBusDb: (masterBusDb) =>
        set({ masterBusDb: Math.max(-60, Math.min(12, masterBusDb)) }),
      setBusAudioEq: (busAudioEq) => set({ busAudioEq }),
      setZoom: (zoom) => set({ zoom }),
      setPreviewFrame: (frame, itemId) =>
        set((state) => {
          if (state.isPlaying && frame !== null) return state
          const nextFrame = frame == null ? null : normalizeFrame(frame)
          const nextItemId = frame == null ? null : (itemId ?? null)
          if (state.previewFrame === nextFrame && state.previewItemId === nextItemId) {
            return state
          }
          const nextEpoch = state.frameUpdateEpoch + 1
          return {
            previewFrame: nextFrame,
            previewItemId: nextItemId,
            previewFrameEpoch: nextEpoch,
            frameUpdateEpoch: nextEpoch,
          }
        }),
      toggleUseProxy: () => set((state) => ({ useProxy: !state.useProxy })),
      setPreviewQuality: (quality) =>
        set((state) => {
          const nextQuality = normalizePreviewQuality(quality)
          if (state.previewQuality === nextQuality) return state
          return { previewQuality: nextQuality }
        }),
      setCompositionVisualFrozen: (frozen) =>
        set((state) =>
          state.compositionVisualFrozen === frozen ? state : { compositionVisualFrozen: frozen },
        ),
    }),
    {
      name: 'playback-storage',
      partialize: (state) => ({
        zoom: state.zoom,
        volume: state.volume,
        muted: state.muted,
        loop: state.loop,
        useProxy: state.useProxy,
        previewQuality: state.previewQuality,
      }),
      merge: (persistedState, currentState) => ({
        ...currentState,
        ...(persistedState as Partial<PlaybackState>),
        isPlaying: false,
        playbackRate: 1,
        transportMode: 'normal',
      }),
    },
  ),
)
