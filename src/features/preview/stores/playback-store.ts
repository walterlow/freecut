import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { PlaybackState, PlaybackActions } from '../types';

function normalizeFrame(frame: number): number {
  if (!Number.isFinite(frame)) return 0;
  return Math.max(0, Math.round(frame));
}

export const usePlaybackStore = create<PlaybackState & PlaybackActions>()(
  persist(
    (set) => ({
      // State
      currentFrame: 0,
      isPlaying: false,
      playbackRate: 1,
      loop: false,
      volume: 1,
      muted: false,
      zoom: -1, // -1 = auto-fit, positive values = specific zoom percentage
      previewFrame: null,
      captureFrame: null, // Set by VideoPreview when Player is mounted

      // Actions
      setCurrentFrame: (frame) =>
        set((state) => {
          const nextFrame = normalizeFrame(frame);
          return state.currentFrame === nextFrame ? state : { currentFrame: nextFrame };
        }),
      play: () => set((state) => (state.isPlaying ? state : { isPlaying: true })),
      pause: () => set((state) => (state.isPlaying ? { isPlaying: false } : state)),
      togglePlayPause: () => set((state) => ({ isPlaying: !state.isPlaying })),
      setPlaybackRate: (rate) => set({ playbackRate: rate }),
      toggleLoop: () => set((state) => ({ loop: !state.loop })),
      setVolume: (volume) => set({ volume }),
      toggleMute: () => set((state) => ({ muted: !state.muted })),
      setZoom: (zoom) => set({ zoom }),
      setPreviewFrame: (frame) =>
        set((state) => {
          const nextFrame = frame == null ? null : normalizeFrame(frame);
          return state.previewFrame === nextFrame ? state : { previewFrame: nextFrame };
        }),
      setCaptureFrame: (fn) => set({ captureFrame: fn }),
    }),
    {
      name: 'playback-storage',
      partialize: (state) => ({
        zoom: state.zoom,
        volume: state.volume,
        muted: state.muted,
        playbackRate: state.playbackRate,
        loop: state.loop,
      }),
    }
  )
);
