import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { PlaybackState, PlaybackActions } from '../types';

// IMPORTANT: Always use granular selectors to prevent unnecessary re-renders!
//
// ✅ CORRECT: Use granular selectors
// const isPlaying = usePlaybackStore(s => s.isPlaying);
// const togglePlayPause = usePlaybackStore(s => s.togglePlayPause);
//
// ❌ WRONG: Don't destructure the entire store
// const { isPlaying, togglePlayPause } = usePlaybackStore();

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

      // Actions
      setCurrentFrame: (frame) => set({ currentFrame: frame }),
      play: () => set({ isPlaying: true }),
      pause: () => set({ isPlaying: false }),
      togglePlayPause: () => set((state) => ({ isPlaying: !state.isPlaying })),
      setPlaybackRate: (rate) => set({ playbackRate: rate }),
      toggleLoop: () => set((state) => ({ loop: !state.loop })),
      setVolume: (volume) => set({ volume }),
      toggleMute: () => set((state) => ({ muted: !state.muted })),
      setZoom: (zoom) => set({ zoom }),
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
