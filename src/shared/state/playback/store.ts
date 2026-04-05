import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { PlaybackState, PlaybackActions, PreviewQuality } from './types';

function normalizeFrame(frame: number): number {
  if (!Number.isFinite(frame)) return 0;
  return Math.max(0, Math.round(frame));
}

function normalizePreviewQuality(quality: PreviewQuality): PreviewQuality {
  if (quality === 0.5 || quality === 0.33 || quality === 0.25) {
    return quality;
  }
  return 1;
}

export const usePlaybackStore = create<PlaybackState & PlaybackActions>()(
  persist(
    (set) => ({
      // State
      currentFrame: 0,
      displayedFrame: null,
      isPlaying: false,
      playbackRate: 1,
      loop: false,
      volume: 1,
      muted: false,
      zoom: -1, // -1 = auto-fit, positive values = specific zoom percentage
      previewFrame: null,
      previewItemId: null,
      captureFrame: null, // Set by VideoPreview when the transport surface is mounted
      captureFrameImageData: null,
      captureCanvasSource: null,
      useProxy: true,
      previewQuality: 1 as PreviewQuality,

      // Actions
      setCurrentFrame: (frame) =>
        set((state) => {
          const nextFrame = normalizeFrame(frame);
          if (state.currentFrame === nextFrame) return state;
          return { currentFrame: nextFrame };
        }),
      setScrubFrame: (frame, itemId) =>
        set((state) => {
          const nextFrame = normalizeFrame(frame);
          const nextItemId = itemId ?? null;
          if (
            state.currentFrame === nextFrame
            && state.previewFrame === nextFrame
            && state.previewItemId === nextItemId
          ) {
            return state;
          }
          return {
            currentFrame: nextFrame,
            previewFrame: nextFrame,
            previewItemId: nextItemId,
          };
        }),
      clearPreviewFrame: () =>
        set((state) => {
          if (state.previewFrame === null && state.previewItemId === null) {
            return state;
          }
          return {
            previewFrame: null,
            previewItemId: null,
          };
        }),
      commitPreviewFrame: () =>
        set((state) => {
          if (state.previewFrame === null) return state;
          return {
            currentFrame: state.previewFrame,
            previewFrame: null,
            previewItemId: null,
          };
        }),
      seekTimelineFrame: (frame) =>
        set((state) => {
          const nextFrame = normalizeFrame(frame);
          if (
            state.currentFrame === nextFrame
            && state.previewFrame === null
            && state.displayedFrame === null
            && state.previewItemId === null
          ) {
            return state;
          }
          return {
            currentFrame: nextFrame,
            previewFrame: null,
            previewItemId: null,
            displayedFrame: null,
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
          return {
            previewFrame: nextFrame,
            previewItemId: nextItemId,
          };
        }),
      setDisplayedFrame: (frame) =>
        set((state) => {
          const nextFrame = frame == null ? null : normalizeFrame(frame);
          if (state.displayedFrame === nextFrame) return state;
          return { displayedFrame: nextFrame };
        }),
      setCaptureFrame: (fn) => set({ captureFrame: fn }),
      setCaptureFrameImageData: (fn) => set({ captureFrameImageData: fn }),
      setCaptureCanvasSource: (fn) => set({ captureCanvasSource: fn }),
      toggleUseProxy: () => set((state) => ({ useProxy: !state.useProxy })),
      setPreviewQuality: (quality) =>
        set((state) => {
          const nextQuality = normalizePreviewQuality(quality);
          if (state.previewQuality === nextQuality) return state;
          return { previewQuality: nextQuality };
        }),
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
