import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { PlaybackState, PlaybackActions, PreviewQuality } from './types';

function normalizeFrame(frame: number): number {
  if (!Number.isFinite(frame)) return 0;
  return Math.max(0, Math.round(frame));
}

export const usePlaybackStore = create<PlaybackState & PlaybackActions>()(
  persist(
    (set) => ({
      // State
      currentFrame: 0,
      currentFrameEpoch: 0,
      isPlaying: false,
      playbackRate: 1,
      loop: false,
      volume: 1,
      muted: false,
      zoom: -1, // -1 = auto-fit, positive values = specific zoom percentage
      previewFrame: null,
      previewFrameEpoch: 0,
      frameUpdateEpoch: 0,
      previewItemId: null,
      captureFrame: null, // Set by VideoPreview when Player is mounted
      useProxy: true,
      previewQuality: 1 as PreviewQuality,

      // Actions
      setCurrentFrame: (frame) =>
        set((state) => {
          const nextFrame = normalizeFrame(frame);
          if (state.currentFrame === nextFrame) return state;
          const nextEpoch = state.frameUpdateEpoch + 1;
          return {
            currentFrame: nextFrame,
            currentFrameEpoch: nextEpoch,
            frameUpdateEpoch: nextEpoch,
          };
        }),
      play: () => set((state) => (state.isPlaying ? state : { isPlaying: true })),
      pause: () => set((state) => (state.isPlaying ? { isPlaying: false } : state)),
      togglePlayPause: () => set((state) => ({ isPlaying: !state.isPlaying })),
      setPlaybackRate: (rate) => set({ playbackRate: rate }),
      toggleLoop: () => set((state) => ({ loop: !state.loop })),
      setVolume: (volume) => set({ volume }),
      toggleMute: () => set((state) => ({ muted: !state.muted })),
      setZoom: (zoom) => set({ zoom }),
      setPreviewFrame: (frame, itemId) =>
        set((state) => {
          const nextFrame = frame == null ? null : normalizeFrame(frame);
          const nextItemId = frame == null ? null : (itemId ?? null);
          if (state.previewFrame === nextFrame && state.previewItemId === nextItemId) {
            return state;
          }
          const nextEpoch = state.frameUpdateEpoch + 1;
          return {
            previewFrame: nextFrame,
            previewItemId: nextItemId,
            previewFrameEpoch: nextEpoch,
            frameUpdateEpoch: nextEpoch,
          };
        }),
      setCaptureFrame: (fn) => set({ captureFrame: fn }),
      toggleUseProxy: () => set((state) => ({ useProxy: !state.useProxy })),
      setPreviewQuality: (quality) => set({ previewQuality: quality }),
    }),
    {
      name: 'playback-storage',
      partialize: (state) => ({
        zoom: state.zoom,
        volume: state.volume,
        muted: state.muted,
        playbackRate: state.playbackRate,
        loop: state.loop,
        useProxy: state.useProxy,
        previewQuality: state.previewQuality,
      }),
    }
  )
);
